// Minimal plain results readout + error banner. See dev_log/06_ui.md, "Run controls and the
// minimal results readout" -- deliberately plain per this unit's scope-boundary resolution: no
// charts, no color-coding, no sorting/highlighting, no per-run replay selector (that's Unit 07).

import { algorithms } from '../algorithms';
import type { AlgorithmMetrics } from '../metrics';
import type { AppState } from './types';

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1);
}

function algorithmName(algorithmId: string): string {
  return algorithms.find((algorithm) => algorithm.id === algorithmId)?.name ?? algorithmId;
}

const COLUMNS = [
  'Algorithm',
  'Trials',
  'Avg wait (ms)',
  'Max wait (ms)',
  'Avg travel (ms)',
  'Total distance (floors)',
  'Throughput (per hour)',
  'Avg occupancy (%)',
  'Deadhead (%)',
  'Unserved (count / %)',
];

function metricsRow(metrics: AlgorithmMetrics): string[] {
  return [
    algorithmName(metrics.algorithmId),
    String(metrics.trialCount),
    formatNumber(metrics.averageWaitTimeMs),
    formatNumber(metrics.maxWaitTimeMs),
    formatNumber(metrics.averageTravelTimeMs),
    metrics.totalDistanceFloors.toFixed(1),
    formatNumber(metrics.throughputPerHour),
    formatNumber(metrics.averageOccupancyWhileMovingPct),
    formatNumber(metrics.deadheadTravelPct),
    `${metrics.unservedCount} (${formatNumber(metrics.unservedPct)})`,
  ];
}

function renderResultsTable(metrics: AlgorithmMetrics[]): HTMLTableElement {
  const table = document.createElement('table');

  const headerRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = column;
    headerRow.appendChild(th);
  }
  table.appendChild(headerRow);

  for (const row of metrics) {
    const tr = document.createElement('tr');
    for (const cell of metricsRow(row)) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  return table;
}

export function renderResultsView(state: AppState): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Results';
  section.appendChild(heading);

  const { run } = state;

  if (run.status === 'idle') {
    const message = document.createElement('p');
    message.textContent = 'Configure a scenario above and click Run to see results.';
    section.appendChild(message);
    return section;
  }

  if (run.status === 'running') {
    const message = document.createElement('p');
    message.textContent = 'Running...';
    section.appendChild(message);
    return section;
  }

  if (run.status === 'error') {
    const message = document.createElement('p');
    message.textContent = `Error: ${run.message}`;
    section.appendChild(message);
    return section;
  }

  section.appendChild(renderResultsTable(run.metrics));
  return section;
}
