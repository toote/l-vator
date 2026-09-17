// Pure: AlgorithmMetrics[] -> per-chart bar data for the four charted metrics (average wait time,
// max wait time, throughput, unserved%). See dev_log/08_charts.md, "Which metrics get charts" and
// "Null-valued metrics". No DOM here -- src/ui/dashboard/dashboardCharts.ts renders this output.

import type { AlgorithmMetrics } from '../../metrics';
import { algorithmRegistryIndex } from './algorithmColor';

/** The four AlgorithmMetrics fields charted in this unit -- see dev_log/08_charts.md, "Which
 * metrics get charts -- revise Unit 07's three to four". */
export type ChartedMetricKey =
  'averageWaitTimeMs' | 'maxWaitTimeMs' | 'throughputPerHour' | 'unservedPct';

export interface ChartBar {
  algorithmId: string;
  /** Raw metric value for this algorithm/metric. `null` when there's nothing to compute (e.g.
   * nobody was served, so there's no average to take) -- the same case `dashboardTable.ts`'s
   * `formatNumber` renders as "n/a". */
  value: number | null;
  /** This bar's length, 0..1 relative to the panel's own max. `null` exactly when `value` is
   * `null` -- never a `0` standing in for "no data": a real value of `0` still gets a real
   * proportion of `0` (an actual zero-length bar), which is a different, meaningful case from
   * "n/a". See dev_log/08_charts.md, "Null-valued metrics: omit the fill, show a visible n/a". */
  proportion: number | null;
}

export interface ChartPanel {
  metricKey: ChartedMetricKey;
  label: string;
  /** Formats a non-null value for direct display at a bar's tip (the panel owns its own units/
   * precision, mirroring dashboardTable.ts's per-column `format`). Never called for a `null`
   * value -- callers render "n/a" instead. */
  formatValue: (value: number) => string;
  /** This panel's own max across non-null values in `bars` -- `0` when every value is `null` or
   * every real value is `0`. Proportions are computed relative to this, never a global/shared
   * max, since the four metrics have different units and scales. */
  max: number;
  /** One bar per algorithm, in the same fixed registry order for every panel (see
   * algorithmColor.ts) -- never sorted by value, so a reader can always find the same algorithm
   * in the same row across all four panels. */
  bars: ChartBar[];
}

interface ChartMetricDef {
  key: ChartedMetricKey;
  label: string;
  formatValue: (value: number) => string;
}

const CHARTED_METRICS: readonly ChartMetricDef[] = [
  {
    key: 'averageWaitTimeMs',
    label: 'Average wait time',
    formatValue: (v) => `${v.toFixed(0)} ms`,
  },
  { key: 'maxWaitTimeMs', label: 'Max wait time', formatValue: (v) => `${v.toFixed(0)} ms` },
  { key: 'throughputPerHour', label: 'Throughput', formatValue: (v) => `${v.toFixed(1)}/hr` },
  { key: 'unservedPct', label: 'Unserved', formatValue: (v) => `${v.toFixed(1)}%` },
];

/** Fixed registry order, not the order `metrics` happens to arrive in (which follows
 * `selectedAlgorithmIds`, an arbitrary subset/order of the registry). See algorithmColor.ts. */
function orderByRegistry(metrics: readonly AlgorithmMetrics[]): AlgorithmMetrics[] {
  return [...metrics].sort(
    (a, b) => algorithmRegistryIndex(a.algorithmId) - algorithmRegistryIndex(b.algorithmId),
  );
}

function computePanel(ordered: readonly AlgorithmMetrics[], def: ChartMetricDef): ChartPanel {
  const max = ordered.reduce((acc, m) => {
    const value = m[def.key];
    return value === null ? acc : Math.max(acc, value);
  }, 0);

  const bars: ChartBar[] = ordered.map((m) => {
    const value = m[def.key];
    if (value === null) return { algorithmId: m.algorithmId, value: null, proportion: null };
    // max === 0 here means every real (non-null) value for this metric is 0 -- render every real
    // value as an actual zero-length bar (proportion 0), not a divide-by-zero NaN.
    const proportion = max === 0 ? 0 : value / max;
    return { algorithmId: m.algorithmId, value, proportion };
  });

  return { metricKey: def.key, label: def.label, formatValue: def.formatValue, max, bars };
}

/** Turns a run's AlgorithmMetrics[] into the four small-multiple chart panels' bar data, each
 * row-aligned in fixed registry order. Handles the all-null (every algorithm's value is null for
 * that metric -- no divide by zero, every row "n/a") and all-zero (every algorithm has a real 0
 * -- real zero-length bars, not "n/a") edge cases explicitly; see dev_log/08_charts.md, "What
 * gets tested". */
export function computeChartPanels(metrics: readonly AlgorithmMetrics[]): ChartPanel[] {
  const ordered = orderByRegistry(metrics);
  return CHARTED_METRICS.map((def) => computePanel(ordered, def));
}
