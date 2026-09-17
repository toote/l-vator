// Renders + wires the algorithm checkbox list. See dev_log/06_ui.md, "Algorithm selection".
// No persistent-focus text inputs here, so it's simply rebuilt wholesale (via the passed-in
// render()) on every relevant state change -- no special-casing needed, per the plan's state
// model note.

import { algorithms } from '../algorithms';
import type { AppState } from './types';

export function renderAlgorithmSelect(state: AppState, render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Algorithms';
  section.appendChild(heading);

  for (const algorithm of algorithms) {
    const label = document.createElement('label');
    label.style.display = 'block';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedAlgorithmIds.includes(algorithm.id);
    checkbox.onchange = () => {
      if (checkbox.checked) {
        if (!state.selectedAlgorithmIds.includes(algorithm.id)) {
          state.selectedAlgorithmIds.push(algorithm.id);
        }
      } else {
        state.selectedAlgorithmIds = state.selectedAlgorithmIds.filter((id) => id !== algorithm.id);
      }
      render();
    };

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${algorithm.name}`));
    section.appendChild(label);
  }

  return section;
}
