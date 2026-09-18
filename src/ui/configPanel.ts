// Renders + wires the building/fleet/timing/arrival/scenario-type form. See dev_log/06_ui.md,
// "Config panel fields and defaults" and "Scenario type toggle: random vs. scripted".
//
// Focus-preserving refinement (see dev_log/06_ui.md, "State model"): plain numeric/text fields
// are wired with a direct oninput handler that mutates AppState.config in place and does NOT
// call render() -- the input already shows what was typed, so no rebuild is needed for that
// field itself. render() is called only for genuinely structural changes: floor count committing
// a new value (changes the valid per-floor-rate row set), pattern changing (same reason),
// scenario-type toggling (shows/hides whole sections), and scripted-example selection (changes
// the read-only building readout). "Floors (above ground)" specifically uses oninput to keep the
// field responsive while typing, but only triggers the structural render() on `change`
// (blur/commit) -- rebuilding on every keystroke of a multi-digit number would otherwise fight
// the very focus-preservation this refinement exists for.

import type { FloorIndex } from '../engine';
import { generatingFloors, type ArrivalPattern } from '../generation';
import { randomSeed, scriptedScenarios } from './state';
import type { AppState } from './types';

function fieldRow(labelText: string, control: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = `${labelText}: `;
  label.appendChild(control);
  wrapper.appendChild(label);
  return wrapper;
}

interface NumberFieldOptions {
  min?: number;
  step?: number;
  /** Fires on `change` (blur/commit), in addition to the always-present oninput mutation. Used
   * only for fields whose change is structural (see module doc comment). */
  onCommit?: () => void;
}

function numberField(
  labelText: string,
  value: number,
  onInput: (value: number) => void,
  options: NumberFieldOptions = {},
): HTMLDivElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = Number.isNaN(value) ? '' : String(value);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.step !== undefined) input.step = String(options.step);
  input.oninput = () => onInput(input.valueAsNumber);
  if (options.onCommit) {
    input.onchange = options.onCommit;
  }
  return fieldRow(labelText, input);
}

function renderPatternSelect(state: AppState, render: () => void): HTMLDivElement {
  const select = document.createElement('select');
  const patterns: ArrivalPattern[] = ['up-peak', 'down-peak', 'lunch-peak', 'random'];
  for (const pattern of patterns) {
    const option = document.createElement('option');
    option.value = pattern;
    option.textContent = pattern;
    option.selected = state.config.arrivals.pattern === pattern;
    select.appendChild(option);
  }
  select.onchange = () => {
    // Structural: changes which floors are shown for the per-floor-rate override below.
    state.config.arrivals.pattern = select.value as ArrivalPattern;
    render();
  };
  return fieldRow('Origin/destination pattern', select);
}

