import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, ElevatorSnapshot } from '../engine';
import { algorithm } from './zoningFallbackHoming';

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
    doorDwellBaseMs: 1000,
    floorCount: 10,
    ...overrides,
  };
}

describe('zoningFallbackHoming (hook-level)', () => {
  it('starts traveling down once idle for exactly the threshold, when not already at floor 0', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    expect(
      hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    const actions = hook(
      makeSnapshot({ time: 5000, elevators: [elevator], idleReturnThresholdMs: 5000 }),
    );
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });

  it('returns to plain idle once it reaches floor 0 while homing, without looping', () => {
    const hook = algorithm.createHook();

    hook(
      makeSnapshot({
        time: 0,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
        idleReturnThresholdMs: 5000,
      }),
    );
    const homing = hook(
      makeSnapshot({
        time: 5000,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
        idleReturnThresholdMs: 5000,
      }),
    );
    expect(homing).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);

    const atHome = makeElevator({ id: 'E1', currentFloor: 0 });
    expect(
      hook(makeSnapshot({ time: 10000, elevators: [atHome], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });

  it('still falls back to an out-of-zone elevator when the in-zone candidate is full, same as the non-homing variant', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 3, capacityRemaining: 0, carButtons: [3] }),
        makeElevator({ id: 'E2', currentFloor: 6 }),
      ],
      activeHallCalls: [{ floor: 3, direction: 'up' }],
    });

    expect(hook(snapshot)).toContainEqual({
      type: 'travel',
      elevatorId: 'E2',
      direction: 'down',
    });
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('zoning-fallback-homing');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
