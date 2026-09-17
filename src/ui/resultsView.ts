// Top-level "Results" section. idle/running/error messages unchanged verbatim from Unit 06; the
// 'done' branch now renders the dashboard (comparison table) + replay (animated cross-section)
// views instead of Unit 06's old inline plain table -- see dev_log/07_results.md.

import { renderDashboardView } from './dashboard/dashboardView';
import { renderReplayView } from './replay/replayView';
import type { AppState } from './types';

export function renderResultsView(state: AppState, render: () => void): HTMLElement {
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

  section.appendChild(renderDashboardView(run.metrics, render));
  section.appendChild(renderReplayView(state, render));
  return section;
}
