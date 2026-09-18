import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, ElevatorSnapshot } from '../engine';
import { algorithm as strict } from './zoning';
import { algorithm } from './zoningFallback';

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

/** Identical scenario for both algorithms: E1's zone [1,5] is full, E2's zone [6,10] is idle. */
function divergenceScenario(): DispatchSnapshot {
  return makeSnapshot({
    elevators: [
      makeElevator({ id: 'E1', currentFloor: 3, capacityRemaining: 0, carButtons: [3] }),
      makeElevator({ id: 'E2', currentFloor: 6 }),
    ],
    activeHallCalls: [{ floor: 3, direction: 'up' }],
  });
}

describe('zoning vs. zoning-fallback: the one deliberate behavioral difference', () => {
  it('strict zoning leaves the call unassigned (E2 stays idle)', () => {
    const actions = strict.createHook()(divergenceScenario());
    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E2' });
  });

  it('zoning-fallback assigns the call to the out-of-zone idle elevator instead', () => {
    const actions = algorithm.createHook()(divergenceScenario());
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'down' });
  });
});

describe('zoning-fallback (hook-level)', () => {
  it('still prefers an in-zone candidate over an out-of-zone one when both are available', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 5 }), // zone [1,5]
        makeElevator({ id: 'E2', currentFloor: 10 }), // zone [6,10]
      ],
      activeHallCalls: [{ floor: 6, direction: 'up' }],
    });

    // Floor 6 is only in E2's zone -- E1 stays idle even though fallback exists, because E2 (the
    // in-zone candidate) is actually available. Fallback only kicks in when no in-zone candidate
    // exists.
    expect(hook(snapshot)).toEqual([
      { type: 'idle', elevatorId: 'E1' },
      { type: 'travel', elevatorId: 'E2', direction: 'down' },
    ]);
  });

  it('floor 0 is still accepted by every elevator regardless of zone', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 5 }),
        makeElevator({ id: 'E2', currentFloor: 10 }),
      ],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
    });

    expect(hook(snapshot)).toEqual([
      { type: 'travel', elevatorId: 'E1', direction: 'down' },
      { type: 'idle', elevatorId: 'E2' },
    ]);
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('zoning-fallback');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
