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
import { algorithm as baseAlgorithm } from './nearestCarDirectional';
import { algorithm } from './nearestCarDirectionalHoming';

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

describe('nearestCarDirectionalHoming (hook-level)', () => {
  it('starts traveling down once idle for exactly the threshold, when not already at floor 0', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 }));
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

    const assigned = hook(
      makeSnapshot({
        time: 2000,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
        activeHallCalls: [{ floor: 8, direction: 'up' }],
        idleReturnThresholdMs: 5000,
      }),
    );
    expect(assigned).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);

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

    const atHome = makeElevator({ id: 'E1', currentFloor: 0 });
    const afterArriving = hook(
      makeSnapshot({ time: 10000, elevators: [atHome], idleReturnThresholdMs: 5000 }),
    );
    expect(afterArriving).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    const stillHome = hook(
      makeSnapshot({ time: 500000, elevators: [atHome], idleReturnThresholdMs: 5000 }),
    );
    expect(stillHome).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });
});

describe('nearestCarDirectionalHoming (integration: proactive repositioning reduces wait time)', () => {
  // Identical scenario/shape to fcfsNearestCarHoming.test.ts's own comparative test (see that
  // file's comment for the full reasoning) -- reused here because nearestCarDirectional's
  // candidate filter (isCompatible) treats every idle elevator as compatible regardless of
  // direction, so its behavior on this specific scenario is identical to FCFS's.
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
      arrival('setup1', 0, 'up', 8, 0),
      arrival('setup2', 0, 'up', 9, 60),
      arrival('trap', 0, 'up', 5, 5000),
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

    expect(baseWaitMs).toBeGreaterThan(500);
    expect(homingWaitMs).toBeLessThan(300);
    expect(homingWaitMs).toBeLessThan(baseWaitMs);
  });
});
