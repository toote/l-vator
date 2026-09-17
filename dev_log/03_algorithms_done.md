# Unit 03: Algorithms - Completion Context

## What Was Implemented

The three dispatch algorithms named in `00_main.md`: FCFS/naive nearest-car, SCAN/LOOK, and nearest-car with directional matching, each in its own file under `src/algorithms/`, implementing the `DispatchHook` seam Unit 02 built. A common `Algorithm` interface (`{id, name, createHook}`) with a factory pattern (fresh per-trial assignment memory, required for seeded multi-run fairness). Algorithms are discovered automatically via `import.meta.glob` — no manual registry to maintain when adding a new algorithm file.

## Key Decisions

- Idle policy (no active calls): each algorithm independently chooses "stay put" — a per-algorithm decision, not a shared engine rule; a future algorithm could choose differently.
- Algorithm discovery: files export `algorithm: Algorithm` under a uniform name; `index.ts` glob-imports everything except `types.ts`/`shared.ts`/test files and filters to the `Algorithm` shape.
- FCFS's "first come, first served" relies on `DispatchSnapshot.activeHallCalls`'s guaranteed arrival-order contract (fixed at the engine level as part of this unit's review — see below).

## Deviations from Plan

Two real corrections made during review, both documented at length in `03_algorithms.md`'s AI Interactions:

- **FCFS's candidate filter incorrectly required `state === 'idle'`.** This was a genuine bug, not a simplification — it made FCFS's candidate pool a strict subset of `nearestCarDirectional`'s, so FCFS could never exhibit the "sends a car that's moving away" flaw the unit's own Objective names as the reason `nearestCarDirectional` exists. Fixed: FCFS now considers any elevator without an existing assignment and with spare capacity, regardless of state or direction — genuinely naive, as originally intended. One test that had encoded the buggy behavior was rewritten; a new test proves the corrected naive behavior directly.
- **The comparative test in `algorithms.test.ts` was rebuilt from scratch** around a real direction-mismatch scenario (previously mathematically unconstructible given the FCFS bug above), restoring the original "nearer-but-departing vs. farther-but-compatible" framing from the unit's Objective.

## Files Modified

Created: `src/algorithms/types.ts`, `shared.ts`, `fcfsNearestCar.ts`, `scanLook.ts`, `nearestCarDirectional.ts`, `index.ts`, `fcfsNearestCar.test.ts`, `scanLook.test.ts`, `nearestCarDirectional.test.ts`, `algorithms.test.ts`, `dev_log/03_algorithms_test.md`. Modified: `dev_log/03_algorithms.md`.

Also touched, as separate amendments to the already-completed Unit 02 (committed independently — see `02_engine_done.md`): `src/engine/dispatch.ts`, `src/engine/simulation.ts`, `src/engine/capacity.test.ts`. The more significant of the two is a real infinite-loop bug in `handleStop`'s boarding-direction logic, found via this unit's own testing (see Integration Notes).

## Integration Notes

- **Unit 04** (call generation) can produce `ScriptedInput`/`PassengerArrival` records for any of these algorithms with no changes needed here.
- **Unit 05** (metrics) and **Unit 06** (UI) can iterate `algorithms` (from `src/algorithms/index.ts`) to run/list all three without knowing their file names — the discovery mechanism is exactly the extensibility point `00_main.md` asked for.
- A latent engine bug (boarding direction derived from arrival direction instead of call direction) was caught here, not in Unit 02, because it only manifests when an elevator must approach a call from the "wrong" side — a scenario Unit 02's own tests never happened to construct, but Unit 03's cross-algorithm comparative test did almost immediately.

## Lessons Learned

A plan that passes review can still encode a structural bug that only becomes visible once you try to write the test the plan itself describes — the FCFS/`nearestCarDirectional` "nearer vs. farther" contrast was un-constructible from the approved pseudocode, and that contradiction is what led to finding the `state === 'idle'` bug, not a direct code review. When a comparative/integration test can't be made to pass no matter how the scenario is adjusted, treat that as a signal to re-examine the underlying logic rather than reshaping the test to fit — the first version of this comparative test was quietly rewritten by the initial implementation to work around the bug instead of surfacing it, which would have shipped a fundamentally miscalibrated demonstration of the project's central "compare algorithms" premise.

Separately: an infinite loop with no time advancement (all events at one simulated timestamp) manifests as a hard OOM/SIGABRT crash of the whole test worker, not a clean assertion failure — worth remembering as a diagnostic signature for this class of bug in a discrete-event engine, since the stack trace itself gives no hint about simulation logic.

## Amendment (during Unit 06 review): overflow handoff — a second elevator can now help

While validating Unit 06's UI, real browser testing against the default scenario (up-peak, 2 elevators, capacity 8) surfaced FCFS and nearest-car-directional catastrophically failing — 20-37% of passengers unserved, max wait times near the safety cutoff — while SCAN/LOOK handled the identical batch fine. Root cause, found via developer-directed investigation, was two compounding bugs in `fcfsNearestCar.ts`'s and `nearestCarDirectional.ts`'s shared `decide()`/`refreshAssignments` logic (both files have the identical structure, so both had both bugs):

1. **`decide()` returned `'stop'` for the assigned pickup unconditionally**, with no capacity check. Once an elevator filled up, it kept "stopping" at the same floor forever — reopening its doors for people it had no room for — instead of ever issuing `'travel'` to go deliver what it already had onboard. The elevator never actually departed.
2. **An assignment was permanent for as long as its call stayed active**, regardless of the assigned elevator's real position. Even if bug 1 didn't exist, once an elevator left to deliver, it kept "owning" the still-active call — the candidate filter in `refreshAssignments` excludes any call already in the assignments map, with no way for a second elevator to ever be offered a call someone else was assigned to, no matter how idle that second elevator was or how much overflow was piling up.

Bug 1 meant the elevator never departed at all, which meant bug 2's fix could never even get a chance to run — they had to be fixed together. Fixed: `decide()` now only stops for the assigned pickup when `capacityRemaining > 0`, falling through to routing toward onboard destinations otherwise. `refreshAssignments` now tracks whether the assigned elevator has ever visited the call's floor (`hasVisited`); once visited and since departed, if the call is still active, the assignment is released so the next `refreshAssignments` pass reconsiders every elevator fresh — possibly reassigning the same elevator if it's still nearest, or handing it to whichever other elevator is actually available.

Verified end-to-end against the exact scenario that surfaced this (up-peak, 2 elevators, capacity 8, 5 min, 10 trials): FCFS went from 21.9% unserved / ~5,946,000ms max wait to **0% unserved / 37,016ms max wait**; all three algorithms now perform comparably. Two regression tests added (one per file) proving the overflow-handoff mechanism directly. 127/127 tests pass; lint/format/build re-verified clean.

This is a real behavior change, not just a bug fix in the "wrong answer for an edge case" sense — it changes these two algorithms' output for any scenario with sustained per-floor demand exceeding one elevator's throughput, which was silently broken (or worse, silently producing a *worse* result than the "naive" baseline it exists to contrast against) since this unit's original implementation.

## Amendment (during Unit 09 review): SCAN/LOOK's `decide()` gets stuck once an elevator is full

Developer-reported: "the SCAN/LOOK algorithm appears to stop working when an elevator gets full." Root cause was the same bug class as bug 1 above, missed in `scanLook.ts` when the overflow-handoff amendment was made — `decide()`'s stop condition (`pending.has(currentFloor)`) never checked capacity in either branch (idle or committed-direction). A full elevator sitting on a pickup-only call would return `'stop'` forever: zero boarding (it's full), so nothing about the situation changes to break the cycle, latching it at that floor permanently instead of routing to deliver what it already has onboard.

