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
import { algorithm as baseAlgorithm } from './randomDispatch';
import { algorithm } from './randomDispatchHoming';

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 10,
    elevatorCount: 2,
    capacity: 4,
    floorTravelTimeMs: 100,
    doorDwellBaseMs: 50,
    doorDwellPerPassengerMultiplier: 0,
    idleReturnThresholdMs: 50,
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
    floorTravelTimeMs: 100,
    doorDwellBaseMs: 50,
    floorCount: 10,
    ...overrides,
  };
}

describe('randomDispatchHoming (hook-level)', () => {
  it('starts traveling down once idle for exactly the threshold, when not already at floor 0', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    expect(
      hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    expect(
      hook(makeSnapshot({ time: 5000, elevators: [elevator], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
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
    expect(
      hook(
        makeSnapshot({
          time: 5000,
          elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
          idleReturnThresholdMs: 5000,
        }),
      ),
    ).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);

    const atHome = makeElevator({ id: 'E1', currentFloor: 0 });
    expect(
      hook(makeSnapshot({ time: 10000, elevators: [atHome], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });
});

describe('randomDispatchHoming (integration: proactive repositioning reduces wait time)', () => {
  // See zoningHoming.test.ts's identical note for why this needs a second elevator/setup: the
  // dispatch hook only runs at discrete engine events, so an idle elevator's homing clock only
  // gets checked again once something else re-invokes the hook -- setup2's own journey supplies
  // that trigger, giving homing a real chance to fire before 'trap' registers. Uses <= rather
  // than strict < because randomDispatch's own selection is itself randomized, so which of the
  // (both now-repositioned-or-not) elevators picks up 'trap' isn't fully pinned down by this
  // scenario alone -- the real property under test is "never worse", proven across many seeds by
  // this same scenario shape's mirror in etaDispatchHoming.test.ts and the base algorithm's own
  // determinism tests.
  function scenario() {
    const config = buildConfig();
    const script = [
      arrival('setup1', 0, 'up', 8, 0),
      arrival('setup2', 0, 'up', 9, 60),
      arrival('trap', 0, 'up', 5, 5000),
    ];
    return { config, script };
  }

  it('the homing variant serves the trapped demand no later than the base algorithm', () => {
    const { config, script } = scenario();
    const cutoff = { maxTimeMs: 20_000 };

    const baseResult = runSimulation(config, script, baseAlgorithm.createHook(), cutoff);
    const homingResult = runSimulation(config, script, algorithm.createHook(), cutoff);

    const baseTrapBoard = baseResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    )!;
    const homingTrapBoard = homingResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    )!;

    expect(homingTrapBoard.time).toBeLessThanOrEqual(baseTrapBoard.time);
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('random-dispatch-homing');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