function renderFloorRatesPanel(state: AppState): HTMLDivElement {
  const wrapper = document.createElement('div');
  const heading = document.createElement('p');
  heading.textContent = 'Per-floor rate override (blank = use the base arrival rate):';
  wrapper.appendChild(heading);

  const { building, arrivals } = state.config;
  const floors: FloorIndex[] = Number.isFinite(building.floorCount)
    ? generatingFloors(arrivals.pattern, building.floorCount)
    : [];

  if (floors.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No floors generate arrivals under this pattern/floor count.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  for (const floor of floors) {
    const input = document.createElement('input');
    input.type = 'number';
    const existing = arrivals.floorRates[floor];
    input.value = existing === undefined ? '' : String(existing);
    input.oninput = () => {
      const value = input.valueAsNumber;
      if (Number.isNaN(value)) {
        delete arrivals.floorRates[floor];
      } else {
        arrivals.floorRates[floor] = value;
      }
    };
    wrapper.appendChild(fieldRow(`Floor ${floor}`, input));
  }

  return wrapper;
}

function renderSeedField(state: AppState): HTMLDivElement {
  const wrapper = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(state.config.seed);
  input.oninput = () => {
    state.config.seed = input.valueAsNumber;
  };
  wrapper.appendChild(fieldRow('Seed', input));

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Randomize';
  button.onclick = () => {
    const seed = randomSeed();
    state.config.seed = seed;
    input.value = String(seed);
  };
  wrapper.appendChild(button);

  return wrapper;
}

function renderRandomPanel(state: AppState, render: () => void): HTMLElement {
  const wrapper = document.createElement('div');
  const { config } = state;

  wrapper.appendChild(
    numberField(
      'Floors (above ground)',
      config.building.floorCount,
      (value) => {
        config.building.floorCount = value;
      },
      {
        min: 1,
        // Structural: changes the valid per-floor-rate row set. Only on commit (see module doc
        // comment) so typing a multi-digit floor count doesn't lose focus mid-keystroke.
        onCommit: render,
      },
    ),
  );
  wrapper.appendChild(
    numberField('Elevators', config.building.elevatorCount, (value) => {
      config.building.elevatorCount = value;
    }),
  );
  wrapper.appendChild(
    numberField('Capacity', config.building.capacity, (value) => {
      config.building.capacity = value;
    }),
  );
  wrapper.appendChild(
    numberField('Floor travel time (ms)', config.building.floorTravelTimeMs, (value) => {
      config.building.floorTravelTimeMs = value;
    }),
  );
  wrapper.appendChild(
    numberField('Door dwell base (ms)', config.building.doorDwellBaseMs, (value) => {
      config.building.doorDwellBaseMs = value;
    }),
  );
  wrapper.appendChild(
    numberField(
      'Door dwell per-passenger multiplier',
      config.building.doorDwellPerPassengerMultiplier,
      (value) => {
        config.building.doorDwellPerPassengerMultiplier = value;
      },
      { step: 0.1 },
    ),
  );
  wrapper.appendChild(
    numberField(
      'Idle return threshold (ms)',
      config.building.idleReturnThresholdMs,
      (value) => {
        config.building.idleReturnThresholdMs = value;
      },
      { min: 0 },
    ),
  );
  wrapper.appendChild(
    numberField('Arrival rate (per minute)', config.arrivals.baseRatePerMinute, (value) => {
      config.arrivals.baseRatePerMinute = value;
    }),
  );

  wrapper.appendChild(renderPatternSelect(state, render));
  wrapper.appendChild(renderFloorRatesPanel(state));

  wrapper.appendChild(
    numberField('Trial count', config.trialCount, (value) => {
      config.trialCount = value;
    }),
  );
  wrapper.appendChild(
    numberField('Duration (minutes)', config.durationMinutes, (value) => {
      config.durationMinutes = value;
    }),
  );
  wrapper.appendChild(renderSeedField(state));

  return wrapper;
}

function renderReadOnlyBuilding(building: {
  floorCount: number;
  elevatorCount: number;
  capacity: number;
  floorTravelTimeMs: number;
  doorDwellBaseMs: number;
  doorDwellPerPassengerMultiplier: number;
  idleReturnThresholdMs: number;
}): HTMLElement {
  const wrapper = document.createElement('div');
  const heading = document.createElement('p');
  heading.textContent = "This example's building (read-only):";
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  const entries: Array<[string, number]> = [
    ['Floors (above ground)', building.floorCount],
    ['Elevators', building.elevatorCount],
    ['Capacity', building.capacity],
    ['Floor travel time (ms)', building.floorTravelTimeMs],
    ['Door dwell base (ms)', building.doorDwellBaseMs],
    ['Door dwell per-passenger multiplier', building.doorDwellPerPassengerMultiplier],
    ['Idle return threshold (ms)', building.idleReturnThresholdMs],
  ];
  for (const [label, value] of entries) {
    const item = document.createElement('li');
    item.textContent = `${label}: ${value}`;
    list.appendChild(item);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderScriptedPanel(state: AppState, render: () => void): HTMLElement {
  const wrapper = document.createElement('div');
  const examples = scriptedScenarios();

  if (examples.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'No example scenarios are available.';
    wrapper.appendChild(message);
    return wrapper;
  }

  const select = document.createElement('select');
  // ScriptedScenario carries no display-name field today (dev_log/06_ui.md, "Scenario type
  // toggle" -- "a small gap, not worth a cross-unit change for one label"), and src/scenarios's
  // own barrel (deliberately left unmodified by this unit) discards each module's filename, so
  // options are labeled positionally rather than by filename/id.
  examples.forEach((scenario, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `Example ${index + 1}`;
    option.selected = state.config.scriptedScenario === scenario;
    select.appendChild(option);
  });
  select.onchange = () => {
    const index = Number(select.value);
    state.config.scriptedScenario = examples[index] ?? null;
    render();
  };
  wrapper.appendChild(fieldRow('Example scenario', select));

  if (state.config.scriptedScenario) {
    wrapper.appendChild(renderReadOnlyBuilding(state.config.scriptedScenario.building));
  }

  wrapper.appendChild(
    numberField('Trial count', state.config.trialCount, (value) => {
      state.config.trialCount = value;
    }),
  );

  return wrapper;
}

function renderScenarioTypeToggle(state: AppState, render: () => void): HTMLElement {
  const wrapper = document.createElement('div');

  const randomLabel = document.createElement('label');
  const randomRadio = document.createElement('input');
  randomRadio.type = 'radio';
  randomRadio.name = 'scenario-mode';
  randomRadio.checked = state.config.mode === 'random';
  randomRadio.onchange = () => {
    state.config.mode = 'random';
    render();
  };
  randomLabel.appendChild(randomRadio);
  randomLabel.appendChild(document.createTextNode(' Random'));

  const scriptedLabel = document.createElement('label');
  const scriptedRadio = document.createElement('input');
  scriptedRadio.type = 'radio';
  scriptedRadio.name = 'scenario-mode';
  scriptedRadio.checked = state.config.mode === 'scripted';
  scriptedRadio.disabled = scriptedScenarios().length === 0;
  scriptedRadio.onchange = () => {
    state.config.mode = 'scripted';
    if (!state.config.scriptedScenario) {
      state.config.scriptedScenario = scriptedScenarios()[0] ?? null;
    }
    render();
  };
  scriptedLabel.appendChild(scriptedRadio);
  scriptedLabel.appendChild(document.createTextNode(' Load example scenario'));

  wrapper.appendChild(randomLabel);
  wrapper.appendChild(scriptedLabel);
  return wrapper;
}

export function renderConfigPanel(state: AppState, render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h2');
  heading.textContent = 'Configuration';
  section.appendChild(heading);

  section.appendChild(renderScenarioTypeToggle(state, render));

  if (state.config.mode === 'scripted') {
    section.appendChild(renderScriptedPanel(state, render));
  } else {
    section.appendChild(renderRandomPanel(state, render));
  }

  return section;
}
