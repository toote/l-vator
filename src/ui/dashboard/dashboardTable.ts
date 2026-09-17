// Upgraded comparison table -- absorbs/replaces resultsView.ts's old plain table (Unit 06).
// Sortable columns (click a header) + best-algorithm-per-metric highlighting. No charts -- see
// dev_log/07_results.md, "Dashboard content" ("Charts -- resolved: table only").

import { algorithms } from '../../algorithms';
import type { AlgorithmMetrics } from '../../metrics';
import { algorithmColorVar } from './algorithmColor';

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1);
}

/** Exported so dashboardCharts.ts (Unit 08) reuses the same algorithm-name lookup instead of
 * duplicating it. */
export function algorithmName(algorithmId: string): string {
  return algorithms.find((algorithm) => algorithm.id === algorithmId)?.name ?? algorithmId;
}

/** The subset of AlgorithmMetrics fields that are plain `number | null` (or `number`) headline
 * metrics -- the only ones sorting/best-highlighting apply to. */
export type MetricKey =
  | 'averageWaitTimeMs'
  | 'maxWaitTimeMs'
  | 'averageTravelTimeMs'
  | 'totalDistanceFloors'
  | 'throughputPerHour'
  | 'averageOccupancyWhileMovingPct'
  | 'deadheadTravelPct'
  | 'unservedCount'
  | 'unservedPct';

/**
 * Whether a lower or higher value is the "better" outcome for each headline metric -- drives both
 * bestAlgorithmId() and the table's best-per-metric highlighting. Wait/travel/distance/deadhead/
 * unserved: lower is better (less delay, less wasted movement, fewer people left behind).
 * Throughput/occupancy: higher is better (more people moved per hour, fuller cars = less wasted
 * capacity). See dev_log/07_results.md, "Dashboard content".
 */
export const METRIC_DIRECTIONS: Record<MetricKey, 'lower' | 'higher'> = {
  averageWaitTimeMs: 'lower',
  maxWaitTimeMs: 'lower',
  averageTravelTimeMs: 'lower',
  totalDistanceFloors: 'lower',
  throughputPerHour: 'higher',
  averageOccupancyWhileMovingPct: 'higher',
  deadheadTravelPct: 'lower',
  unservedCount: 'lower',
  unservedPct: 'lower',
};

/**
 * The single algorithm with the best (per `direction`) value for `key` across `metrics`, or
 * `null` when every value is null (nobody has a measurable value for that metric) or when the
 * best value is tied across two or more algorithms -- a tie has no single "best" to highlight.
 */
export function bestAlgorithmId(
  metrics: readonly AlgorithmMetrics[],
  key: MetricKey,
  direction: 'lower' | 'higher',
): string | null {
  let bestValue: number | null = null;
  let bestId: string | null = null;
  let tied = false;

  for (const m of metrics) {
    const value = m[key];
    if (value === null) continue;
    if (bestValue === null || (direction === 'lower' ? value < bestValue : value > bestValue)) {
      bestValue = value;
      bestId = m.algorithmId;
      tied = false;
    } else if (value === bestValue) {
      tied = true;
    }
  }

  return tied ? null : bestId;
}

interface ColumnDef {
  label: string;
  /** Null for non-metric columns (Algorithm name, Trials) -- not sortable, never highlighted. */
  metricKey: MetricKey | null;
  format: (m: AlgorithmMetrics) => string;
  /** Renders a small algorithmColorVar-driven swatch before the formatted text -- only the
   * Algorithm column needs the cross-view color identity added in Unit 08 (see
   * dev_log/08_charts.md, "Table integration"). Does not touch the existing best-per-metric
   * highlight logic below, which is a separate, status-encoding concern. */
  showSwatch?: boolean;
}

