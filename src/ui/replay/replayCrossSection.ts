// DOM: renders the building cross-section (floor/shaft grid, car elements, hall-call indicators)
// for ONE algorithm's ONE trial, and exposes update(frame) for imperative per-frame patching --
// no full rebuild. See dev_log/07_results.md, "Visual representation" and "A new pattern for
// app.ts's render cycle". Colors use only the --text/--bg custom properties from style.css so
// dark mode keeps working.

import type { BuildingConfig, Direction, FloorIndex } from '../../engine';
import type { ElevatorStatus, ReplayFrame } from './replayFrame';
import type { WaitingCountFrame } from './waitingCounts';

const ROW_HEIGHT_PX = 40;
const SHAFT_WIDTH_PX = 64;

export interface CrossSectionHandle {
  root: HTMLElement;
  /** Imperatively patches only the car/door/badge/indicator elements already built -- never
   * rebuilds the tree. Called once per animation frame. */
  update: (frame: ReplayFrame, waitingCounts: readonly WaitingCountFrame[]) => void;
}

function hallCallKey(floor: FloorIndex, direction: Direction): string {
  return `${floor}:${direction}`;
}

function glyphFor(direction: Direction): string {
  return direction === 'up' ? '▲' : '▼';
}

/** Text for the status label shown above each elevator -- see replayFrame.ts's ElevatorStatus. */
function statusLabel(status: ElevatorStatus): string {
  switch (status.type) {
    case 'idle':
      return 'Idle';
    case 'doorsOpen':
      return 'Doors open';
    case 'traveling':
      return `→ Floor ${status.targetFloor}`;
  }
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
    }
    /* .overloaded (count > building.capacity) is the ONLY thing that bolds a hall-call badge --
       see dev_log/09_waiting_counts.md, "What happens at large counts". Unit 07's original
       .active rule also set font-weight: bold here; that was removed by Unit 09 (confirmed via
       real browser testing -- see dev_log/09_waiting_counts_test.md) because it made .overloaded
       indistinguishable from merely-active: almost every non-zero waiting count is also an active
       hall call, so the pre-existing "active = bold" rule silently masked the new "overloaded =
       bold" signal the entire time a queue was building, not just once it actually exceeded
       capacity. Active/inactive is still fully conveyed by the opacity toggle alone. */
    .replay-hall-indicator.overloaded {
      font-weight: bold;
    }
    /* Always-visible, fixed-width count -- reserves space for up to 2 digits with tabular
       (equal-width) figures, so a count appearing, disappearing, or changing digit count (e.g.
       3 -> 12) never reflows the floor row or the indicator next to it. A count past 2 digits
       simply grows past this reserved width -- rare in practice, and still layout-stable for
       every ordinary case. */
    .replay-hall-count {
      display: inline-block;
      min-width: 1.5ch;
      text-align: left;
      font-variant-numeric: tabular-nums;
    }
  `;
  root.appendChild(style);

  const floors: FloorIndex[] = [];
  for (let f = building.floorCount; f >= 0; f--) floors.push(f);

  // Floor labels + hall-call indicators.
  const labelsColumn = document.createElement('div');
  labelsColumn.style.display = 'flex';
  labelsColumn.style.flexDirection = 'column';

  interface HallIndicator {
    element: HTMLElement;
    count: HTMLElement;
    floor: FloorIndex;
    direction: Direction;
  }
  const hallIndicators = new Map<string, HallIndicator>();

  function createHallIndicator(floor: FloorIndex, direction: Direction): HallIndicator {
    const element = document.createElement('span');
    element.className = 'replay-hall-indicator';
    element.title = `Floor ${floor}, ${direction}`;
    element.appendChild(document.createTextNode(glyphFor(direction)));

    const count = document.createElement('span');
    count.className = 'replay-hall-count';
    count.textContent = '0';
    element.appendChild(count);

    return { element, count, floor, direction };
  }

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

    const up = createHallIndicator(floor, 'up');
    row.appendChild(up.element);
    hallIndicators.set(hallCallKey(floor, 'up'), up);

    const down = createHallIndicator(floor, 'down');
    row.appendChild(down.element);
    hallIndicators.set(hallCallKey(floor, 'down'), down);

    labelsColumn.appendChild(row);
  }
  root.appendChild(labelsColumn);

  // Elevator shafts.
  const shaftsWrapper = document.createElement('div');
  shaftsWrapper.style.display = 'flex';
  shaftsWrapper.style.gap = '0.6rem';

  const cars = new Map<string, HTMLElement>();
  const statusLabels = new Map<string, HTMLElement>();
  const shaftHeight = floors.length * ROW_HEIGHT_PX;

  for (const elevatorId of elevatorIds) {
    const column = document.createElement('div');

    const status = document.createElement('div');
    status.textContent = statusLabel({ type: 'idle' }); // placeholder -- update() sets the real value
    status.style.width = `${SHAFT_WIDTH_PX}px`;
    status.style.textAlign = 'center';
    status.style.fontSize = '0.65rem';
    // Reserves space for a two-line status (e.g. "→ Floor 12") so a shorter one (e.g. "Idle")
    // doesn't shrink the row and shift the shaft below it -- same layout-stability reasoning as
    // the replay's waiting-count badges (see dev_log/09_waiting_counts_done.md's amendment).
    status.style.minHeight = '1.6em';
    status.style.marginBottom = '0.2rem';
    statusLabels.set(elevatorId, status);

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

    column.appendChild(status);
    column.appendChild(shaft);
    column.appendChild(idLabel);
    shaftsWrapper.appendChild(column);
  }
  root.appendChild(shaftsWrapper);

  function update(frame: ReplayFrame, waitingCounts: readonly WaitingCountFrame[]): void {
    for (const elevatorFrame of frame.elevators) {
      const car = cars.get(elevatorFrame.elevatorId);
      if (!car) continue;
      const top = (building.floorCount - elevatorFrame.position) * ROW_HEIGHT_PX;
      car.style.transform = `translateY(${top}px)`; // no CSS transition -- see plan's "No CSS
      // transitions" note: a transition would fight scrub jumps and can't track variable speed.
      car.classList.toggle('doors-open', elevatorFrame.doorsOpen);
      car.textContent = `${elevatorFrame.onboardCount}/${building.capacity}`;

      const status = statusLabels.get(elevatorFrame.elevatorId);
      if (status) status.textContent = statusLabel(elevatorFrame.status);
    }

    const activeKeys = new Set(
      frame.activeHallCalls.map((call) => hallCallKey(call.floor, call.direction)),
    );
    // Defaults absent (floor, direction) pairs to a count of 0 -- same convention
    // GroupedWaitingCounts documents for a pair with zero arrivals in the whole trial. See
    // dev_log/09_waiting_counts.md, "Visual representation" / "What happens at large counts".
    const countByKey = new Map(
      waitingCounts.map((entry) => [hallCallKey(entry.floor, entry.direction), entry.count]),
    );
    for (const [key, indicator] of hallIndicators) {
      indicator.element.classList.toggle('active', activeKeys.has(key));
      const count = countByKey.get(key) ?? 0;
      indicator.count.textContent = String(count);
      const overloaded = count > building.capacity;
      indicator.element.classList.toggle('overloaded', overloaded);
      const waitingSuffix = count > 0 ? ` — ${count} waiting` : '';
      indicator.element.title = `Floor ${indicator.floor}, ${indicator.direction}${waitingSuffix}`;
    }
  }

  return { root, update };
}
