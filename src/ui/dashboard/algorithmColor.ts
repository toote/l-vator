// Assigns each algorithm a fixed, stable color-slot CSS variable, keyed by the algorithm's index
// in an explicit, hand-maintained COLOR_ORDER -- never by its position in a particular run's
// (possibly-filtered) AlgorithmMetrics[], and (as of Unit 10) never by `algorithms`' own
// import.meta.glob-derived order either. `selectedAlgorithmIds` means a run's AlgorithmMetrics[]
// may contain any subset of the registry; keying by a fixed index instead of array position means
// re-running with a different algorithm subset never repaints a surviving algorithm's color --
// the direct fix for the dataviz skill's "recolor-on-filter" anti-pattern ("a reader who learned
// 'Acme is blue' is now misled... color follows the entity, not its row number"). See
// dev_log/08_charts.md, "Color: consistent per-algorithm identity across all four charts".
//
// Unit 08 shipped this keyed off `algorithms.findIndex(...)` (import.meta.glob's file-glob key
// order, effectively alphabetical by filename) and explicitly flagged that as a "forward-looking
// limitation": a new algorithm file sorting alphabetically before an existing one would silently
// shift that existing one's color. Unit 10 makes that live -- sorting all 6 filenames
// alphabetically interleaves each `*Homing.ts` file immediately after its base counterpart (e.g.
// `nearestCarDirectional.ts` shifts from glob-index 1 -> 2), which would have silently repainted
// both `nearestCarDirectional` and `scanLook`. Fixed here, as Unit 08 anticipated: COLOR_ORDER is
// an explicit, hand-maintained, append-only list of algorithm ids. The three original ids come
// first, in their original order -- guaranteeing their colors are unchanged by this unit -- and
// the three new homing ids are appended after. Adding a 7th algorithm in the future: append its id
// to the end of this list, never insert it alphabetically.
const COLOR_ORDER: readonly string[] = [
  'fcfs-nearest-car',
  'nearest-car-directional',
  'scan-look',
  'fcfs-nearest-car-homing',
  'nearest-car-directional-homing',
  'scan-look-homing',
];

/**
 * The algorithm's fixed position in COLOR_ORDER, independent of any run's filtered
 * AlgorithmMetrics[] order AND independent of `algorithms`' own glob-derived order. -1 if
 * `algorithmId` isn't listed in COLOR_ORDER (not expected in practice -- every algorithmId
 * flowing through the dashboard comes from a real run against a registered algorithm, and every
 * registered algorithm is listed in COLOR_ORDER).
 */
export function algorithmRegistryIndex(algorithmId: string): number {
  return COLOR_ORDER.indexOf(algorithmId);
}

/**
 * CSS custom property (e.g. "var(--series-2)") for an algorithm's fixed color slot, keyed by its
 * index in the full algorithm registry.
 */
export function algorithmColorVar(algorithmId: string): string {
  return `var(--series-${algorithmRegistryIndex(algorithmId) + 1})`;
}