const COLUMNS: ColumnDef[] = [
  {
    label: 'Algorithm',
    metricKey: null,
    format: (m) => algorithmName(m.algorithmId),
    showSwatch: true,
  },
  { label: 'Trials', metricKey: null, format: (m) => String(m.trialCount) },
  {
    label: 'Avg wait (ms)',
    metricKey: 'averageWaitTimeMs',
    format: (m) => formatNumber(m.averageWaitTimeMs),
  },
  {
    label: 'Max wait (ms)',
    metricKey: 'maxWaitTimeMs',
    format: (m) => formatNumber(m.maxWaitTimeMs),
  },
  {
    label: 'Avg travel (ms)',
    metricKey: 'averageTravelTimeMs',
    format: (m) => formatNumber(m.averageTravelTimeMs),
  },
  {
    label: 'Total distance (floors)',
    metricKey: 'totalDistanceFloors',
    format: (m) => m.totalDistanceFloors.toFixed(1),
  },
  {
    label: 'Throughput (per hour)',
    metricKey: 'throughputPerHour',
    format: (m) => formatNumber(m.throughputPerHour),
  },
  {
    label: 'Avg occupancy (%)',
    metricKey: 'averageOccupancyWhileMovingPct',
    format: (m) => formatNumber(m.averageOccupancyWhileMovingPct),
  },
  {
    label: 'Deadhead (%)',
    metricKey: 'deadheadTravelPct',
    format: (m) => formatNumber(m.deadheadTravelPct),
  },
  {
    label: 'Unserved (count / %)',
    metricKey: 'unservedCount',
    format: (m) => `${m.unservedCount} (${formatNumber(m.unservedPct)})`,
  },
];

// Module-scoped sort state -- a small, purely presentational bit of UI state that persists
// across re-renders without extending AppState (nothing outside this table needs to know the
// current sort), the same pragmatic pattern this codebase already uses for other UI-only,
// non-AppState concerns.
let sortKey: MetricKey | null = null;
let sortDirection: 'asc' | 'desc' = 'asc';

function sortedMetrics(metrics: readonly AlgorithmMetrics[]): AlgorithmMetrics[] {
  if (!sortKey) return [...metrics];
  const key = sortKey;
  const sign = sortDirection === 'asc' ? 1 : -1;
  return [...metrics].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls always sort last, regardless of direction
    if (bv === null) return -1;
    return (av - bv) * sign;
  });
}

export function renderDashboardTable(
  metrics: AlgorithmMetrics[],
  render: () => void,
): HTMLTableElement {
  const table = document.createElement('table');

  const bestByColumn = new Map<MetricKey, string | null>();
  for (const column of COLUMNS) {
    if (column.metricKey) {
      bestByColumn.set(
        column.metricKey,
        bestAlgorithmId(metrics, column.metricKey, METRIC_DIRECTIONS[column.metricKey]),
      );
    }
  }

  const headerRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    let label = column.label;
    if (column.metricKey && sortKey === column.metricKey) {
      label += sortDirection === 'asc' ? ' ▲' : ' ▼';
    }
    th.textContent = label;
    if (column.metricKey) {
      const key = column.metricKey;
      th.style.cursor = 'pointer';
      th.onclick = () => {
        if (sortKey === key) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDirection = 'asc';
        }
        render();
      };
    }
    headerRow.appendChild(th);
  }
  table.appendChild(headerRow);

  for (const row of sortedMetrics(metrics)) {
    const tr = document.createElement('tr');
    for (const column of COLUMNS) {
      const td = document.createElement('td');
      if (column.showSwatch) {
        const swatch = document.createElement('span');
        swatch.style.display = 'inline-block';
        swatch.style.width = '10px';
        swatch.style.height = '10px';
        swatch.style.borderRadius = '50%';
        swatch.style.marginRight = '0.4rem';
        swatch.style.verticalAlign = 'middle';
        // Same algorithmColorVar helper as the charts (Unit 08) -- same blue dot beside "FCFS"
        // here and on every chart bar, without overloading the highlight below's status meaning.
        swatch.style.background = algorithmColorVar(row.algorithmId);
        td.appendChild(swatch);
        td.appendChild(document.createTextNode(column.format(row)));
      } else {
        td.textContent = column.format(row);
      }
      if (column.metricKey && bestByColumn.get(column.metricKey) === row.algorithmId) {
        td.style.fontWeight = 'bold';
        // Derived purely from --text/--bg (no hardcoded color) so the highlight stays correct
        // in dark mode too.
        td.style.background = 'color-mix(in srgb, var(--text) 12%, var(--bg))';
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  return table;
}
