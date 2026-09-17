// DOM: renders the building cross-section (floor/shaft grid, car elements, hall-call indicators)
// for ONE algorithm's ONE trial, and exposes update(frame) for imperative per-frame patching --
// no full rebuild. See dev_log/07_results.md, "Visual representation" and "A new pattern for
// app.ts's render cycle". Colors use only the --text/--bg custom properties from style.css so
// dark mode keeps working.

import type { BuildingConfig, Direction, FloorIndex } from '../../engine';
import type { ReplayFrame } from './replayFrame';

const ROW_HEIGHT_PX = 40;
const SHAFT_WIDTH_PX = 64;

export interface CrossSectionHandle {
  root: HTMLElement;
  /** Imperatively patches only the car/door/badge/indicator elements already built -- never
   * rebuilds the tree. Called once per animation frame. */
  update: (frame: ReplayFrame) => void;
}

function hallCallKey(floor: FloorIndex, direction: Direction): string {
  return `${floor}:${direction}`;
}

export function renderCrossSection(
  building: BuildingConfig,
  elevatorIds: readonly string[],
): CrossSectionHandle {
  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.gap = '1.25rem';
  root.style.alignItems = 'flex-start';
  root.style.marginTop = '0.5rem';

  // Static styling, set once -- update() never touches this element, so it survives every frame.
  const style = document.createElement('style');
  style.textContent = `
    .replay-car {
      position: absolute;
      left: 3px;
      right: 3px;
      height: ${ROW_HEIGHT_PX - 8}px;
      border: 2px solid var(--text);
      border-radius: 4px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      box-sizing: border-box;
      will-change: transform;
    }
    .replay-car.doors-open {
      background: color-mix(in srgb, var(--text) 30%, var(--bg));
    }
    .replay-hall-indicator {
      opacity: 0.25;
    }
    .replay-hall-indicator.active {
      opacity: 1;
      font-weight: bold;
    }
  `;
  root.appendChild(style);

  const floors: FloorIndex[] = [];
  for (let f = building.floorCount; f >= 0; f--) floors.push(f);

  // Floor labels + hall-call indicators.
  const labelsColumn = document.createElement('div');
  labelsColumn.style.display = 'flex';
  labelsColumn.style.flexDirection = 'column';

  const hallIndicators = new Map<string, HTMLElement>();

  for (const floor of floors) {
    const row = document.createElement('div');
    row.style.height = `${ROW_HEIGHT_PX}px`;
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.35rem';
    row.style.fontSize = '0.85rem';

    const label = document.createElement('span');
    label.textContent = `Floor ${floor}`;
    label.style.width = '4.75rem';
    row.appendChild(label);

    const up = document.createElement('span');
    up.textContent = '▲';
    up.className = 'replay-hall-indicator';
    up.title = `Floor ${floor}, up`;
    row.appendChild(up);
    hallIndicators.set(hallCallKey(floor, 'up'), up);

    const down = document.createElement('span');
    down.textContent = '▼';
    down.className = 'replay-hall-indicator';
    down.title = `Floor ${floor}, down`;
    row.appendChild(down);
    hallIndicators.set(hallCallKey(floor, 'down'), down);

    labelsColumn.appendChild(row);
  }
  root.appendChild(labelsColumn);

  // Elevator shafts.
  const shaftsWrapper = document.createElement('div');
  shaftsWrapper.style.display = 'flex';
  shaftsWrapper.style.gap = '0.6rem';

  const cars = new Map<string, HTMLElement>();
  const shaftHeight = floors.length * ROW_HEIGHT_PX;

  for (const elevatorId of elevatorIds) {
    const column = document.createElement('div');

    const shaft = document.createElement('div');
    shaft.style.position = 'relative';
    shaft.style.width = `${SHAFT_WIDTH_PX}px`;
    shaft.style.height = `${shaftHeight}px`;
    shaft.style.border = '1px solid var(--text)';
    shaft.style.boxSizing = 'border-box';

    const car = document.createElement('div');
    car.className = 'replay-car';
    car.textContent = '0';
    shaft.appendChild(car);
    cars.set(elevatorId, car);

    const idLabel = document.createElement('div');
    idLabel.textContent = elevatorId;
    idLabel.style.textAlign = 'center';
    idLabel.style.fontSize = '0.75rem';

    column.appendChild(shaft);
    column.appendChild(idLabel);
    shaftsWrapper.appendChild(column);
  }
  root.appendChild(shaftsWrapper);

  function update(frame: ReplayFrame): void {
    for (const elevatorFrame of frame.elevators) {
      const car = cars.get(elevatorFrame.elevatorId);
      if (!car) continue;
      const top = (building.floorCount - elevatorFrame.position) * ROW_HEIGHT_PX;
      car.style.transform = `translateY(${top}px)`; // no CSS transition -- see plan's "No CSS
      // transitions" note: a transition would fight scrub jumps and can't track variable speed.
      car.classList.toggle('doors-open', elevatorFrame.doorsOpen);
      car.textContent = `${elevatorFrame.onboardCount}/${building.capacity}`;
    }

    const activeKeys = new Set(
      frame.activeHallCalls.map((call) => hallCallKey(call.floor, call.direction)),
    );
    for (const [key, indicator] of hallIndicators) {
      indicator.classList.toggle('active', activeKeys.has(key));
    }
  }

  return { root, update };
}
