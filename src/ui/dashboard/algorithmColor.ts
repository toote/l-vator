// Assigns each algorithm a fixed, stable color-slot CSS variable, keyed by the algorithm's index
// in an explicit, hand-maintained COLOR_ORDER -- never by its position in a particular run's
// (possibly-filtered) AlgorithmMetrics[], and never by `algorithms`' own import.meta.glob-derived
// order either. `selectedAlgorithmIds` means a run's AlgorithmMetrics[] may contain any subset of
// the registry; keying by a fixed index instead of array position means re-running with a
// different algorithm subset never repaints a surviving algorithm's color -- the direct fix for
// the dataviz skill's "recolor-on-filter" anti-pattern ("a reader who learned 'Acme is blue' is
// now misled... color follows the entity, not its row number"). See dev_log/08_charts.md, "Color:
// consistent per-algorithm identity across all four charts".
//
// Unit 08 shipped this keyed off `algorithms.findIndex(...)` (import.meta.glob's file-glob key
// order, effectively alphabetical by filename) and explicitly flagged that as a "forward-looking
// limitation": a new algorithm file sorting alphabetically before an existing one would silently
// shift that existing one's color. Unit 10 fixed that live: COLOR_ORDER is an explicit,
// hand-maintained, append-only list of algorithm ids -- append a new algorithm's id to the end,
// never insert it alphabetically.
//
// Unit 11 removed `fcfs-nearest-car`/`fcfs-nearest-car-homing` from the registry entirely (see
// dev_log/11_algorithm_expansion.md) and added eight new algorithms. Removing an id from the
// middle of an index-keyed list unavoidably shifts every later id's index -- unlike an insertion,
// there's no append-only way to delete without shifting -- so `nearest-car-directional` and
// `scan-look` (and their homing variants) now sit at different COLOR_ORDER indices than before
// (their actual hex VALUES are unchanged; see style.css). This is an accepted, explicit
// consequence of the developer's own removal request, not a silent recolor-on-filter regression.
// The four survivors keep their original relative order; the eight new ids are appended after,
// grouped by algorithm family (zoning's four variants, then ETA's two, then random's two).
const COLOR_ORDER: readonly string[] = [
  'nearest-car-directional',
  'scan-look',
  'nearest-car-directional-homing',
  'scan-look-homing',
  'zoning',
  'zoning-homing',
  'zoning-fallback',
  'zoning-fallback-homing',
  'eta-dispatch',
  'eta-dispatch-homing',
  'random-dispatch',
  'random-dispatch-homing',
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
