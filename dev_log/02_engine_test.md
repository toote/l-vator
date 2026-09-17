# Unit 02: Engine - Test Instructions

## Test Objectives

Verify that the headless simulation engine (`src/engine/`) correctly implements, in isolation from any real dispatch algorithm:

- The event queue's chronological ordering and FIFO tie-break.
- The door-dwell formula, including non-default parameters.
- The elevator state machine's floor-to-floor atomic movement (one hop at a time, exact `floorTravelTimeMs` spacing).
- Re-invocation of the dispatch hook at all three decision points (floor arrival, doors-finished-dwell, new hall-call registration), including proof that mid-route redirection actually changes an elevator's physical path.
- Mechanical boarding/alighting on a `'stop'` action: capacity-limited, presence-only-direction-matched, combined (not phased) dwell timing.
- Capacity overflow: partial boarding, the excess staying in `waitingPassengers`, and the hall call staying active until eventually served.
- The presence-only shape of `DispatchSnapshot.activeHallCalls` (`{floor, direction}` only), both as a compile-time guarantee and as a runtime property that holds even with several real waiting passengers behind one hall call.
- That a passenger's `destinationFloor` is exactly what the fixture authored at creation time, unchanged by boarding (boarding only copies it into `carButtons`).
- A full hand-computed end-to-end scenario's event-log timeline, as an integration-style smoke test over all of the above.

## Manual Tests

None. The engine is a headless, framework-independent TS module tree with no UI and no I/O — there is nothing a developer would click through or observe by running the app (Unit 06 will build the UI that eventually surfaces this). All verification for this unit is automated; see below.

## Automated Tests

Run via `npm run test` (Vitest). 21 tests across 5 files, all passing:

- **`src/engine/eventQueue.test.ts`** (5 tests)
  - Pops events in chronological order regardless of push order.
  - Stable FIFO tie-break for events sharing the same timestamp (including a larger interleaved/stress case).
  - `peek()` returns the earliest entry without removing it.
  - `peek()`/`pop()` on an empty queue return `undefined`; `isEmpty()` is `true`.

- **`src/engine/door.test.ts`** (6 tests)
  - `computeDoorDwellMs` at 0, 1, 2, and 5 passengers against the documented default (3000ms base, 50% multiplier): 0, 3000, 4500, 9000.
  - A non-default base/multiplier pair (4000ms / 25%), to confirm the formula itself, not just the defaults.
  - Negative counts treated as zero (defensive).

- **`src/engine/simulation.test.ts`** (5 tests)
  - **Floor-to-floor timing**: an elevator commanded to travel 4 floors arrives at each intermediate floor exactly `floorTravelTimeMs` (750ms) apart — one hop at a time, not a multi-floor jump.
  - **Decision-point re-invocation and mid-route redirection**: a fully call-index-scripted hook (wrapped in `vi.fn`) asserts exactly 6 invocations at the expected timestamps (`[0, 1000, 2000, 3000, 4000, 4000]`), inspects the snapshot actually passed to the hook at the moment of redirection (elevator at floor 2, still committed `'up'`), and proves the redirection is mechanically real via the resulting `elevatorArrived` floor sequence (`[1, 2, 1, 0]` — reverses instead of continuing to floors 3/4).
  - **Combined door-dwell timing**: a stop with 1 alighting + 2 boarding passengers produces exactly one `doorsOpened`/`doorsClosed` pair with dwell = 2000ms (the correct combined formula) rather than 2500ms (what two separately-phased dwells would wrongly produce).
  - **Destination fixed at creation**: after boarding, `Passenger.destinationFloor` still equals the fixture-authored value, `originFloor` is unchanged, and `carButtons` contains exactly the copied value — nothing was regenerated or reassigned at boarding time.
  - **End-to-end scripted scenario**: a hand-computed 2-elevator-stop, 2-passenger, 3-floor scenario (including a hall call registered mid-route while the elevator is already moving) asserts the *entire* log array, in order, against 17 hand-computed entries with exact timestamps, plus the final `BuildingState`.

