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
import { algorithm as baseAlgorithm } from './zoning';
import { algorithm } from './zoningHoming';

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 10,
    elevatorCount: 2,
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
    doorDwellBaseMs: 1000,
    floorCount: 10,
    ...overrides,
  };
}

describe('zoningHoming (hook-level)', () => {
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

  it('stays idle when idle for less than the threshold', () => {
    const hook = algorithm.createHook();
    const elevator = makeElevator({ id: 'E1', currentFloor: 3 });

    hook(makeSnapshot({ time: 0, elevators: [elevator], idleReturnThresholdMs: 5000 }));
    const actions = hook(
      makeSnapshot({ time: 4999, elevators: [elevator], idleReturnThresholdMs: 5000 }),
    );
    expect(actions).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
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
    expect(
      hook(makeSnapshot({ time: 10000, elevators: [atHome], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
    expect(
      hook(makeSnapshot({ time: 500000, elevators: [atHome], idleReturnThresholdMs: 5000 })),
    ).toEqual([{ type: 'idle', elevatorId: 'E1' }]);
  });

  it('a homing (idle, drifting-toward-home) elevator remains a completely ordinary zone-eligible candidate', () => {
    // Floor 0 is unzoned -- every elevator, homing or not, is always eligible for it.
    const hook = algorithm.createHook();
    const snapshot = makeSnapshot({
      elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
      activeHallCalls: [{ floor: 0, direction: 'up' }],
      idleReturnThresholdMs: 5000,
    });
    expect(hook(snapshot)).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });
});

describe('zoningHoming (integration: proactive repositioning reduces wait time)', () => {
  // Mirrors nearestCarDirectionalHoming.test.ts's own comparative scenario shape exactly --
  // including WHY it needs a second elevator/setup, not just one: the dispatch hook only runs at
  // discrete engine events (arrivals, doors closing), never on a periodic timer, so an idle
  // elevator's homing clock only gets checked again whenever SOME event re-invokes the hook.
  // With only one elevator and one setup, nothing re-invokes the hook between E1 going idle and
  // the real demand arriving, so homing never gets a chance to fire early -- it would only
  // "catch up" at the exact moment the real call already needs a response, making the two
  // algorithms indistinguishable. The second elevator's own journey (setup2) supplies that
  // extra trigger, giving E1's homing clock a chance to fire well before 'trap' registers.
  // Both origins are floor 0 (unzoned/universal), so zoning's own eligibility rule doesn't
  // interfere with which elevator picks up which setup.
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
    )!;
    const homingTrapBoard = homingResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    )!;

    expect(homingTrapBoard.time).toBeLessThan(baseTrapBoard.time);
  });
});

describe('algorithms discovery shape', () => {
  it('exposes a valid Algorithm entry', () => {
    expect(algorithm.id).toBe('zoning-homing');
    expect(algorithm.description.length).toBeGreaterThan(0);
    expect(typeof algorithm.createHook()).toBe('function');
  });
});
