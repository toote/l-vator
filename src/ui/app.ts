// Owns the single AppState instance and wires configPanel/algorithmSelect/runControls/
// resultsView into one render() cycle. See dev_log/06_ui.md, "Directory/file layout" and
// "State model".

import { renderAlgorithmSelect } from './algorithmSelect';
import { renderConfigPanel } from './configPanel';
import { renderResultsView } from './resultsView';
import { renderRunControls } from './runControls';
import { initialState } from './state';

export function mount(root: HTMLElement): void {
  const state = initialState();

  function render(): void {
    root.innerHTML = '';

    const heading = document.createElement('h1');
    heading.textContent = 'L-vator';
    root.appendChild(heading);

    const intro = document.createElement('p');
    intro.textContent =
      'Configure a building and call scenario, run it against one or more dispatch ' +
      'algorithms, and compare the results.';
    root.appendChild(intro);

    root.appendChild(renderConfigPanel(state, render));
    root.appendChild(renderAlgorithmSelect(state, render));
    root.appendChild(renderRunControls(state, render));
    root.appendChild(renderResultsView(state));
  }

  render();
}