- **`src/engine/capacity.test.ts`** (5 tests)
  - **Overflow**: 3 passengers waiting at one hall call, capacity 2 — exactly `p1`/`p2` board on the first stop, the hall call does *not* clear, `p3` stays in `waitingPassengers`, and only boards (clearing the call) on a later pass once capacity frees up.
  - **Capacity-exact edge case**: 2 passengers, capacity 2 — both board on the same stop that clears the call (a zero-overflow control case).
  - **Presence-only runtime check**: with 3 real waiting passengers behind one hall call, every `DispatchSnapshot.activeHallCalls` entry across the entire run has exactly the keys `{floor, direction}` (asserted via `Object.keys(...).sort()`), and the specific snapshot taken once the elevator reaches that floor (all 3 already waiting) still shows exactly one hall-call entry, not three.
  - **Presence-only type-level check**: a `@ts-expect-error`-annotated assignment proves `HallCall` rejects an added passenger-identifying field at compile time. This is enforced by `tsc -b` (part of `npm run build`) — Vitest itself runs on esbuild-transpiled output and does not enforce it, so the accompanying runtime assertion is a sanity check only, not the real guarantee.

Full verification commands and results at implementation time:

| Command | Result |
|---|---|
| `npm run lint` | Pass, no warnings/errors |
| `npm run format:check` | Pass (after one `npm run format` pass) |
| `npm run test` | Pass — 5 files, 21 tests |
| `npm run build` | Pass (`tsc -b` type-checks clean under strict mode, then `vite build` succeeds) |

## Integration Checks

- **Unit 03 (dispatch algorithms)** can implement a real `DispatchHook` against `DispatchSnapshot`/`DispatchAction` (both exported from `src/engine/index.ts`) with no changes to engine types. `simulation.test.ts` and `capacity.test.ts` already exercise the seam with several hand-written hooks (a pure function, a `vi.fn`-wrapped call-indexed script, and a small reusable "greedy nearest-target" hook in `testFixtures.ts`), so the interface is proven usable in more than one style before Unit 03 exists.
- **Unit 04 (call generation)** can produce `ScriptedInput` (an array of `PassengerArrival` records — `id`, `originFloor`, `direction`, `destinationFloor`, `arrivalTime`) from a real seeded generator instead of hand-authored fixtures, with no engine changes, since `runSimulation` only ever consumes that shape and never a live "assign a destination" hook (see `02_engine.md`, "Passenger destinations and reproducibility").
- **Unit 07 (replay/metrics)** can consume `SimEventLogEntry[]` as returned by `runSimulation` — the end-to-end test in `simulation.test.ts` demonstrates the full shape and ordering guarantees (chronological, one entry per mechanical event, combined-not-phased dwell) that a replay/metrics consumer can rely on.
- `testFixtures.ts` is confirmed **not** exported from `src/engine/index.ts` (verified by inspection of `index.ts`'s export list) — later units cannot accidentally depend on this unit's test-only scaffolding.
- `eventQueue.ts` is internal-only (not exported from `index.ts`) — later units interact with scheduling only indirectly, through `runSimulation`.

## Success Criteria

- All 21 automated tests pass under `npm run test`.
- `npm run lint`, `npm run format:check`, and `npm run build` all pass with no errors or warnings.
- The developer has reviewed `src/engine/` against the approved plan in `02_engine.md` (state model, event queue, door formula, dispatch-hook seam, state machine, boarding/overflow mechanics) and confirms it matches, including the one gap-fill decision flagged in `02_engine.md`'s AI Interactions section (boarding direction when a `'stop'` action is issued directly from `idle`, with no prior committed travel direction).
- The developer is satisfied that `src/engine/index.ts`'s export surface is the right set for Units 03/04/07 to build against.
