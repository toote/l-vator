// Dashboard orchestrator: renders the four chart panels above the (sortable,
// best-algorithm-highlighted) comparison table -- same data at different grain, shown in
// sequence, not tabs/toggle. See dev_log/08_charts.md, "Layout: charts above the table".

import type { AlgorithmMetrics } from '../../metrics';
import { renderDashboardCharts } from './dashboardCharts';
import { renderDashboardTable } from './dashboardTable';

export function renderDashboardView(metrics: AlgorithmMetrics[], render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h3');
  heading.textContent = 'Dashboard';
  section.appendChild(heading);

  section.appendChild(renderDashboardCharts(metrics));
  section.appendChild(renderDashboardTable(metrics, render));
  return section;
}
