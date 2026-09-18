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
    // Own row per algorithm (not just a bare <label>) so the description can sit directly
    // beneath the name, always visible — this project is teaching-first (00_main.md's "What
    // This Is"), so a description a reader has to hover to see would work against that goal.
    const row = document.createElement('div');
    row.style.marginBottom = '0.5rem';

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
    row.appendChild(label);

    const description = document.createElement('p');
    description.textContent = algorithm.description;
    // Indented to align under the label text (past the checkbox), de-emphasized via --text at
    // reduced opacity rather than a hardcoded gray -- stays correct in dark mode too.
    description.style.margin = '0.15rem 0 0 1.4rem';
    description.style.fontSize = '0.85rem';
    description.style.opacity = '0.75';
    row.appendChild(description);

    section.appendChild(row);
  }

  return section;
}
