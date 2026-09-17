// Per-trial throughput. See dev_log/05_metrics.md, "Throughput (throughput.ts)".
//
// Uses the trial's own elapsed simulated time (finalState.time) as the denominator, not
// scenario.durationMs -- deliberate, so an algorithm that needs the full maxTimeMs safety cutoff
// to finish (or doesn't finish at all) is penalized with a lower throughput rather than flattered
// by a denominator that ignores how long the run actually took. `servedCount` is passengers who
// both boarded AND alighted -- see "Never-served passengers" in the plan for why not
// boardedOnly/total arrivals.

export const MS_PER_HOUR = 3_600_000;

export function computeThroughputPerHour(servedCount: number, finalTimeMs: number): number | null {
  if (finalTimeMs === 0) return null;
  return servedCount / (finalTimeMs / MS_PER_HOUR);
}
