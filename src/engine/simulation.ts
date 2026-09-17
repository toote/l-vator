// The engine core: the discrete-event scheduling loop, the elevator state machine, mechanical
// boarding/alighting, and event-log construction. See dev_log/02_engine.md, "Movement and the
// decision hook" and "Door-dwell formula".

import { computeDoorDwellMs } from './door';
import type { DispatchAction, DispatchHook, DispatchSnapshot, ElevatorSnapshot } from './dispatch';
import { createEventQueue } from './eventQueue';
import type {
  BuildingConfig,
  BuildingState,
  Direction,
  ElevatorState,
  FloorIndex,
  HallCall,
  Passenger,
  ScriptedInput,
  SimEventLogEntry,
} from './types';

export interface RunSimulationOptions {
  /** Safety cutoff for tests/scripts that never naturally quiesce. */
  maxTimeMs?: number;
}

export interface RunSimulationResult {
  finalState: BuildingState;
  log: SimEventLogEntry[];
}

// Internal scheduled events held by the event queue. Distinct from SimEventLogEntry (the output
// record of what happened) — see dev_log/02_engine.md, "Event queue".
type ScheduledEvent =
  | { kind: 'passengerArrival'; arrival: ScriptedInput[number] }
  | { kind: 'elevatorArrived'; elevatorId: string; floor: FloorIndex }
  | { kind: 'doorsFinishedDwell'; elevatorId: string };

function hasWaitingCallAt(
  waitingPassengers: readonly Passenger[],
  floor: FloorIndex,
  direction: Direction,
): boolean {
  return waitingPassengers.some((p) => p.originFloor === floor && p.direction === direction);
}

/**
 * Derives presence-only active hall calls from the engine's internal ground truth.
 *
 * Ordering guarantee (see DispatchSnapshot.activeHallCalls in dispatch.ts): this relies on
 * `waitingPassengers` always being in arrival order (new arrivals pushed to the end,
 * `.filter()` used everywhere passengers are removed — never re-sorted or spliced), so the
 * first still-waiting occurrence of each (floor, direction) key naturally reflects when that
 * call first became active among calls active *right now*, and dropping a served call's
 * passengers via `.filter()` leaves the relative order of every other call untouched.
 */
function getActiveHallCalls(waitingPassengers: readonly Passenger[]): HallCall[] {
  const seen = new Set<string>();
  const calls: HallCall[] = [];
  for (const p of waitingPassengers) {
    const key = `${p.originFloor}:${p.direction}`;
    if (!seen.has(key)) {
      seen.add(key);
      calls.push({ floor: p.originFloor, direction: p.direction });
    }
  }
  return calls;
}

