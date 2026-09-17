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
});
