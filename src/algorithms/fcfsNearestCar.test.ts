import { describe, expect, it } from 'vitest';

import type {
  BuildingConfig,
  DispatchSnapshot,
  Direction,
  ElevatorSnapshot,
  FloorIndex,
  PassengerArrival,
} from '../engine';
import { runSimulation } from '../engine';
import { algorithm } from './fcfsNearestCar';

const SAFETY_CUTOFF = { maxTimeMs: 60_000 };

// Local, self-contained test helpers — deliberately not imported from src/engine/testFixtures.ts,
// which is Unit 02's own test-only scaffolding, not something Unit 03 builds on.

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 5,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 500,
    doorDwellBaseMs: 1000,
    doorDwellPerPassengerMultiplier: 0.5,
    ...overrides,
  };
}

function arrival(
  id: string,
  originFloor: FloorIndex,
  direction: Direction,
  destinationFloor: FloorIndex,
  arrivalTime: number,
): PassengerArrival {
  return { id, originFloor, direction, destinationFloor, arrivalTime };
}

function makeElevator(overrides: Partial<ElevatorSnapshot> & { id: string }): ElevatorSnapshot {
  return {
    currentFloor: 0,
    state: 'idle',
    direction: null,
    passengerCount: 0,
    capacityRemaining: 4,
    carButtons: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DispatchSnapshot> = {}): DispatchSnapshot {
  return {
    time: 0,
    elevators: [],
    activeHallCalls: [],
    ...overrides,
  };
}

function call(floor: FloorIndex, direction: Direction) {
  return { floor, direction };
}

describe('fcfsNearestCar (integration)', () => {
  it('travels stepwise toward a single call and stops on arrival', () => {
    const config = buildConfig({ floorCount: 5, floorTravelTimeMs: 500 });
    const hook = algorithm.createHook();

    const { log, finalState } = runSimulation(
      config,
      [arrival('p1', 4, 'up', 5, 0)],
      hook,
      SAFETY_CUTOFF,
    );

    const arrivedFloors = log
      .filter((e) => e.type === 'elevatorArrived')
      .map((e) => (e.type === 'elevatorArrived' ? e.floor : undefined));
    // One hop at a time, all the way to the pickup, then on to the drop-off.
    expect(arrivedFloors).toEqual([1, 2, 3, 4, 5]);

    const stops = log.filter((e) => e.type === 'doorsOpened');
    expect(stops).toHaveLength(2); // pickup at 4, drop-off at 5

    expect(finalState.elevators[0].state).toBe('idle');
    expect(finalState.elevators[0].currentFloor).toBe(5);
    expect(finalState.waitingPassengers).toEqual([]);
  });
});

describe('fcfsNearestCar (hook-level)', () => {
  it('assigns the nearer elevator to the nearer of two simultaneous calls', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0 }),
        makeElevator({ id: 'E2', currentFloor: 10 }),
      ],
      activeHallCalls: [call(2, 'up'), call(8, 'down')],
    });

    const actions = hook(snapshot);

    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'down' });
  });

  it('breaks a distance tie deterministically in favor of the lower elevator id', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0 }),
        makeElevator({ id: 'E2', currentFloor: 10 }),
      ],
      activeHallCalls: [call(5, 'up')],
    });

    const actions = hook(snapshot);

    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E2' });
  });

  it('prioritizes an onboard drop-off over diverting toward a newly assigned pickup', () => {
    const hook = algorithm.createHook();

    // First invocation: E1 is idle at floor 0 and gets assigned the call at floor 3.
    const firstSnapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 0 })],
      activeHallCalls: [call(3, 'up')],
    });
    hook(firstSnapshot);

    // Second invocation: E1 is now elsewhere (floor 7), carrying an onboard passenger whose
    // destination is right here, while the call at floor 3 is still active (and still assigned
    // to E1 in the hook's closure memory) — it must stop for the drop-off, not divert to pickup.
    const secondSnapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 7,
          state: 'moving',
          direction: 'up',
          passengerCount: 1,
          capacityRemaining: 3,
          carButtons: [7],
        }),
      ],
      activeHallCalls: [call(3, 'up')],
    });

    const actions = hook(secondSnapshot);
    expect(actions).toEqual([{ type: 'stop', elevatorId: 'E1' }]);
  });

  it('is naive: assigns the nearer elevator to a call even though it is already moving away from it', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        // E1 is nearby (distance 1) but already committed to moving down, away from this call.
        makeElevator({ id: 'E1', currentFloor: 4, state: 'moving', direction: 'down' }),
        // E2 is farther (distance 15) but idle.
        makeElevator({ id: 'E2', currentFloor: 20 }),
      ],
      activeHallCalls: [call(5, 'up')],
    });

    const actions = hook(snapshot);

    // FCFS ignores direction entirely — E1 is nearer, so it gets assigned despite heading the
    // opposite way. This is exactly the flaw nearestCarDirectional.ts exists to fix (see its own
    // "assigns the farther-but-compatible car" test for the direct contrast).
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E2' });
  });

  it('leaves a call unassigned across repeated invocations until an elevator has spare capacity', () => {
    const hook = algorithm.createHook();
    // The only elevator is full — not idle-vs-moving that matters here, but capacity. (A moving,
    // non-full elevator IS a valid candidate — see the "is naive" test above.)
    const fullSnapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 2,
          state: 'moving',
          direction: 'down',
          capacityRemaining: 0,
        }),
      ],
      activeHallCalls: [call(5, 'up')],
    });

    // Retried at every decision point, with no available elevator: always idle, never assigned.
    expect(hook(fullSnapshot)).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
    expect(hook(fullSnapshot)).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // Once capacity frees up, the same still-active call gets picked up — even while still
    // 'moving', consistent with FCFS not caring about state or direction, only distance.
    const freeSnapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 2,
          state: 'moving',
          direction: 'down',
          capacityRemaining: 2,
        }),
      ],
      activeHallCalls: [call(5, 'up')],
    });
    expect(hook(freeSnapshot)).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);
  });

  it('does not assign two simultaneous calls to the same elevator within one pass', () => {
    const hook = algorithm.createHook();
    // Both calls are much nearer to E1 than to E2 — without same-pass exclusion, a buggy
    // implementation might try to (re)consider E1 for the second call too.
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0 }),
        makeElevator({ id: 'E2', currentFloor: 50 }),
      ],
      activeHallCalls: [call(1, 'up'), call(2, 'up')],
    });

    const actions = hook(snapshot);

    // E1 claims the first (nearer, first-in-order) call; E2 — despite being far away — is the
    // only elevator left for the second, proving E1 was excluded once already claimed.
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'down' });
  });

  it('never returns more than one action for the same elevator id', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0 }),
        makeElevator({ id: 'E2', currentFloor: 4, state: 'moving', direction: 'up' }),
        makeElevator({ id: 'E3', currentFloor: 9 }),
      ],
      activeHallCalls: [call(3, 'up'), call(6, 'down'), call(9, 'up')],
    });

    const actions = hook(snapshot);
    const ids = actions.map((a) => a.elevatorId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['E1', 'E2', 'E3']);
  });
});
