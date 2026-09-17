// Dashboard orchestrator: renders the (sortable, best-algorithm-highlighted) comparison table.
// See dev_log/07_results.md, "File layout". No charts in this unit.

import type { AlgorithmMetrics } from '../../metrics';
import { renderDashboardTable } from './dashboardTable';

export function renderDashboardView(metrics: AlgorithmMetrics[], render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h3');
  heading.textContent = 'Dashboard';
  section.appendChild(heading);

  section.appendChild(renderDashboardTable(metrics, render));
  return section;
}
