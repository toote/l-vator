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
import { algorithm } from './scanLook';

const SAFETY_CUTOFF = { maxTimeMs: 60_000 };

// Local, self-contained test helpers — deliberately not imported from src/engine/testFixtures.ts.

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 6,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 100,
    doorDwellBaseMs: 100,
    doorDwellPerPassengerMultiplier: 0.5,
    idleReturnThresholdMs: 30000,
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
    idleReturnThresholdMs: 30000,
    floorTravelTimeMs: 1000,
    doorDwellBaseMs: 1000,
    floorCount: 10,
    ...overrides,
  };
}

function call(floor: FloorIndex, direction: Direction) {
  return { floor, direction };
}

describe('scanLook (integration)', () => {
  it('sweeps up, stops at 2 then 5, and reverses immediately rather than continuing to the top', () => {
    const config = buildConfig({ floorCount: 6, elevatorCount: 1 });

    // p1 (floor 2, up, dest 5) drives the pickup at 2 and continues the sweep to 5. p2 (floor 5,
    // up, dest 0) boards there and — because its destination (0) is BEHIND the elevator once it
    // reaches floor 5 — is what forces the reversal, rather than the elevator continuing on
    // toward the building's actual top floor (6), which nothing ever calls at.
    const script = [arrival('p1', 2, 'up', 5, 0), arrival('p2', 5, 'up', 0, 0)];

    const hook = algorithm.createHook();
    const { log } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    const arrivedFloors = log
      .filter((e) => e.type === 'elevatorArrived')
      .map((e) => (e.type === 'elevatorArrived' ? e.floor : undefined));

    expect(arrivedFloors).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1, 0]);
    expect(arrivedFloors).not.toContain(6); // never overshoots to the building's actual top

    const doorsOpenedFloors = log
      .filter((e) => e.type === 'doorsOpened')
      .map((e) => (e.type === 'doorsOpened' ? e.floor : undefined));
    expect(doorsOpenedFloors).toEqual([2, 5, 0]); // stops at 2, then 5, then (after reversing) 0
  });

  it('ignores an opposite-direction call while sweeping, but serves it after reversing', () => {
    const config = buildConfig({ floorCount: 5, elevatorCount: 1 });

    const script = [
      arrival('pUp', 2, 'up', 5, 0), // drives the initial upward sweep, picked up at 2
      arrival('pTurn', 5, 'up', 0, 0), // forces the reversal once dropped/boarded at 5
      arrival('pDown', 3, 'down', 1, 0), // opposite-direction call sitting in the sweep's path
    ];

    const hook = algorithm.createHook();
    const { log } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    const floor5Arrival = log.find((e) => e.type === 'elevatorArrived' && e.floor === 5);
    expect(floor5Arrival).toBeDefined();

    const doorsOpenedAtFloor3 = log.filter((e) => e.type === 'doorsOpened' && e.floor === 3);
    // Served exactly once, and only after the elevator reversed at floor 5 (not while it was
    // still sweeping up past floor 3 the first time).
    expect(doorsOpenedAtFloor3).toHaveLength(1);
    expect(doorsOpenedAtFloor3[0].time).toBeGreaterThan(floor5Arrival!.time);

    const alightedPDown = log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'pDown',
    );
    expect(alightedPDown).toBeDefined();
  });
});

describe('scanLook (capacity gating: does not get stuck once full)', () => {
  it('idle branch: a full elevator sitting on a pickup-only call routes toward its drop-off instead of stopping', () => {
    // Regression test for a real bug: with no capacity check, a full elevator sitting at a floor
    // with only an active (pickup) call would return 'stop' forever -- zero boarding (it's full),
    // so nothing about the situation ever changes, latching it there permanently instead of
    // routing to deliver the passengers it's already carrying. Same bug class already fixed in
    // fcfsNearestCar.ts/nearestCarDirectional.ts, missed here until the developer reported it.
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 2,
          capacityRemaining: 0,
          carButtons: [5], // onboard passenger destined for floor 5
        }),
      ],
      activeHallCalls: [call(2, 'up')], // pickup-only call at the elevator's own floor
    });

    const actions = hook(snapshot);
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);
  });

  it('committed-direction branch: a full elevator does not treat a same-direction call at its own floor as a reason to stop', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 2,
          state: 'moving',
          direction: 'up',
          capacityRemaining: 0,
          carButtons: [5],
        }),
      ],
      activeHallCalls: [call(2, 'up')],
    });

    const actions = hook(snapshot);
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);
  });

  it('integration: a full elevator passing through its own assigned floor departs toward its drop-off instead of looping', () => {
    // Deliberately keeps the elevator moving in ONE direction throughout (no backtrack), to
    // isolate the capacity-gating fix from a separate, independent bug this investigation also
    // turned up: SCAN/LOOK can strand a call behind an elevator that needs to backtrack to reach
    // it, regardless of capacity (see dev_log/03_algorithms_done.md's amendment for that one —
    // out of scope for this fix, flagged separately).
    const config = buildConfig({
      floorCount: 6,
      elevatorCount: 1,
      capacity: 2,
      floorTravelTimeMs: 100,
      doorDwellBaseMs: 50,
      doorDwellPerPassengerMultiplier: 0,
    });

    // p1/p2 fill the elevator at floor 2 and ride to floor 5. p3, also at floor 2 and also going
    // up, is left behind (capacity), but is irrelevant to this test's assertion -- the point is
    // solely that the elevator doesn't get stuck re-opening its doors at floor 2 once full.
    const script = [
      arrival('p1', 2, 'up', 5, 0),
      arrival('p2', 2, 'up', 5, 0),
      arrival('p3', 2, 'up', 5, 0),
    ];

    const { log } = runSimulation(config, script, algorithm.createHook(), {
      maxTimeMs: 10_000,
    });

    const doorsOpenedAtFloor2 = log.filter((e) => e.type === 'doorsOpened' && e.floor === 2);
    expect(doorsOpenedAtFloor2).toHaveLength(1); // stops once, boards 2, then departs -- no loop

    const alightedAtFloor5 = log.filter((e) => e.type === 'passengerAlighted' && e.floor === 5);
    expect(alightedAtFloor5).toHaveLength(2); // both onboard passengers actually get delivered
  });
});

describe('scanLook (hook-level)', () => {
  it('an idle elevator picks the initial direction toward the nearest pending floor', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
      // Nearest pending floor is 2 (distance 3), not 9 (distance 4) — and note the call's own
      // direction ('up') is irrelevant to this initial pick; only position matters.
      activeHallCalls: [call(2, 'up'), call(9, 'down')],
    });

    const actions = hook(snapshot);
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });

  it('goes idle, without getting stuck, when nothing is pending in either direction', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 5, state: 'moving', direction: 'up' })],
      activeHallCalls: [],
    });

    const actions = hook(snapshot);
    expect(actions).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });

  it('never returns more than one action for the same elevator id', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 0, state: 'moving', direction: 'up' }),
        makeElevator({ id: 'E2', currentFloor: 4 }),
        makeElevator({ id: 'E3', currentFloor: 9, state: 'moving', direction: 'down' }),
      ],
      activeHallCalls: [call(3, 'up'), call(6, 'down'), call(1, 'down')],
    });

    const actions = hook(snapshot);
    const ids = actions.map((a) => a.elevatorId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['E1', 'E2', 'E3']);
  });
});