Fixed by gating `pending`'s *construction*, not just the final stop check: active-call floors are only added to `pending` when `elevator.capacityRemaining > 0`; car buttons (drop-offs) are always added unconditionally, since delivering is what frees capacity. Gating construction (not just the stop decision) matters because `pending` also drives the nearest/ahead/behind routing searches — excluding a blocked call only from the stop check would still let it win those searches (distance 0 to itself), wrongly returning `'idle'` instead of routing toward a real drop-off elsewhere. Two hook-level regression tests added (one per branch) plus one integration-level test proving a full elevator departs after a single stop rather than looping. 186/186 tests pass; lint/build re-verified clean.

**A separate, deeper bug surfaced while integration-testing this fix, left unfixed and flagged for the developer:** SCAN/LOOK can strand a call behind an elevator that needs to *backtrack* to reach it — independent of capacity entirely. The idle branch picks a travel direction toward the nearest pending floor without considering the call's own direction (only position), but the committed-direction branch only keeps calls whose direction matches the elevator's current travel direction in `pending`. If the nearest pending target while idle happens to be a hall call whose direction doesn't match the direction needed to *reach* it (e.g. an idle elevator above an 'up' call must travel down to get there), the elevator commits toward it, then at the very next floor recomputes `pending` under the direction filter, finds it empty, and gives up (`idle`) one floor short — permanently, since nothing else triggers another decision. Reproduced independently of capacity (confirmed via a probe scenario with `capacity: 100`) — this is a navigation/commitment bug, not the capacity one. Most visible in overflow scenarios (any elevator that fills up, delivers further along its sweep, then needs to return for stragglers will hit it), but not caused by them.
