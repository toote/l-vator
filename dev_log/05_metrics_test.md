# Unit 05: Metrics - Test Instructions

## Test Objectives

Verify that the metrics-computation layer under `src/metrics/` correctly implements the approved plan (`05_metrics.md`), including its developer-requested addition (the `unservedCount`/`unservedPct` eighth headline metric):

- **`passengerRecords.ts`**: correct per-passenger classification (`served` / `boardedOnly` / `neverBoarded`) from a trial's regenerated arrivals + log, with exact `waitTimeMs`/`travelTimeMs`/`censoredWaitMs` values, and consistency with `finalState`'s own ground truth.
- **`distanceOccupancy.ts`**: correct per-elevator log-replay hop reconstruction — the trickiest logic in the unit (occupancy attributed at the moment each `elevatorArrived` fires must reflect who was carried across the hop that just completed, not who's about to board/alight at the new floor) — plus `null` (not `0`/`NaN`) handling for zero hops.
- **`throughput.ts`**: exact division using `finalState.time` as the denominator, `null` for `finalState.time === 0`.
- **`aggregate.ts`**: pooled (not naively averaged) cross-trial aggregation for every ratio metric, true max-across-all-trials for `maxWaitTimeMs` with `meanOfPerTrialMaxWaitTimeMs` alongside, simple mean for `totalDistanceFloors`, and summed `unservedCount`/`servedCounts` with `unservedPct` recomputed from the summed totals.
- **`computeMetrics.ts`**: the public entry point — groups by `algorithmId`, calls `generateTrialBatch(scenario)` exactly once, and — the sharpest correctness risk in this unit — matches each `TrialRunResult` against **only its own `trialIndex`**'s regenerated arrivals, never flattening/merging across trials (real risk: `RandomScenario` arrival ids like `"arrival-0"` repeat across different trial indices with different underlying data).
- **Null handling** throughout: `null`, never `NaN`/`0`, for every "no data" case (zero hops, zero served passengers, zero-total percentage denominators, `finalState.time === 0`).

## Manual Tests

None. Like Units 02-04, this unit is headless computation over already-produced simulation results, with no UI (Unit 06/07 will eventually consume this layer's output) — there is nothing to click through. All verification is automated.

## Automated Tests

Run via `npm run test` (Vitest). **107 tests across 20 files, all passing** — 82 pre-existing from Units 02-04, **25 new for this unit**, completing in ~0.2s (no hangs).

- **`src/metrics/passengerRecords.test.ts`** (6 tests)
  - A hand-built `arrivals` array + hand-built log covering all three statuses: exact `waitTimeMs`/`travelTimeMs` for a served passenger, exact `waitTimeMs` (no `travelTimeMs`) for a boarded-not-alighted passenger, exact `censoredWaitMs` (no `waitTimeMs`/`travelTimeMs`) for a never-boarded passenger.
  - Exactly one record per arrival, in arrival order.
  - **Consistency check**: the `neverBoarded` record's id matches a hand-built `finalState.waitingPassengers`' id; the `boardedOnly` record's id matches a hand-built `finalState.elevators[].onboard`'s id — the ground-truth cross-check named explicitly in the plan.

- **`src/metrics/distanceOccupancy.test.ts`** (4 tests)
  - A hand-built single-elevator log with a known 4-hop sequence (`[4, 2, 2, 0]` occupancy, capacity 4) — asserts exact `totalDistanceFloors` (4), `averageOccupancyWhileMovingPct` (50), `deadheadTravelPct` (25), all computed by hand from the occupancy sequence.
  - A two-elevator case proving hops pool correctly across elevators (`[2, 0]` -> 25% avg occupancy, 50% deadhead).
  - A zero-hops case (log with no `elevatorArrived` entries) asserting `null` for both percentages (not `0`/`NaN`), `0` for `totalDistanceFloors`.
  - An empty-log edge case.

- **`src/metrics/throughput.test.ts`** (4 tests)
  - Two exact hand-computed divisions (10 served / 30 min -> 20/hr; 3 served / 45 min -> 4/hr).
  - `servedCount === 0` with nonzero elapsed time returns `0`, not `null`.
  - `finalTimeMs === 0` returns `null` (not `NaN`/`Infinity`), regardless of `servedCount`.

- **`src/metrics/aggregate.test.ts`** (7 tests)
  - Throws on an empty `TrialMetrics[]` (no `algorithmId` to report).
  - **Pooled vs. naive average wait**: a 2-passenger trial (avg 100ms) and a 20-passenger trial (avg 1000ms) pool to `20200/22 ≈ 918.18`, asserted against that exact value and shown to differ from the naive mean-of-averages (550) — proving pooling, not per-trial averaging, is what's implemented.
  - **Max wait time**: a 3-trial fixture (`500`, `9000`, `200`) asserts `maxWaitTimeMs === 9000` (true max) and `meanOfPerTrialMaxWaitTimeMs ≈ 3233.33`, and that the two differ — both defensible definitions computed correctly and distinctly, per the developer's resolution.
  - **`unservedCount`/`unservedPct` pooling**: a 10-passenger trial (2 unserved, 20%) and a 100-passenger trial (50 unserved, 50%) sum to `unservedCount 52`/`servedCounts.total 110`, with `unservedPct` recomputed as `52/110*100 ≈ 47.27%` — asserted to differ from the naive mean of per-trial percentages (35%), proving the same pooling principle applies to the new 8th headline metric, not just the pre-existing ratio metrics.
  - Throughput/occupancy/deadhead pooling by their own weights (elapsed hours, hop counts respectively) — a bonus test beyond the plan's explicit bullet list, added for full coverage of every pooled ratio metric.
  - `totalDistanceFloors` is a simple mean of per-trial totals (not pooled) — verified alongside the above.
  - `perTrial` is retained in full, sorted by `trialIndex` regardless of input order; `trialCount`/`algorithmId` reported correctly.

- **`src/metrics/computeMetrics.test.ts`** (5 tests)
  - **End-to-end hand-traceable scenario** (the "hand-traceable small scenario" style established in Units 02-04): a hand-authored `ScriptedScenario` (2 floors, 1 elevator, a hand-written test dispatch hook — not a real algorithm, matching Unit 02/03's own pattern), 2 identical trials, cut off by a deliberately tight `maxTimeMs` (9000ms) that stops one passenger mid-boarding (`boardedOnly`) and strands another before pickup (`neverBoarded`). The full event trace was independently verified against the real engine (`runSimulation`) before being hardcoded into the test's expected values (see the test file's comment block for the full timeline). Asserts **every one of the 8 headline metrics** (`averageWaitTimeMs`, `maxWaitTimeMs`, `averageTravelTimeMs`, `totalDistanceFloors`, `throughputPerHour`, `averageOccupancyWhileMovingPct`, `deadheadTravelPct`, `unservedCount`/`unservedPct`) plus `ServedCounts`, at both the per-trial (`TrialMetrics`) and aggregated (`AlgorithmMetrics`) level, against hand-computed exact values (`unservedCount: 2`/`unservedPct: 50%` per trial — explicitly non-trivial, not `0`/`null`, per the plan's requirement).
  - **Regenerated-batch correctness — invariant check**: for a `ScriptedScenario`, `generateTrialBatch(scenario)` reproduces the script byte-for-byte (`batch[0]` deep-equals `scenario.script`), and every `passengerBoarded` log entry's time is `>=` that passenger's own regenerated `arrivalTime` — a direct regression guard on the unit's core "regenerate arrivals to recover per-passenger timing" design decision.
  - **Regenerated-batch correctness — trialIndex-scoping regression test** (the sharpest risk named in the implementation brief): a `RandomScenario` with 2 trials, confirmed via the actual generator output to produce a *different-length* arrivals array per trial while still sharing colliding ids (`"arrival-0"` exists in both trials, with different underlying data — verified directly in the test). Deliberately computes trial 0's `TrialMetrics` against trial 1's regenerated arrivals (`computeTrialMetrics(trial0Result, batch[1], ...)`) and shows this "wrong scoping" produces a different `servedCounts.total` than the correct (same-index) computation — then asserts `computeMetrics`'s own internal `perTrial[0]` matches the **correct** computation exactly, and does *not* match the wrong one. This is the concrete proof that `computeMetrics.ts` never flattens/merges arrivals across trial indices.

Full verification commands and results at implementation time:

| Command | Result |
|---|---|
| `npm run lint` | Pass, no warnings/errors |
| `npm run format` / `npm run format:check` | Pass (new files were auto-formatted once on first `format` pass, `format:check` clean afterward) |
| `npm run test` | Pass — 20 files, 107 tests (82 pre-existing + 25 new), ~0.2s wall time |
| `npm run build` | Pass (`tsc -b` type-checks clean under strict mode with no `any`/unjustified non-null assertions; `vite build` succeeds) |

## Integration Checks

- **`src/metrics/*` imports only from `src/engine` (types) and `src/generation` (`Scenario`, `TrialRunResult`, `generateTrialBatch`)** — verified by inspection of every file's imports; nothing under `src/metrics/` imports from `src/algorithms`, and `src/engine/`, `src/algorithms/`, `src/generation/` were not modified by this unit (test files hand-write their own local dispatch hooks/`Algorithm`-shaped objects rather than importing real algorithms, matching Unit 02/03's own test style).
- **`computeMetrics` calls `generateTrialBatch(scenario)` exactly once**, not once per trial result — verified directly by the end-to-end test running 2 trials through one `computeMetrics` call and by the regenerated-batch test's explicit single call used both to build the comparison fixture and to independently verify `computeMetrics`'s internal result.
- **Occupancy-per-hop event ordering** (`elevatorArrived` always logged before the boarding/alighting that follows it once doors open) — re-derived from the plan's pseudocode precisely and cross-checked against `simulation.ts`'s actual `handleElevatorArrived`/`handleStop` implementation; the hand-traced end-to-end scenario's `averageOccupancyWhileMovingPct`/`deadheadTravelPct` values were confirmed against the real engine's actual log output before being hardcoded (see `computeMetrics.test.ts`'s trace comment).
- **Null vs. `0`/`NaN` handling** — every "no data" case (`distanceOccupancy` zero hops, `throughput` zero elapsed time, `aggregate`/`trialMetrics` zero-count percentage denominators) has a dedicated test asserting `null`, not `0` or `NaN`.
- **No `any`, no unjustified non-null assertions** — `PassengerRecord` is a discriminated union on `status` (rather than one shape with optional fields), so every consumer narrows via `status` checks/type predicates instead of `!` assertions; verified by `tsc -b` under `strict` mode passing with zero suppressions.

## Success Criteria

- All 107 automated tests pass under `npm run test`, completing quickly with no hangs.
- `npm run lint`, `npm run format:check`, and `npm run build` all pass with no errors or warnings.
- The developer has reviewed `src/metrics/` against the approved plan in `05_metrics.md` (per-passenger classification, distance/occupancy reconstruction, throughput, pooled aggregation including the new `unservedCount`/`unservedPct` headline metric, and the `computeMetrics` entry point's trialIndex-scoped batch regeneration) and confirms it matches.
- The developer confirms `computeMetrics.test.ts`'s end-to-end scenario and its two regenerated-batch-correctness tests are convincing evidence that (a) all 8 headline metrics are computed correctly end-to-end against a fully hand-traceable scenario, and (b) the trialIndex-scoping risk flagged in the plan (colliding passenger ids across `RandomScenario` trials) is actually closed, not just assumed closed.
