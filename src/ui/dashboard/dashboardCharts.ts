// DOM: renders the shared algorithm-color legend + four horizontal bar-chart small multiples
// (average wait, max wait, throughput, unserved%) from dashboardChartData.ts's pure per-panel bar
// data. Colors are driven entirely by CSS custom properties (--series-N / --text / --bg /
// color-mix) -- no hardcoded colors -- following replayCrossSection.ts's established scoped
// <style> block, CSS-custom-property-driven DOM pattern (no framework/library). See
// dev_log/08_charts.md, "Implementation mechanics", "Layout", and the dataviz skill's
// marks-and-anatomy.md / interaction.md.
//
// Rebuilt fully on every call (like dashboardTable.ts, not patched frame-by-frame like the
// replay's animation loop) -- these panels have no continuous animation, so there's no need for
// replayCrossSection.ts's imperative update(frame) split.

import type { AlgorithmMetrics } from '../../metrics';
import { algorithmColorVar } from './algorithmColor';
import { computeChartPanels, type ChartBar, type ChartPanel } from './dashboardChartData';
import { algorithmName } from './dashboardTable';

const BAR_TRACK_HEIGHT_PX = 16;

export function renderDashboardCharts(metrics: AlgorithmMetrics[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'dashboard-charts';

  // Static styling, injected once per render -- classed elements, all colors via
  // var(--text)/var(--bg)/var(--series-N)/color-mix, matching replayCrossSection.ts's pattern.
  const style = document.createElement('style');
  style.textContent = `
    .dashboard-charts { margin-bottom: 1.5rem; }
    .chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.9rem;
      margin-bottom: 0.9rem;
      font-size: 0.85rem;
    }
    .chart-legend-item { display: flex; align-items: center; gap: 0.35rem; }
    .chart-legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: none;
    }
    .chart-panels {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .chart-panel {
      border: 1px solid color-mix(in srgb, var(--text) 20%, var(--bg));
      border-radius: 6px;
      padding: 0.75rem;
      box-sizing: border-box;
      min-width: 0;
    }
    .chart-panel h4 { margin: 0 0 0.6rem 0; font-size: 0.9rem; }
    .chart-rows { display: flex; flex-direction: column; gap: 0.55rem; }
    .chart-row {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.15rem;
      border-radius: 4px;
      cursor: default;
    }
    .chart-row:focus-visible {
      outline: 2px solid var(--text);
      outline-offset: 2px;
    }
    .chart-row-label {
      font-size: 0.78rem;
      /* Label gets the panel's full width on its own line (rather than a squeezed grid column)
         so long algorithm names wrap at word boundaries, never mid-word -- see
         marks-and-anatomy.md, "never rotated, wraps naturally if needed -- never clipped". */
      overflow-wrap: normal;
    }
    .chart-row-main {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .chart-row-track {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
      height: ${BAR_TRACK_HEIGHT_PX}px;
      border-left: 1px solid color-mix(in srgb, var(--text) 30%, var(--bg));
    }
    .chart-bar {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      border-radius: 0 4px 4px 0;
      transition: filter 0.1s ease;
    }
    .chart-row:hover .chart-bar,
    .chart-row:focus-visible .chart-bar {
      filter: brightness(1.15);
    }
    .chart-row-value {
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      text-align: right;
      flex: none;
    }
    .chart-row-value.chart-value-na { color: color-mix(in srgb, var(--text) 55%, var(--bg)); }
    .chart-tooltip {
      position: fixed;
      transform: translate(-50%, -100%);
      margin-top: -6px;
      background: var(--bg);
      color: var(--text);
      border: 1px solid color-mix(in srgb, var(--text) 35%, var(--bg));
      border-radius: 4px;
      padding: 0.3rem 0.5rem;
      font-size: 0.78rem;
      pointer-events: none;
      white-space: nowrap;
      z-index: 10;
    }
    .chart-tooltip-value { font-weight: 700; }
    .chart-tooltip-label {
      color: color-mix(in srgb, var(--text) 65%, var(--bg));
      margin-left: 0.35rem;
    }
  `;
  root.appendChild(style);

  const panels = computeChartPanels(metrics);
  const orderedIds = panels[0]?.bars.map((bar) => bar.algorithmId) ?? [];

  // Shared legend -- one row, reused across all four panels (not repeated per panel), per
  // dev_log/08_charts.md, "Layout".
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  for (const algorithmId of orderedIds) {
    const item = document.createElement('div');
    item.className = 'chart-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'chart-legend-swatch';
    swatch.style.background = algorithmColorVar(algorithmId);
    item.appendChild(swatch);

    const name = document.createElement('span');
    name.textContent = algorithmName(algorithmId); // textContent, not innerHTML -- names are
    // effectively trusted (this repo's algorithm registry), but treated the same as any other
    // label per the dataviz skill's interaction.md.
    item.appendChild(name);

    legend.appendChild(item);
  }
  root.appendChild(legend);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.role = 'tooltip';
  tooltip.hidden = true;

  const panelsContainer = document.createElement('div');
  panelsContainer.className = 'chart-panels';
  for (const panel of panels) {
    panelsContainer.appendChild(renderPanel(panel, tooltip));
  }
  root.appendChild(panelsContainer);

  root.appendChild(tooltip);

  return root;
}

function renderPanel(panel: ChartPanel, tooltip: HTMLElement): HTMLElement {
  const panelEl = document.createElement('div');
  panelEl.className = 'chart-panel';

  const heading = document.createElement('h4');
  heading.textContent = panel.label;
  panelEl.appendChild(heading);

  const rows = document.createElement('div');
  rows.className = 'chart-rows';

  for (const bar of panel.bars) {
    rows.appendChild(renderRow(panel, bar, tooltip));
  }
  panelEl.appendChild(rows);

  return panelEl;
}

function renderRow(panel: ChartPanel, bar: ChartBar, tooltip: HTMLElement): HTMLElement {
  const name = algorithmName(bar.algorithmId);
  const isNa = bar.value === null;
  const valueText = isNa ? 'n/a' : panel.formatValue(bar.value as number);

  const row = document.createElement('div');
  row.className = 'chart-row';
  // The whole row (label + track + value) is the hit target for hover/focus -- per
  // interaction.md, "on bars and cells, the mark is the hit target", tooltip on
  // pointermove/focus, same content on keyboard focus as on hover.
  row.tabIndex = 0;
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${name}: ${valueText}`);

  const label = document.createElement('span');
  label.className = 'chart-row-label';
  label.textContent = name;
  row.appendChild(label);

  const main = document.createElement('span');
  main.className = 'chart-row-main';

  const track = document.createElement('span');
  track.className = 'chart-row-track';
  if (!isNa) {
    const fill = document.createElement('span');
    fill.className = 'chart-bar';
    fill.style.width = `${(bar.proportion ?? 0) * 100}%`;
    fill.style.background = algorithmColorVar(bar.algorithmId);
    track.appendChild(fill);
  }
  main.appendChild(track);

  const valueEl = document.createElement('span');
  valueEl.className = isNa ? 'chart-row-value chart-value-na' : 'chart-row-value';
  valueEl.textContent = valueText;
  main.appendChild(valueEl);

  row.appendChild(main);

  const show = (): void => {
    const rect = row.getBoundingClientRect();
    tooltip.textContent = '';
    const valueSpan = document.createElement('span');
    valueSpan.className = 'chart-tooltip-value';
    valueSpan.textContent = valueText; // value leads, per interaction.md
    const labelSpan = document.createElement('span');
    labelSpan.className = 'chart-tooltip-label';
    labelSpan.textContent = name; // series name follows, secondary
    tooltip.appendChild(valueSpan);
    tooltip.appendChild(labelSpan);
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top}px`;
    tooltip.hidden = false;
  };
  const hide = (): void => {
    tooltip.hidden = true;
  };

  row.addEventListener('pointerenter', show);
  row.addEventListener('pointermove', show);
  row.addEventListener('pointerleave', hide);
  row.addEventListener('focus', show);
  row.addEventListener('blur', hide);

  return row;
}