export function runSimulation(
  config: BuildingConfig,
  script: ScriptedInput,
  dispatchHook: DispatchHook,
  options: RunSimulationOptions = {},
): RunSimulationResult {
  const maxTimeMs = options.maxTimeMs ?? Number.POSITIVE_INFINITY;

  const state: BuildingState = {
    time: 0,
    elevators: Array.from({ length: config.elevatorCount }, (_, index) => ({
      id: `E${index + 1}`,
      currentFloor: 0,
      state: 'idle',
      direction: null,
      onboard: [],
      carButtons: new Set<FloorIndex>(),
    })),
    waitingPassengers: [],
  };

  const log: SimEventLogEntry[] = [];
  const queue = createEventQueue<ScheduledEvent>();

  for (const arrival of script) {
    queue.push({ kind: 'passengerArrival', arrival }, arrival.arrivalTime);
  }

  function findElevator(elevatorId: string): ElevatorState {
    const elevator = state.elevators.find((e) => e.id === elevatorId);
    if (!elevator) {
      throw new Error(`Dispatch hook referenced unknown elevator id "${elevatorId}"`);
    }
    return elevator;
  }

  function idleElevatorIds(): string[] {
    return state.elevators.filter((e) => e.state === 'idle').map((e) => e.id);
  }

  function buildDispatchSnapshot(time: number): DispatchSnapshot {
    const elevators: ElevatorSnapshot[] = state.elevators.map((e) => ({
      id: e.id,
      currentFloor: e.currentFloor,
      state: e.state,
      direction: e.direction,
      passengerCount: e.onboard.length,
      capacityRemaining: config.capacity - e.onboard.length,
      carButtons: Array.from(e.carButtons).sort((a, b) => a - b),
    }));
    return {
      time,
      elevators,
      activeHallCalls: getActiveHallCalls(state.waitingPassengers),
    };
  }

  function handleTravel(elevator: ElevatorState, direction: Direction, time: number): void {
    const target = direction === 'up' ? elevator.currentFloor + 1 : elevator.currentFloor - 1;
    if (target < 0 || target > config.floorCount) {
      throw new Error(
        `Dispatch hook requested elevator ${elevator.id} travel ${direction} from floor ` +
          `${elevator.currentFloor}, which is out of bounds [0, ${config.floorCount}]`,
      );
    }
    elevator.direction = direction;
    elevator.state = 'moving';
    queue.push(
      { kind: 'elevatorArrived', elevatorId: elevator.id, floor: target },
      time + config.floorTravelTimeMs,
    );
  }

  function handleIdleAction(elevator: ElevatorState): void {
    elevator.state = 'idle';
    elevator.direction = null;
  }

  function handleStop(elevator: ElevatorState, time: number): void {
    elevator.state = 'doorsOpen';
    log.push({ type: 'doorsOpened', time, elevatorId: elevator.id, floor: elevator.currentFloor });

    const floor = elevator.currentFloor;

    // Alighting: every onboard passenger whose destination is this floor.
    const staying: Passenger[] = [];
    const alighting: Passenger[] = [];
    for (const p of elevator.onboard) {
      (p.destinationFloor === floor ? alighting : staying).push(p);
    }
    for (const p of alighting) {
      p.alightedAt = time;
      log.push({
        type: 'passengerAlighted',
        time,
        elevatorId: elevator.id,
        floor,
        passengerId: p.id,
      });
    }
    elevator.onboard = staying;
    elevator.carButtons.delete(floor);

    // Boarding: waiting passengers at this floor matching the elevator's arrival direction,
    // up to remaining capacity, first-waiting-first-served.
    //
    // `elevator.direction` is null only when this stop was issued directly from `idle` (the
    // elevator was already sitting at the call floor and never had to travel to it) — there is
    // no "arrival direction" to speak of in that case, so any waiting direction at this floor is
    // eligible. This is a gap-fill for a case the plan doesn't spell out explicitly; see
    // dev_log/02_engine.md AI Interactions for the reasoning.
    const boardDirection = elevator.direction;
    const servicedDirections: Direction[] =
      boardDirection !== null ? [boardDirection] : ['up', 'down'];

    const hadActiveCallBefore = new Map<Direction, boolean>();
    for (const dir of servicedDirections) {
      hadActiveCallBefore.set(dir, hasWaitingCallAt(state.waitingPassengers, floor, dir));
    }

    const candidates = state.waitingPassengers
      .filter(
        (p) =>
          p.originFloor === floor && (boardDirection === null || p.direction === boardDirection),
      )
      .sort((a, b) => a.waitingSince - b.waitingSince);
    const capacityRemaining = Math.max(0, config.capacity - elevator.onboard.length);
    const boarding = candidates.slice(0, capacityRemaining);
    const boardingIds = new Set(boarding.map((p) => p.id));
    state.waitingPassengers = state.waitingPassengers.filter((p) => !boardingIds.has(p.id));

    for (const p of boarding) {
      p.boardedElevatorId = elevator.id;
      p.boardedAt = time;
      elevator.onboard.push(p);
      elevator.carButtons.add(p.destinationFloor);
      log.push({
        type: 'passengerBoarded',
        time,
        elevatorId: elevator.id,
        floor,
        passengerId: p.id,
      });
    }

    for (const dir of servicedDirections) {
      if (!hadActiveCallBefore.get(dir)) continue;
      const stillActive = hasWaitingCallAt(state.waitingPassengers, floor, dir);
      if (!stillActive) {
        log.push({ type: 'hallCallCleared', time, floor, direction: dir });
      }
    }

    const total = alighting.length + boarding.length;
    const dwellMs = computeDoorDwellMs(
      total,
      config.doorDwellBaseMs,
      config.doorDwellPerPassengerMultiplier,
    );
    queue.push({ kind: 'doorsFinishedDwell', elevatorId: elevator.id }, time + dwellMs);
  }

  function applyDecision(eligibleIds: ReadonlySet<string>, time: number): void {
    const snapshot = buildDispatchSnapshot(time);
    const actions: DispatchAction[] = dispatchHook(snapshot);

    const seenElevatorIds = new Set<string>();
    for (const action of actions) {
      if (seenElevatorIds.has(action.elevatorId)) {
        throw new Error(
          `Dispatch hook returned more than one action for elevator "${action.elevatorId}" ` +
            'in the same invocation',
        );
      }
      seenElevatorIds.add(action.elevatorId);
    }

    const handled = new Set<string>();
    for (const action of actions) {
      if (!eligibleIds.has(action.elevatorId)) continue; // physically can't act right now
      const elevator = findElevator(action.elevatorId);
      handled.add(action.elevatorId);
      switch (action.type) {
        case 'travel':
          handleTravel(elevator, action.direction, time);
          break;
        case 'stop':
          handleStop(elevator, time);
          break;
        case 'idle':
          handleIdleAction(elevator);
          break;
      }
    }

    // Any elevator that was forced through a decision point (arrival / doors finished) but
    // wasn't addressed by the hook must still resolve out of that transient state; default to
    // idle rather than leaving it stuck in `doorsClosed`/mid-arrival limbo. Already-idle elevators
    // that went unaddressed simply stay idle (no-op).
    for (const id of eligibleIds) {
      if (handled.has(id)) continue;
      const elevator = findElevator(id);
      if (elevator.state !== 'idle') {
        handleIdleAction(elevator);
      }
    }
  }

  function handlePassengerArrival(arrival: ScriptedInput[number], time: number): void {
    const wasActive = hasWaitingCallAt(
      state.waitingPassengers,
      arrival.originFloor,
      arrival.direction,
    );

    const passenger: Passenger = {
      id: arrival.id,
      originFloor: arrival.originFloor,
      direction: arrival.direction,
      waitingSince: time,
      destinationFloor: arrival.destinationFloor,
    };
    state.waitingPassengers.push(passenger);

    if (!wasActive) {
      log.push({
        type: 'hallCallRegistered',
        time,
        floor: arrival.originFloor,
        direction: arrival.direction,
      });
      applyDecision(new Set(idleElevatorIds()), time);
    }
  }

  function handleElevatorArrived(elevatorId: string, floor: FloorIndex, time: number): void {
    const elevator = findElevator(elevatorId);
    elevator.currentFloor = floor;
    log.push({ type: 'elevatorArrived', time, elevatorId, floor });
    applyDecision(new Set([elevatorId, ...idleElevatorIds()]), time);
  }

  function handleDoorsFinishedDwell(elevatorId: string, time: number): void {
    const elevator = findElevator(elevatorId);
    elevator.state = 'doorsClosed';
    log.push({ type: 'doorsClosed', time, elevatorId, floor: elevator.currentFloor });
    applyDecision(new Set([elevatorId, ...idleElevatorIds()]), time);
  }

  while (!queue.isEmpty()) {
    const next = queue.pop();
    if (!next) break;
    const { event, time } = next;
    if (time > maxTimeMs) break;

    state.time = time;
    switch (event.kind) {
      case 'passengerArrival':
        handlePassengerArrival(event.arrival, time);
        break;
      case 'elevatorArrived':
        handleElevatorArrived(event.elevatorId, event.floor, time);
        break;
      case 'doorsFinishedDwell':
        handleDoorsFinishedDwell(event.elevatorId, time);
        break;
    }
  }

  return { finalState: state, log };
}
