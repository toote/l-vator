import { describe, expect, it } from 'vitest';

import type {
  BuildingConfig,
  Direction,
  DispatchSnapshot,
  ElevatorSnapshot,
  FloorIndex,
  PassengerArrival,
} from '../engine';
import { runSimulation } from '../engine';
import { algorithms } from './index';
import { algorithm as fcfsNearestCar } from './fcfsNearestCar';
import { algorithm as nearestCarDirectional } from './nearestCarDirectional';
import { algorithm as scanLook } from './scanLook';

// Local, self-contained test helpers — deliberately not imported from src/engine/testFixtures.ts.

function buildConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 10,
    elevatorCount: 2,
    capacity: 4,
    floorTravelTimeMs: 100,
    doorDwellBaseMs: 100,
    doorDwellPerPassengerMultiplier: 0,
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

const SAFETY_CUTOFF = { maxTimeMs: 60_000 };

describe('cross-algorithm comparative sanity', () => {
  // Amendment (post-Unit-10, at developer request): FCFS's candidate selection now prefers a
  // genuinely idle elevator (zero car buttons) over a busy one, when one exists — a fix for a
  // real bug where a busy elevator could hold a pickup assignment hostage indefinitely (see
  // dev_log/03_algorithms_done.md's "Unvisited timeout" amendment). That means the ORIGINAL
  // version of this scenario (one busy car vs. one plain idle car) no longer demonstrates FCFS's
  // naive flaw — idle-preference now correctly picks the idle car regardless of algorithm,
  // exactly like directional matching already did. The remaining, still-real distinction: when
  // NO idle car exists (every candidate is busy), FCFS still ignores direction entirely while
  // directional matching doesn't. See the dedicated hook-level test below for a precise,
  // timing-independent proof of that; this describe block's integration scenario is redesigned
  // to keep BOTH elevators busy at the moment 'trap' registers, so it still exercises that tier.
  //
  // 'e1setup' sends E1 up to floor 9 first, boards, then heads down toward its destination 0.
  // 'e2setup' (staggered to arrive at t=500, once E1 is already well up the shaft) sends E2 up
  // toward destination 10. 'trap' registers at floor 9, up, at t=1150 — by then E1 has already
  // picked up 'e1setup' and left floor 9 heading down (its own pickup assignment released once
  // it departed, per the overflow-handoff mechanism), but is still BUSY carrying 'e1setup'
  // (hasn't reached floor 0 yet) — near floor 9 (distance ~1) but heading the wrong way. E2 is
  // also busy (carrying 'e2setup' up toward floor 10) — farther from floor 9 (distance ~4) but
  // heading the right way. Neither is idle, so idle-preference doesn't apply to either.
  const script = [
    arrival('e1setup', 9, 'down', 0, 0),
    arrival('e2setup', 0, 'up', 10, 500),
    arrival('trap', 9, 'up', 10, 1150),
  ];

  it('FCFS ignores direction even when candidate selection now prefers idle cars: the nearer-but-wrong-way busy car still gets picked over the farther-but-compatible busy car', () => {
    // Direct, timing-independent proof at the decision level, rather than relying on end-to-end
    // simulation timing to expose it: hand-crafted snapshot with BOTH elevators busy (so
    // idle-preference can't apply to either), E1 nearer but heading away, E2 farther but
    // compatible. A second call (after each elevator's existing car button clears, revealing
    // which one is actually pulled toward the call) shows which one was assigned.
    function makeElevator(overrides: Partial<ElevatorSnapshot> & { id: string }): ElevatorSnapshot {
      return {
        currentFloor: 0,
        state: 'moving',
        direction: null,
        passengerCount: 0,
        capacityRemaining: 4,
        carButtons: [],
        ...overrides,
      };
    }
    const busy: DispatchSnapshot = {
      time: 1000,
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 8, direction: 'down', carButtons: [0] }),
        makeElevator({ id: 'E2', currentFloor: 2, direction: 'up', carButtons: [10] }),
      ],
      activeHallCalls: [{ floor: 9, direction: 'up' }],
      idleReturnThresholdMs: 30000,
      floorTravelTimeMs: 100,
    };
    const cleared: DispatchSnapshot = {
      ...busy,
      time: 1050,
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 8, direction: 'down' }),
        makeElevator({ id: 'E2', currentFloor: 2, direction: 'up' }),
      ],
    };

    const fcfsHook = fcfsNearestCar.createHook();
    fcfsHook(busy);
    expect(fcfsHook(cleared)).toEqual([
      { type: 'travel', elevatorId: 'E1', direction: 'up' }, // nearer, wrong-way E1 was assigned
      { type: 'idle', elevatorId: 'E2' },
    ]);

    const directionalHook = nearestCarDirectional.createHook();
    directionalHook(busy);
    expect(directionalHook(cleared)).toEqual([
      { type: 'idle', elevatorId: 'E1' }, // correctly excluded: wrong direction
      { type: 'travel', elevatorId: 'E2', direction: 'up' }, // farther-but-compatible E2 instead
    ]);
  });

  it('nearest-car-directional sends the farther-but-compatible car, correctly excluding the nearer-but-wrong-way one', () => {
    const config = buildConfig();
    const { log } = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );

    const trapBoard = log.find((e) => e.type === 'passengerBoarded' && e.passengerId === 'trap');
    expect(trapBoard).toBeDefined();
    expect(trapBoard).toMatchObject({ elevatorId: 'E2' });
  });

  it('delivers the trapped passenger no later under directional matching than under plain FCFS', () => {
    const config = buildConfig();
    const fcfsResult = runSimulation(config, script, fcfsNearestCar.createHook(), SAFETY_CUTOFF);
    const directionalResult = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );

    const fcfsDelivery = fcfsResult.log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'trap',
    );
    const directionalDelivery = directionalResult.log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'trap',
    );
    expect(fcfsDelivery).toBeDefined();
    expect(directionalDelivery).toBeDefined();
    // Strictly less, not just <=: FCFS initially picks the wrong-way E1 (naive, ignores
    // direction), which the unvisited-release timeout eventually corrects (reassigning to E2)
    // once E1 fails to actually visit floor 9 — but only after that timeout elapses, so FCFS
    // still delivers measurably later than directional matching's immediate correct pick.
    expect(directionalDelivery!.time).toBeLessThan(fcfsDelivery!.time);
  });

  it('SCAN/LOOK is a genuinely different strategy, not a third name for one of the other two', () => {
    const config = buildConfig();
    const fcfsResult = runSimulation(config, script, fcfsNearestCar.createHook(), SAFETY_CUTOFF);
    const directionalResult = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );
    const scanResult = runSimulation(config, script, scanLook.createHook(), SAFETY_CUTOFF);

    // SCAN/LOOK never maintains a call-to-elevator assignment map at all, so it's a meaningfully
    // different fleet-usage pattern to compare against directly: SCAN commits whichever elevator
    // first goes idle-and-picks-a-direction, independent of any assignment bookkeeping.
    expect(scanResult.log).not.toEqual(fcfsResult.log);
    expect(scanResult.log).not.toEqual(directionalResult.log);

    // Still fully serves every passenger, whichever car(s) it used.
    expect(scanResult.finalState.waitingPassengers).toEqual([]);
    for (const passengerId of ['trap', 'e1setup', 'e2setup']) {
      expect(
        scanResult.log.filter(
          (e) => e.type === 'passengerAlighted' && e.passengerId === passengerId,
        ),
      ).toHaveLength(1);
    }
  });
});

describe('algorithms discovery (index.ts)', () => {
  it('contains exactly the six expected algorithms, discovered automatically (Unit 10 added the three homing variants)', () => {
    expect(algorithms).toHaveLength(6);
    expect(algorithms.map((a) => a.id).sort()).toEqual([
      'fcfs-nearest-car',
      'fcfs-nearest-car-homing',
      'nearest-car-directional',
      'nearest-car-directional-homing',
      'scan-look',
      'scan-look-homing',
    ]);
  });

  it('excludes types.ts, shared.ts, and test files — every discovered entry has a real Algorithm shape', () => {
    for (const entry of algorithms) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.createHook).toBe('function');
      // Every factory actually produces a callable hook, proving these are real algorithm
      // modules (types.ts/shared.ts export no such shape and would have failed this).
      expect(typeof entry.createHook()).toBe('function');
    }
  });
});
