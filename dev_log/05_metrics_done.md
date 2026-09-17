# Unit 05: Metrics - Completion Context

## What Was Implemented

The metrics-computation layer under `src/metrics/`: eight headline metrics per algorithm — average wait time, average travel time, max wait time, total elevator distance traveled, throughput, average occupancy while moving, empty/deadhead-travel percentage, and unserved passenger count/percentage — each pooled correctly across all N seeded trials in a batch. Recovers per-passenger arrival times (needed for wait time, since a fully-served passenger's `Passenger` object is discarded by the engine on alighting) by regenerating the deterministic trial batch via Unit 04's `generateTrialBatch`, matched strictly per `trialIndex` to avoid id collisions across trials in a `RandomScenario`.

## Key Decisions

- Never-served passengers: average wait/travel time excludes them; max wait time includes everyone via a censored (`simTime - arrivalTime`) lower bound, since a worst-case metric shouldn't silently exclude the passengers most likely to represent algorithm failure.
- Unserved count/percentage promoted to an explicit eighth headline metric (`unservedCount`/`unservedPct`), not left buried in the `ServedCounts` breakdown — added per developer request during plan review.
- Max wait time: true max-across-all-trials as the headline number, with `meanOfPerTrialMaxWaitTimeMs` shipped alongside as a supporting stat.
- Cross-trial aggregation: pooling (sum numerator/denominator, divide once) for every ratio-shaped metric, using the statistically correct weight per metric — passenger counts for wait/travel time, elapsed hours for throughput, hop-count for occupancy/deadhead percentage. A naive mean-of-per-trial-ratios would have implicitly given a 3-passenger trial the same weight as a 300-passenger one.
- Per-passenger arrival time recovered via batch regeneration rather than an engine log-format change — zero cross-unit modifications, at the cost of a documented, accepted alternative recorded for any future refactor.

## Deviations from Plan

None in the core design — every algorithm (wait/travel classification, distance/occupancy reconstruction, pooling weights) is implemented exactly as specified and independently re-verified during review. Two implementation-level choices the plan intentionally left open: `PassengerRecord` is a discriminated union on `status` (not optional fields, forcing callers to narrow via status checks rather than non-null assertions), and `aggregate.ts`'s pooling reconstructs each trial's numerator as `(stored ratio) × (that trial's own weight)` since `TrialMetrics` stores already-computed ratios rather than raw sums — mathematically exact, not an approximation.

## Files Modified

Created: `src/metrics/types.ts`, `passengerRecords.ts`, `distanceOccupancy.ts`, `throughput.ts`, `trialMetrics.ts`, `aggregate.ts`, `computeMetrics.ts`, `index.ts`, five test files, `dev_log/05_metrics_test.md`. Modified: `dev_log/05_metrics.md`. No files outside `src/metrics/` and `dev_log/` were touched — this unit is pure computation over Units 02/04's already-produced results.

## Integration Notes

- **Unit 06** (UI) is the primary consumer of `AlgorithmMetrics[]` for a comparison dashboard/table, and constructs `Scenario` objects to feed both `runTrialBatch` and `computeMetrics`.
- **Unit 07** (replay) uses `AlgorithmMetrics.perTrial: TrialMetrics[]` for a specific run's own numbers (e.g. "Run 7 of 20").
- The trial-index-scoped matching in `computeMetrics.ts` is directly regression-tested against real generator output proving id collisions across trials exist and are handled correctly, not just asserted by inspection.

## Lessons Learned

This is the fifth consecutive unit where careful review (both during planning and after implementation) caught something worth fixing before commit — here, confirming the pooling weights were metric-specific and correctly chosen (passenger-count vs. hours vs. hop-count) rather than trusting a single generic reconstruction to be right everywhere. A pooling implementation that "runs and produces plausible numbers" is not the same as one that's verified correct per metric; the difference is invisible without deliberately checking each weight choice against what that metric's ratio actually means.
