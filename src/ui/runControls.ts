// Run button + status. See dev_log/06_ui.md, "Run controls and the minimal results readout".

import { algorithms } from '../algorithms';
import { runTrialBatch } from '../generation';
import { computeMetrics } from '../metrics';
import { buildScenario } from './buildScenario';
import type { AppState } from './types';
import { validate } from './validation';

export function renderRunControls(state: AppState, render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Run';
  section.appendChild(heading);

  // A separate inline message for validation failures -- deliberately NOT routed through
  // AppState.run, per the plan's step 1 ("show the message inline and stop, without touching
  // AppState.run"). AppState.run's 'error' status is reserved for errors thrown by the actual
  // run pipeline (step 3/4 below).
  const validationMessage = document.createElement('p');
  section.appendChild(validationMessage);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = state.run.status === 'running' ? 'Running...' : 'Run';
  button.disabled = state.run.status === 'running';
  button.onclick = () => {
    const message = validate(state);
    if (message) {
      validationMessage.textContent = message;
      return;
    }
    validationMessage.textContent = '';

    state.run = { status: 'running' };
    render();

    // Deferred one tick: runTrialBatch is synchronous and can be CPU-heavy (many trials x long
    // duration) -- without this, the 'running' state set just above would never actually paint
    // before the main thread blocks running it.
    setTimeout(() => {
      try {
        const scenario = buildScenario(state.config);
        const selectedAlgorithms = algorithms.filter((algorithm) =>
          state.selectedAlgorithmIds.includes(algorithm.id),
        );
        const trialResults = runTrialBatch(scenario, selectedAlgorithms);
        const metrics = computeMetrics(trialResults, scenario);
        state.run = { status: 'done', metrics };
      } catch (error) {
        state.run = {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      render();
    }, 0);
  };
  section.appendChild(button);

  return section;
}
