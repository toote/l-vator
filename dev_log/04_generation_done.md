# Unit 04: Generation - Completion Context

## What Was Implemented

The call-generation layer under `src/generation/`: a seeded mulberry32 PRNG, a two-pass Poisson-process random-arrival generator (`up-peak`/`down-peak`/`random` patterns, per-floor rate overrides, validated rates), scripted-scenario loading with floor-bounds/origin≠destination validation, and the trial batch/runner mechanism that guarantees the same seed sequence produces byte-for-byte identical passenger arrivals across every algorithm under comparison — proven end-to-end by `fairness.test.ts`. `src/scenarios/` holds a minimal example scripted scenario, discovered automatically via `import.meta.glob`, mirroring Unit 03's algorithm discovery.

## Key Decisions

- Arrival model: Poisson process / exponential inter-arrival times, the standard choice for "arrival rate" in queueing simulations.
- Seed derivation: one scenario needs exactly one base seed to reproduce an entire N-trial batch — child seeds are drawn deterministically from a single mulberry32 instance seeded with the base.
- Rate unit: arrivals per minute.
- Unit 04 owns the trial runner (`trialRunner.ts`), not just batch generation — confirmed against `03_algorithms.md`'s integration note.
- A per-floor rate override on a floor the current pattern doesn't generate from is a silent no-op; a negative rate throws.
- Duration-based generation only (no fixed-passenger-count mode) for now.
- `trialCount > 1` on a scripted scenario stays legal (N identical trials), not forced to 1.

## Deviations from Plan

None in the approved algorithm logic — the RNG, two-pass generator (including its pinned draw ordering), validation rules, and trial-batch/runner mechanics are implemented verbatim. One cosmetic change: `while (true)` written as `for (;;)` to satisfy ESLint.

A pre-implementation correction was made to the plan itself before coding started: the random-arrival generator's exponential sampler would have produced `NaN` (not just `Infinity`) for a rate of exactly `0`, causing an infinite loop — caught during plan review and fixed (skip floors with rate `0`, throw on negative rates) before any code was written.

## Files Modified

Created: `src/generation/types.ts`, `rng.ts`, `randomArrivals.ts`, `scriptedScenario.ts`, `trialBatch.ts`, `trialRunner.ts`, `index.ts`, six test files, `src/scenarios/upPeakDemo.ts`, `src/scenarios/index.ts`, `dev_log/04_generation_test.md`. Modified: `dev_log/04_generation.md`.

Also touched, as separate amendments to the already-completed Unit 02 (committed independently — see `02_engine_done.md`, commits `015eef5` and `36bb86e`): `src/engine/door.ts`, `src/engine/door.test.ts`, `src/engine/simulation.ts`, `src/engine/simulation.test.ts`, `src/engine/capacity.test.ts`.

## Integration Notes

- **Unit 05** (metrics) consumes `TrialRunResult[]` from `runTrialBatch` (`{algorithmId, trialIndex, result: RunSimulationResult}`) to compute and aggregate the wait/travel/throughput/occupancy metrics across trials.
- **Unit 06** (UI) constructs `Scenario` objects (the config panel's output) and calls `runTrialBatch`/`generateTrialBatch` directly; `src/scenarios/` scripted examples are ready for a "load example scenario" UI affordance.
- **A third infinite-loop bug in the existing engine was found via this unit's own testing**, not introduced by it — a full elevator stopping for a pickup it had no capacity for produced a zero-ms dwell that repeated forever, reproducing on 100% of seeds at higher load. Fixed at the engine level (`015eef5`), closing the whole zero-transaction-stop bug class rather than the specific capacity-exhaustion case. A related residual risk (`doorDwellBaseMs === 0` in a `BuildingConfig`) was also closed via input validation (`36bb86e`), per explicit developer instruction, ahead of Unit 06 ever needing it.

## Lessons Learned

The fairness-critical mechanism in this unit (one seed reproduces a whole N-trial batch, shared byte-for-byte across every algorithm) could only be properly validated by running real algorithms through the real engine under realistic load — a unit-level test against `generateTrialBatch` alone would have missed the third infinite-loop bug entirely, since that bug only manifests once genuine multi-passenger contention with capacity exhaustion occurs. This reinforces a pattern from Units 02 and 03: an end-to-end regression test that exercises the full stack under realistic conditions is worth writing even when (especially when) it's not strictly required to prove the unit's own stated contract, because it's often the only thing that surfaces bugs in the layers underneath.

Every one of this project's first four units has now found and fixed at least one real bug in already-completed work — a consistent enough pattern to treat "review previous units' assumptions under this unit's new, more realistic test conditions" as a standing, expected part of implementing each subsequent unit, not a surprise.
