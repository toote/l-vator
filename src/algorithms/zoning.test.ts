import { describe, expect, it } from 'vitest';

import type { DispatchSnapshot, ElevatorSnapshot } from '../engine';
import { algorithm, zoneFor } from './zoning';

describe('zoneFor', () => {
  it('divides floors evenly when floorCount is a multiple of elevatorCount', () => {
    expect(zoneFor(0, 3, 9)).toEqual({ min: 1, max: 3 });
    expect(zoneFor(1, 3, 9)).toEqual({ min: 4, max: 6 });
    expect(zoneFor(2, 3, 9)).toEqual({ min: 7, max: 9 });
  });

  it('gives the first `remainder` zones one extra floor, not the last zone a big remainder', () => {
    // 10 floors / 3 elevators -> base 3, remainder 1: zone 0 gets 4 floors, the rest get 3.
    expect(zoneFor(0, 3, 10)).toEqual({ min: 1, max: 4 });
    expect(zoneFor(1, 3, 10)).toEqual({ min: 5, max: 7 });
    expect(zoneFor(2, 3, 10)).toEqual({ min: 8, max: 10 });
  });

  it('a single elevator gets the entire floor range', () => {
    expect(zoneFor(0, 1, 10)).toEqual({ min: 1, max: 10 });
  });

  it('more elevators than floors: the first floorCount zones get exactly one floor, the rest are empty (min > max)', () => {
    expect(zoneFor(0, 5, 2)).toEqual({ min: 1, max: 1 });
    expect(zoneFor(1, 5, 2)).toEqual({ min: 2, max: 2 });
    expect(zoneFor(2, 5, 2)).toEqual({ min: 3, max: 2 });
    expect(zoneFor(3, 5, 2)).toEqual({ min: 3, max: 2 });
    expect(zoneFor(4, 5, 2)).toEqual({ min: 3, max: 2 });
  });

  it('a zone of exactly one floor', () => {
    expect(zoneFor(0, 10, 10)).toEqual({ min: 1, max: 1 });
    expect(zoneFor(9, 10, 10)).toEqual({ min: 10, max: 10 });
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
    floorTravelTimeMs: 1000,
    doorDwellBaseMs: 1000,
    floorCount: 10,
    ...overrides,
  };
}

describe('zoning (hook-level)', () => {
  it('assigns a call to the elevator whose zone covers it, even when a nearer elevator from another zone exists', () => {
    // floorCount 10, 2 elevators -> E1's zone [1,5], E2's zone [6,10]. Call at floor 6 is in E2's
    // zone only, even though E1 (at floor 5) is geometrically nearer.
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 5 }),
        makeElevator({ id: 'E2', currentFloor: 10 }),
      ],
      activeHallCalls: [{ floor: 6, direction: 'up' }],
    });

    expect(hook(snapshot)).toEqual([
      { type: 'idle', elevatorId: 'E1' }, // out of zone -- not a candidate at all
      { type: 'travel', elevatorId: 'E2', direction: 'down' },
    ]);
  });

  it('floor 0 is accepted by every elevator regardless of zone', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 5 }), // zone [1,5]
        makeElevator({ id: 'E2', currentFloor: 10 }), // zone [6,10]
      ],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
    });

    // Nearest wins among the (both eligible, since floor 0 is unzoned) candidates: E1 at distance
    // 5 beats E2 at distance 10.
    expect(hook(snapshot)).toEqual([
      { type: 'travel', elevatorId: 'E1', direction: 'down' },
      { type: 'idle', elevatorId: 'E2' },
    ]);
  });

  it('an in-zone drop-off is always honored regardless of the elevator carrying it now sitting outside its own zone', () => {
    const hook = algorithm.createHook();
    // E1's zone is [1,5], but it's carrying a passenger bound for floor 8 (outside its zone) --
    // this can legitimately happen since destinations are unknown at pickup time. Zoning must
    // never abandon a passenger already aboard.
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 8, carButtons: [8] })],
      activeHallCalls: [],
    });

    expect(hook(snapshot)).toEqual([{ type: 'stop', elevatorId: 'E1' }]);
  });

  it('strict: a call is left unassigned when every zone-eligible elevator is full, even while an out-of-zone elevator sits idle', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        // E1's zone is [1,5]; it's full (no capacity) so it can't take the call at floor 3.
        makeElevator({ id: 'E1', currentFloor: 3, capacityRemaining: 0, carButtons: [3] }),
        // E2's zone is [6,10]; genuinely idle and available, but NOT eligible for floor 3.
        makeElevator({ id: 'E2', currentFloor: 6 }),
      ],
      activeHallCalls: [{ floor: 3, direction: 'up' }],
    });

    const actions = hook(snapshot);
    expect(actions).toContainEqual({ type: 'idle', elevatorId: 'E2' }); // never redirected out of zone
    // E1 stops for its own carButton (the passenger already aboard), not for the new call --
    // this scenario's real point is that the floor-3 hall call itself has nobody to serve it.
    expect(actions).toContainEqual({ type: 'stop', elevatorId: 'E1' });
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('zoning');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
