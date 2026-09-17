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
