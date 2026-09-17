# Unit 02: Engine - Completion Context

## What Was Implemented

The core discrete-event simulation engine under `src/engine/`: a time-ordered event queue (FIFO tie-break), an explicit elevator state machine (`idle` / `moving` / `doorsOpen` / `doorsClosed`) driving floor-to-floor atomic movement, mechanical capacity-limited boarding/alighting with presence-only hall calls and overflow handling, the door-dwell formula, and full event-log construction for later replay. The `DispatchHook` seam (`DispatchSnapshot`/`DispatchAction`) is defined and proven usable via several hand-written test hooks, ready for Unit 03's real algorithms to plug into. Headless, framework-independent, plain data + pure functions throughout — no classes, no UI dependency.

## Key Decisions

- Elevator behavior modeled as an explicit finite state machine rather than ad-hoc trigger flags — decision points (dispatch hook re-invocation) fall naturally out of state transitions (arrival, doors-finished-dwell, new hall call).
- Passenger destinations are decided at creation time (part of the input script/fixture), never via a hook at boarding — critical for the seeded multi-run fairness guarantee in `00_main.md`: if destinations were drawn at boarding time, the RNG draw's position would depend on algorithm behavior, breaking reproducibility across algorithm comparisons.
- `DispatchSnapshot.activeHallCalls` exposes only `{floor, direction}`, derived from the engine's internal `waitingPassengers` ground truth rather than tracked as separate state — structurally guarantees no passenger-count or identity data can leak to a dispatch algorithm.
- Floor indexing: 0-indexed, 0 = ground floor; `BuildingConfig.floorCount` configures floors *above* ground (valid indices `0..floorCount` inclusive).
- Event ordering: FIFO for same-timestamp events.
- This unit owns building the replay-facing event log, rather than deferring it to Unit 07.
- A dispatch hook cannot return more than one action for the same elevator in a single invocation — enforced with a thrown error, added during developer review.

## Deviations from Plan

All are minor and documented in full in `02_engine.md`'s AI Interactions section:

- `activeHallCalls` derived from `waitingPassengers` rather than tracked as separate parallel state — avoids desync, consistent with the plan's own "ground truth" framing.
- Boarding direction when a `'stop'` action is issued directly from `idle` (no prior committed travel direction) — resolved as "match either direction" for that one stop, since the plan's wording assumed arrival-via-movement and didn't cover this case explicitly.
- `index.ts`'s export surface is slightly broader than the plan's literal parenthetical list (adds `FloorIndex`, `Direction`, `ElevatorMachineState`, `BuildingState`, `PassengerArrival`, `ScriptedInput`, `ElevatorSnapshot`, `RunSimulationOptions`/`RunSimulationResult`) — the plan's own prose named types not in that list, so the list read as illustrative; the additions are exactly what's needed to use the engine's public API from outside the module.
- Post-implementation addition (not part of the original plan at all): a guard against a dispatch hook returning duplicate actions for one elevator, added after developer code review surfaced the gap. Not a plan deviation so much as a plan omission the review caught.

## Files Modified

Created: `src/engine/types.ts`, `eventQueue.ts`, `door.ts`, `dispatch.ts`, `simulation.ts`, `index.ts`, `testFixtures.ts`, `eventQueue.test.ts`, `door.test.ts`, `simulation.test.ts`, `capacity.test.ts`, `dev_log/02_engine_test.md`. Modified: `dev_log/02_engine.md` (AI Interactions, Files Modified, Status, plus two rounds of plan revision during review — the destination-timing/reproducibility fix and the elevator-state-machine reframing, both made *before* implementation started).

## Integration Notes

- **Unit 03** (dispatch algorithms) imports `DispatchHook`/`DispatchSnapshot`/`DispatchAction` from `src/engine/index.ts` and implements real algorithms against them — the seam is already exercised by several hand-written test hooks (a pure function, a `vi.fn`-wrapped scripted hook, and a small reusable "greedy nearest-target" hook in `testFixtures.ts`, which is not exported and not meant to survive as a real algorithm).
- **Unit 04** (call generation) produces `ScriptedInput` (`PassengerArrival[]`) from a real seeded generator instead of hand-authored fixtures — no engine changes needed, since `runSimulation` only ever consumes that shape.
- **Unit 07** (replay/metrics) consumes `SimEventLogEntry[]` as returned by `runSimulation`.
- `eventQueue.ts` and `testFixtures.ts` are intentionally not exported from `index.ts`.

## Lessons Learned

Reviewing the plan closely before implementation (rather than just before/after coding) caught a real correctness bug early and cheaply: the original destination-assignment design (a hook fired at boarding time) would have silently broken the seeded multi-run fairness guarantee, and catching it at the plan stage meant the fix was a doc edit rather than a code rewrite. Separately, a post-implementation code review caught a second real gap (no guard against duplicate per-elevator dispatch actions) that neither the plan nor the initial test suite had covered — worth treating "what happens if the hook misbehaves" as its own explicit test category in future units that define an interface seam (Unit 03's real algorithms will be the next hook implementers, so this guard protects against a class of bug before it exists).

## Amendment (during Unit 03 planning)

While drafting the Unit 03 (algorithms) plan, it surfaced that `DispatchSnapshot.activeHallCalls`'s ordering (calls appear in the order they first became active, independent of other calls being cleared) was already true by construction but undocumented — an incidental implementation detail an algorithm couldn't safely rely on. Corrected: `dispatch.ts` and `simulation.ts`'s `getActiveHallCalls` now carry an explicit doc comment making this a guaranteed contract, and `capacity.test.ts` gained a test proving it directly (three calls registered at different times, one cleared independently, asserting the remaining two keep their relative order throughout). 23/23 tests pass; lint/format/build re-verified clean. This unblocks Unit 03's FCFS algorithm, which needs this guarantee to approximate first-come-first-served.

## Amendment (during Unit 03 implementation): boarding-direction bug fix

While writing Unit 03's comparative algorithm test, a real engine bug caused an infinite loop (crashed the test worker with an OOM/SIGABRT). Root cause: `handleStop` in `simulation.ts` derived which waiting passengers could board (`servicedDirections`) from `elevator.direction` — the direction the elevator physically *traveled to reach* the floor — rather than the direction of the *call being served*. Those differ whenever a car has to travel one way to reach a call for the opposite way (e.g. a car below a "floor 8, down" call must travel *up* to reach floor 8 at all). In that case, boarding found zero candidates, dwell time computed to zero (`computeDoorDwellMs` returns 0 for zero passengers), and the same zero-duration stop re-fired forever at the identical simulated timestamp — an infinite loop with no time advancement.

Fixed: `handleStop` now prefers the call matching `elevator.direction` if one is active at this floor (the normal case); if not, and the call is active in the *opposite* direction, it serves that instead (nothing else would explain stopping here for a pickup); otherwise falls back to `elevator.direction`, correctly yielding zero boarding candidates for a pure drop-off stop. The pre-existing `elevator.direction === null` case (idle-issued stop, serves either direction) is unchanged. Added two regression tests to `capacity.test.ts`: one reproducing the exact bug scenario (car travels up to reach a "down" call, must still board), one confirming the fix doesn't over-correct (a pure drop-off stop with no active call here still boards nobody). 24/24 engine tests pass; lint/format/build re-verified clean.

This is a significant correctness fix — the bug was latent since Unit 02's original implementation and only surfaced once a scenario forced a car to approach a call from the "wrong" side, which none of Unit 02's own tests happened to construct.
