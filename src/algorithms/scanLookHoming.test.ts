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
import { algorithm as baseAlgorithm } from './scanLook';
import { algorithm } from './scanLookHoming';

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 10,
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

describe('scanLookHoming (hook-level)', () => {
  it('starts traveling down once idle for exactly the threshold, when not already at floor 0 (idle-direction branch)', () => {
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

  it('a real target before the threshold elapses overrides the idle clock, which restarts cleanly if idle again later', () => {
    const hook = algorithm.createHook();

    // t=0: idle, nothing pending -> idleSince stamped at 0.
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

    // t=2000 (< threshold): a real call appears -> travel toward it, not idle.
    const assigned = hook(
      makeSnapshot({
        time: 2000,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5 })],
        activeHallCalls: [{ floor: 8, direction: 'up' }],
        idleReturnThresholdMs: 5000,
      }),
    );
    expect(assigned).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'up' }]);

    // Idle again at floor 8, t=10000. A stale (un-cleared) idleSince=0 would already show
    // idleFor=10000 >= 5000 and home immediately instead of returning idle here.
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

    // Just under the NEW threshold: still idle -- proves the clock restarted fresh at 10000.
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

  it("the committed-direction branch's own idle fallback shares the same idleSince entry as the idle-direction branch (both fallbacks, one clock)", () => {
    const hook = algorithm.createHook();

    // Idle-direction branch stamps idleSince at t=0.
    hook(
      makeSnapshot({
        time: 0,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5, direction: null })],
        idleReturnThresholdMs: 1000,
      }),
    );

    // By t=900 (< threshold), the engine has set elevator.direction: 'down' from some earlier real
    // travel (e.g. it was mid-sweep before running out of pending floors) -- so this invocation
    // lands in the COMMITTED-direction branch's own idle fallback, not the idle-direction one.
    // Still below threshold relative to the SAME idleSince=0 -> still idle, not homing yet.
    const stillIdle = hook(
      makeSnapshot({
        time: 900,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5, state: 'idle', direction: 'down' })],
        idleReturnThresholdMs: 1000,
      }),
    );
    expect(stillIdle).toEqual([{ type: 'idle', elevatorId: 'E1' }]);

    // At t=1000 (== threshold, same idleSince=0 from the FIRST fallback point), the
    // committed-direction branch's fallback now homes -- proving both fallback points read/write
    // the one shared idleSince map, not independent clocks.
    const homes = hook(
      makeSnapshot({
        time: 1000,
        elevators: [makeElevator({ id: 'E1', currentFloor: 5, state: 'idle', direction: 'down' })],
        idleReturnThresholdMs: 1000,
      }),
    );
    expect(homes).toEqual([{ type: 'travel', elevatorId: 'E1', direction: 'down' }]);
  });
});

describe('scanLookHoming (integration: proactive repositioning reduces wait time)', () => {
  // Same shape/reasoning as fcfsNearestCarHoming.test.ts's comparative test, tuned for SCAN's own
  // dispatch quirks: both elevators start idle at floor 0, so the very first call (setup1) makes
  // BOTH of them independently decide to stop there (SCAN has no per-call ownership/assignment
  // map) -- E1 actually boards the passenger and departs; E2's stop boards nobody (harmless,
  // pre-existing SCAN behavior, unrelated to homing) and it settles back at floor 0 almost
  // immediately. setup2 is deliberately registered only once E1 has already departed floor 0 (so
  // E1 is no longer idle/competing), sending E2 on its own trip to floor 9 -- whose floor-by-floor
  // hops are what give E1's (and later E2's) idle-too-long clocks repeated chances to fire well
  // before the real 'trap' demand arrives.
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
      arrival('setup2', 0, 'up', 9, 200),
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
