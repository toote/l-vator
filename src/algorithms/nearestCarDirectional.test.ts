import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, Direction, ElevatorSnapshot, FloorIndex } from '../engine';
import { algorithm } from './nearestCarDirectional';

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
    idleReturnThresholdMs: 30000,
    floorTravelTimeMs: 1000,
    ...overrides,
  };
}

function call(floor: FloorIndex, direction: Direction) {
  return { floor, direction };
}

describe('nearestCarDirectional (hook-level)', () => {
  it('assigns the farther-but-compatible car over the nearer car already heading away', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        // E1 is nearby (distance 2) but already moving down, away from this call.
        makeElevator({ id: 'E1', currentFloor: 6, state: 'moving', direction: 'down' }),
        // E2 is farther (distance 8) but idle, so it's always compatible.
        makeElevator({ id: 'E2', currentFloor: 0 }),
      ],
      activeHallCalls: [call(8, 'up')],
    });

    const actions = hook(snapshot);

    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E1' });
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'up' });
  });

  it('leaves a call unassigned until a car becomes idle or turns compatible', () => {
    const hook = algorithm.createHook();
    // Nearer in raw distance, but moving the wrong way — incompatible.
    const incompatibleSnapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 6, state: 'moving', direction: 'down' })],
      activeHallCalls: [call(8, 'up')],
    });

    expect(hook(incompatibleSnapshot)).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
    expect(hook(incompatibleSnapshot)).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // Once idle, the same elevator becomes a valid candidate for the still-active call.
    const idleSnapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 6, state: 'idle', direction: null })],
      activeHallCalls: [call(8, 'up')],
    });
    expect(hook(idleSnapshot)).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);
  });

  it('treats an idle elevator as always compatible, regardless of its stored direction', () => {
    const hook = algorithm.createHook();
    // Artificially idle-but-non-null-direction snapshot, to isolate isCompatible's short-circuit
    // for idle elevators from the position/direction checks that apply to moving ones.
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 20, state: 'idle', direction: 'down' })],
      activeHallCalls: [call(2, 'up')],
    });

    const actions = hook(snapshot);
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
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

  it('releases the assignment once the assigned elevator visits and departs, letting an idle second elevator help', () => {
    // Regression test (same bug/fix as fcfsNearestCar.ts's identically-named test): an assignment
    // used to persist for as long as its call stayed active, regardless of the assigned
    // elevator's actual position - so once E1 filled up and left to deliver, it kept "owning" the
    // still-active call, permanently excluding E2 (idle the whole time) from ever helping.
    const hook = algorithm.createHook();

    // First invocation: E1 idle at floor 2, gets assigned floor 2/up (nearest, and idle so always
    // compatible). E2 is idle elsewhere.
    const firstSnapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 2, capacityRemaining: 1 }),
        makeElevator({ id: 'E2', currentFloor: 8 }),
      ],
      activeHallCalls: [call(2, 'up')],
    });
    hook(firstSnapshot);

    // Second invocation: E1 has since boarded (now full) and moved on to deliver - but the call
    // at floor 2 is still active (overflow: someone was left waiting). E2, still idle, is now the
    // only elevator with room.
    const secondSnapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 4,
          state: 'moving',
          direction: 'up',
          capacityRemaining: 0,
          carButtons: [6],
        }),
        makeElevator({ id: 'E2', currentFloor: 2 }),
      ],
      activeHallCalls: [call(2, 'up')],
    });

    const actions = hook(secondSnapshot);

    // E1 is released (full, already visited and left) and correctly continues delivering rather
    // than being asked to do anything about floor 2 again.
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    // E2 - idle, now the only elevator with capacity - gets assigned and, since it's already
    // sitting at floor 2, stops immediately.
    expect(actions).toContainEqual({ type: 'stop', elevatorId: 'E2' });
  });
});
