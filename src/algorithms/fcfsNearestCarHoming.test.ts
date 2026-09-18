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
import { algorithm as baseAlgorithm } from './fcfsNearestCar';
import { algorithm } from './fcfsNearestCarHoming';

// Local, self-contained test helpers — mirrors fcfsNearestCar.test.ts's own exactly.

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 10,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 500,
    doorDwellBaseMs: 1000,
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
    ...overrides,
  };
}

describe('fcfsNearestCarHoming (hook-level)', () => {
  it('does NOT reverse a car actually carrying passengers to answer a call behind it -- mirrors fcfsNearestCar.test.ts’s identical developer-reported-bug regression', () => {
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [
        makeElevator({
          id: 'E1',
          currentFloor: 1,
          state: 'moving',
          direction: 'up',
          capacityRemaining: 2,
          carButtons: [2, 3, 4, 5, 6, 7],
        }),
        makeElevator({ id: 'E2', currentFloor: 6, capacityRemaining: 4 }),
      ],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
    });

    const actions = hook(snapshot);

    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E1', direction: 'up' });
    expect(actions).toContainEqual({ type: 'travel', elevatorId: 'E2', direction: 'down' });
  });

  it('starts traveling down once idle for exactly the threshold, when not already at floor 0', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    // First invocation while idle stamps idleSince at this snapshot's time.
    expect(
      hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // Idle for exactly the threshold (5000 - 0 = 5000) and not at floor 0 -> homes.
    const actions = hook(
      makeSnapshot({ time: 5000, elevators: [elevator], idleReturnThresholdMs: 5000 }),
    );
    expect(actions).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });

  it('stays idle when idle for less than the threshold', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 }));
    const actions = hook(
      makeSnapshot({ time: 4999, elevators: [elevator], idleReturnThresholdMs: 5000 }),
    );
    expect(actions).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });

  it('a real assignment before the threshold elapses overrides the idle clock, which restarts cleanly if idle again later', () => {
    const hook = algorithm.createHook();

    // t=0: idle, no calls -> idleSince stamped at 0.
    expect(
      hook(
        makeSnapshot({
          time: 0,
          elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
          activeHallCalls: [],
          idleReturnThresholdMs: 5000,
        }),
      ),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // t=2000 (< threshold): a real call appears and gets assigned -> travel, not idle. If the
    // clock had kept ticking from t=0 unaffected, that alone wouldn't be visible yet (2000 < 5000)
    // -- the real proof is the next block, which shows the clock actually reset rather than just
    // not having fired yet.
    const assigned = hook(
      makeSnapshot({
        time: 2000,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
        activeHallCalls: [{ floor: 8, direction: 'up' }],
        idleReturnThresholdMs: 5000,
      }),
    );
    expect(assigned).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);

    // The elevator is now idle again at floor 8 (call served), t=10000. If idleSince had NOT been
    // cleared at t=2000, the stale idleSince=0 would already show idleFor=10000 >= 5000 and this
    // invocation would immediately home instead of returning idle.
    expect(
      hook(
        makeSnapshot({
          time: 10000,
          elevators: [makeElevator({ id: 'E1', currentFloor: 8 })],
          activeHallCalls: [],
          idleReturnThresholdMs: 5000,
        }),
      ),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // Just under the NEW threshold (10000 + 5000 - 1): still idle -- proves the clock restarted
    // fresh at 10000, not reused the earlier (already-expired) 0.
    expect(
      hook(
        makeSnapshot({
          time: 14999,
          elevators: [makeElevator({ id: 'E1', currentFloor: 8 })],
          activeHallCalls: [],
          idleReturnThresholdMs: 5000,
        }),
      ),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // Exactly at the new threshold: homes.
    expect(
      hook(
        makeSnapshot({
          time: 15000,
          elevators: [makeElevator({ id: 'E1', currentFloor: 8 })],
          activeHallCalls: [],
          idleReturnThresholdMs: 5000,
        }),
      ),
    ).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });

  it('stays idle (no pointless travel) when idle too long but already at floor 0', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 0 });

    hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 }));
    const actions = hook(
      makeSnapshot({ time: 50000, elevators: [elevator], idleReturnThresholdMs: 5000 }),
    );
    expect(actions).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
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

    // Elevator has now (per the engine) arrived at floor 0. Next invocation must not re-issue
    // travel -- floor 0 is home, nothing left to do.
    const atHome = makeElevator({ id: 'E1', currentFloor: 0 });
    const afterArriving = hook(
      makeSnapshot({ time: 10000, elevators: [atHome], idleReturnThresholdMs: 5000 }),
    );
    expect(afterArriving).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // And it doesn't loop: much later, still just idles, never re-issuing travel.
    const stillHome = hook(
      makeSnapshot({ time: 500000, elevators: [atHome], idleReturnThresholdMs: 5000 }),
    );
    expect(stillHome).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });
});

describe('fcfsNearestCarHoming (integration: proactive repositioning reduces wait time)', () => {
  // Real, measured comparison against the base (non-homing) algorithm on the identical scripted
  // scenario -- not a hollow always-passes assertion. Two elevators are sent on one-off deliveries
  // (E1 -> floor 8, E2 -> floor 9) that leave both stranded far from floor 0. A generous idle gap
  // (trap arrives at t=5000) gives the homing variant plenty of time to fully reposition both
  // elevators back to floor 0 before the real demand ('trap', floor 0/up) arrives. Under the base
  // algorithm, neither elevator ever moves once idle, so the nearer one (E1, floor 8) must make an
  // ~800ms detour to reach the trap call; under homing, it's already sitting at floor 0.
  function scenario() {
    const config = buildConfig({
      floorCount: 10,
      elevatorCount: 2,
      capacity: 4,
      floorTravelTimeMs: 100,
      doorDwellBaseMs: 50,
      doorDwellPerPassengerMultiplier: 0,
      idleReturnThresholdMs: 50,
    });
    const script = [
      arrival('setup1', 0, 'up', 8, 0), // sends E1 (tie-break: nearest idle) up to floor 8
      arrival('setup2', 0, 'up', 9, 60), // registered only once E1 has departed floor 0 -> E2
      arrival('trap', 0, 'up', 5, 5000), // the demand this test measures response time to
    ];
    return { config, script };
  }

  it('the homing variant serves the trapped demand far faster than the base algorithm, on the identical scenario', () => {
    const { config, script } = scenario();
    const cutoff = { maxTimeMs: 20_000 };

    const baseResult = runSimulation(config, script, baseAlgorithm.createHook(), cutoff);
    const homingResult = runSimulation(config, script, algorithm.createHook(), cutoff);

    const baseTrapBoard = baseResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    const homingTrapBoard = homingResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    expect(baseTrapBoard).toBeDefined();
    expect(homingTrapBoard).toBeDefined();

    const TRAP_ARRIVAL_TIME = 5000;
    const baseWaitMs = baseTrapBoard!.time - TRAP_ARRIVAL_TIME;
    const homingWaitMs = homingTrapBoard!.time - TRAP_ARRIVAL_TIME;

    // Base: the nearest idle elevator (floor 8) never moved proactively, so it must make the full
    // ~800ms (8 floors * 100ms) trip down before it can pick up the trap passenger.
    expect(baseWaitMs).toBeGreaterThan(500);
    // Homing: both elevators have long since repositioned to floor 0 (idle threshold 50ms, huge
    // margin before t=5000), so the trap passenger is served essentially immediately.
    expect(homingWaitMs).toBeLessThan(300);
    // The actual point of this unit, stated as a direct comparison: homing measurably helps.
    expect(homingWaitMs).toBeLessThan(baseWaitMs);
  });
});
