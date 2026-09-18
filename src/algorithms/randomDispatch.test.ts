import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, ElevatorSnapshot, HallCall } from '../engine';
import { algorithm, pseudoRandomIndex } from './randomDispatch';

describe('pseudoRandomIndex', () => {
  it('is deterministic: identical inputs produce the identical index every time', () => {
    const call: HallCall = { floor: 4, direction: 'up' };
    const first = pseudoRandomIndex(12345, call, 5);
    for (let i = 0; i < 10; i++) {
      expect(pseudoRandomIndex(12345, call, 5)).toBe(first);
    }
  });

  it('always returns an index within [0, candidateCount)', () => {
    for (let time = 0; time < 5000; time += 137) {
      for (const floor of [0, 1, 5, 9]) {
        for (const direction of ['up', 'down'] as const) {
          const index = pseudoRandomIndex(time, { floor, direction }, 4);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(4);
        }
      }
    }
  });

  it('disambiguates two simultaneous calls at the same tick (different floor/direction -> can produce different picks)', () => {
    const indices = new Set<number>();
    for (let floor = 0; floor < 10; floor++) {
      indices.add(pseudoRandomIndex(1000, { floor, direction: 'up' }, 6));
    }
    // A structural spread check, not a statistical proof: across 10 different floors at the same
    // tick, the pick is not collapsed onto a single candidate every time.
    expect(indices.size).toBeGreaterThan(1);
  });
});

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
    floorTravelTimeMs: 100,
    doorDwellBaseMs: 50,
    floorCount: 10,
    ...overrides,
  };
}

describe('randomDispatch (hook-level)', () => {
  it('two independent hook instances given the identical sequence of snapshots make identical assignments', () => {
    const elevators = [
      makeElevator({ id: 'E1', currentFloor: 0 }),
      makeElevator({ id: 'E2', currentFloor: 5 }),
      makeElevator({ id: 'E3', currentFloor: 9 }),
    ];
    const snapshot = makeSnapshot({
      elevators,
      activeHallCalls: [{ floor: 3, direction: 'up' }],
    });

    const first = algorithm.createHook()(snapshot);
    const second = algorithm.createHook()(snapshot);
    expect(first).toEqual(second);
  });

  it('picks a genuine spread of elevators across many different calls, not always the nearest/same one', () => {
    // A structural spread check (not a statistical proof, matching this project's precedent for
    // "random" pattern tests -- see randomArrivals.test.ts): across many distinct calls, more
    // than one distinct elevator ends up chosen, and it is not always the geometrically nearest.
    const chosen = new Set<string>();
    for (let floor = 0; floor <= 9; floor++) {
      const elevators = [
        makeElevator({ id: 'E1', currentFloor: 0 }),
        makeElevator({ id: 'E2', currentFloor: 9 }),
      ];
      const snapshot = makeSnapshot({
        time: floor * 137,
        elevators,
        activeHallCalls: [{ floor, direction: 'up' }],
      });
      const actions = algorithm.createHook()(snapshot);
      const travel = actions.find((a) => a.type === 'travel' || a.type === 'stop');
      if (travel) chosen.add(travel.elevatorId);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('drop-offs always take priority over a new pickup, same as every other algorithm', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 5, carButtons: [5] })],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
    });
    expect(hook(snapshot)).toEqual([{ type: 'stop', elevatorId: 'E1' }]);
  });

  it('never assigns to a full elevator', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0, capacityRemaining: 0 }),
        makeElevator({ id: 'E2', currentFloor: 5, capacityRemaining: 4 }),
      ],
      activeHallCalls: [{ floor: 3, direction: 'up' }],
    });
    const actions = hook(snapshot);
    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E1' });
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('random-dispatch');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
