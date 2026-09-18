import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, ElevatorSnapshot, HallCall } from '../engine';
import { algorithm, estimateArrivalMs } from './etaDispatch';

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

describe('estimateArrivalMs', () => {
  const call: HallCall = { floor: 10, direction: 'up' };

  it('compatible, no intermediate stops: pure travel time', () => {
    const elevator = makeElevator({ id: 'E1', currentFloor: 3, state: 'idle' });
    // distance(3,10)=7 * 100 = 700, no carButtons -> 0 dwell.
    expect(estimateArrivalMs(elevator, call, 100, 50)).toBe(700);
  });

  it('compatible, with intermediate stops: travel time plus one dwell per stop strictly en route', () => {
    const elevator = makeElevator({
      id: 'E1',
      currentFloor: 3,
      state: 'moving',
      direction: 'up',
      carButtons: [5, 7],
    });
    // distance(3,10)=7*100=700, stops strictly between 3 and 10: {5,7} -> 2*50=100.
    expect(estimateArrivalMs(elevator, call, 100, 50)).toBe(800);
  });

  it('incompatible (wrong direction, with carButtons): finish the current sweep, reverse, then travel to the call', () => {
    const elevator = makeElevator({
      id: 'E1',
      currentFloor: 8,
      state: 'moving',
      direction: 'down',
      carButtons: [2, 4, 6],
    });
    const upCall: HallCall = { floor: 10, direction: 'up' };
    // turnaroundFloor = min(carButtons) = 2 (heading down).
    // distance(8,2)=6*100=600; stops strictly-after-8-up-to-and-including-2: {6,4,2} -> 3*50=150.
    // distance(2,10)=8*100=800. Total 600+150+800=1550.
    expect(estimateArrivalMs(elevator, upCall, 100, 50)).toBe(1550);
  });

  it('incompatible, no carButtons: reverses immediately at its current position (turnaround = currentFloor)', () => {
    const elevator = makeElevator({
      id: 'E1',
      currentFloor: 8,
      state: 'moving',
      direction: 'up',
      carButtons: [],
    });
    const downCall: HallCall = { floor: 2, direction: 'down' };
    // turnaroundFloor = currentFloor = 8 (nothing to finish). distance(8,8)=0, 0 stops,
    // distance(8,2)=6*100=600. Total 600.
    expect(estimateArrivalMs(elevator, downCall, 100, 50)).toBe(600);
  });

  it('idle is always compatible, regardless of a stale `direction`', () => {
    const elevator = makeElevator({ id: 'E1', currentFloor: 0, state: 'idle', direction: 'down' });
    // Straight-line, no penalty, even though `direction` says 'down' and the call is 'up'.
    expect(estimateArrivalMs(elevator, call, 100, 50)).toBe(1000);
  });
});

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

describe('etaDispatch (hook-level)', () => {
  it('a nearer-but-wrong-direction car with many stops loses to a farther-but-compatible car', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        // E1 is literally AT the call floor already, but heading down with a long sweep of
        // carButtons ahead of it in that direction -- estimated cost 1800 (see estimateArrivalMs
        // test above for the identical hand-computed scenario).
        makeElevator({
          id: 'E1',
          currentFloor: 9,
          state: 'moving',
          direction: 'down',
          carButtons: [7, 5, 3, 1],
        }),
        // E2 is 7 floors away but idle -- straight-line cost 700.
        makeElevator({ id: 'E2', currentFloor: 2 }),
      ],
      activeHallCalls: [{ floor: 9, direction: 'up' }],
    });

    const actions = hook(snapshot);
    // E2 wins the assignment despite being much farther in raw distance.
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'up' });
    // E1 is unaffected by the call -- it just continues toward its own nearest carButton.
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'down' });
  });

  it('drop-offs always take priority over a new pickup, same as every other algorithm', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 5, carButtons: [5] })],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
    });
    expect(hook(snapshot)).toEqual([{ type: 'stop', elevatorId: 'E1' }]);
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('eta-dispatch');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
