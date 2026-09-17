// Run button + status. See dev_log/06_ui.md, "Run controls and the minimal results readout".

import { algorithms } from '../algorithms';
import { runTrialBatch } from '../generation';
import { computeMetrics } from '../metrics';
import { buildScenario } from './buildScenario';
import { DEFAULT_SPEED } from './replay/replayClock';
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
        // Snapshot the building actually used for this run -- not a live reference to
        // scenario.building (itself already a fresh copy of state.config.building for random
        // mode, but the stored ScriptedScenario's building for scripted mode) -- see
        // dev_log/07_results.md, "A gap this unit must close first".
        state.run = { status: 'done', metrics, trialResults, building: { ...scenario.building } };
        // (Re)initialize replay selection: first algorithm actually run, trial 0, paused at the
        // start, default speed. Re-running always replaces this wholesale, same as state.run.
        state.replay = {
          algorithmId: selectedAlgorithms[0].id,
          trialIndex: 0,
          simTimeMs: 0,
          playing: false,
          speed: DEFAULT_SPEED,
        };
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
