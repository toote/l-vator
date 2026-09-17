// Assigns each algorithm a fixed, stable color-slot CSS variable, keyed by the algorithm's index
// in the full algorithm registry (src/algorithms/index.ts) -- never by its position in a
// particular run's (possibly-filtered) AlgorithmMetrics[]. `selectedAlgorithmIds` means a run's
// AlgorithmMetrics[] may contain any subset of the registry; keying by registry index instead of
// array position means re-running with a different algorithm subset never repaints a surviving
// algorithm's color -- the direct fix for the dataviz skill's "recolor-on-filter" anti-pattern
// ("a reader who learned 'Acme is blue' is now misled... color follows the entity, not its row
// number"). See dev_log/08_charts.md, "Color: consistent per-algorithm identity across all four
// charts".
//
// Forward-looking limitation (not fixed here -- see dev_log/08_charts.md for the full note):
// `algorithms`' order comes from `import.meta.glob`'s file-glob key order, effectively
// alphabetical by filename, not a hand-assigned stable index. Adding a new algorithm file can
// shift an *existing* algorithm's index (and therefore its color) if the new filename sorts
// alphabetically before it. Not a live problem today (exactly 3 algorithms); a fully stable
// scheme would need an explicit, hand-maintained algorithmId -> slot mapping, which is a bigger
// call than this unit makes unilaterally.

import { algorithms } from '../../algorithms';

/**
 * The algorithm's fixed position in the full registry, independent of any run's filtered
 * AlgorithmMetrics[] order. -1 if `algorithmId` isn't a registered algorithm (not expected in
 * practice -- every algorithmId flowing through the dashboard comes from a real run against a
 * registered algorithm).
 */
export function algorithmRegistryIndex(algorithmId: string): number {
  return algorithms.findIndex((algorithm) => algorithm.id === algorithmId);
}

/**
 * CSS custom property (e.g. "var(--series-2)") for an algorithm's fixed color slot, keyed by its
 * index in the full algorithm registry.
 */
export function algorithmColorVar(algorithmId: string): string {
  return `var(--series-${algorithmRegistryIndex(algorithmId) + 1})`;
}
