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
  // Amendment (post-Unit-10, at developer request, second amendment): FCFS's candidate selection
  // now also enforces direction compatibility for any elevator actually CARRYING passengers —
  // developer-reported real bug: an elevator with 8 onboard passengers, 8 different destinations,
  // could get assigned a brand new pickup behind it the moment it dropped someone off at an
  // intermediate stop, before ever actually reversing to go fetch it. "Once a passenger presses a
  // button, the elevator won't change direction to answer a call outside that commitment." See
  // fcfsNearestCar.ts's `isCompatible` for the exact rule (byte-for-byte the same direction/
  // position check nearestCarDirectional.ts's own `isCompatible` already used).
  //
  // This means FCFS and directional matching now make IDENTICAL assignment decisions whenever an
  // elevator has real onboard passengers — the scenario this describe block used to build around
  // (both elevators busy, one nearer-but-wrong-way) no longer distinguishes them at all; see the
  // "converge" test below, which turns that into an explicit, intentional regression check rather
  // than a surprise. The ONE deliberate difference left between the two algorithms: an elevator
  // that's `moving` but has nobody onboard yet (no passenger commitment to protect) is still
  // freely redirectable under FCFS, while nearestCarDirectional's own compatibility check keys off
  // engine `state` (idle vs. not), so it still respects even an EMPTY car's in-progress trip. See
  // the dedicated hook-level test below for a precise, timing-independent proof of that.
  //
  // 'e1setup' sends E1 up to floor 9 first, boards, then heads down toward its destination 0.
  // 'e2setup' (staggered to arrive at t=500, once E1 is already well up the shaft) sends E2 up
  // toward destination 10. 'trap' registers at floor 9, up, at t=1150 — by then E1 has already
  // picked up 'e1setup' and left floor 9 heading down, but is still BUSY carrying 'e1setup'
  // (hasn't reached floor 0 yet) — near floor 9 (distance ~1) but heading the wrong way. E2 is
  // also busy (carrying 'e2setup' up toward floor 10) — farther from floor 9 (distance ~4) but
  // heading the right way.
  const script = [
    arrival('e1setup', 9, 'down', 0, 0),
    arrival('e2setup', 0, 'up', 10, 500),
    arrival('trap', 9, 'up', 10, 1150),
  ];

  it('FCFS and nearest-car-directional now converge when the nearer car actually has passengers onboard: both correctly exclude the nearer-but-wrong-way car', () => {
    const config = buildConfig();
    const fcfsResult = runSimulation(config, script, fcfsNearestCar.createHook(), SAFETY_CUTOFF);
    const directionalResult = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );

    const fcfsBoard = fcfsResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    const directionalBoard = directionalResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    // Both correctly exclude the nearer-but-wrong-way E1 (busy carrying 'e1setup') and assign the
    // farther-but-compatible E2 instead — no longer just directional matching's own behavior.
    expect(fcfsBoard).toMatchObject({ elevatorId: 'E2' });
    expect(directionalBoard).toMatchObject({ elevatorId: 'E2' });
    // The two algorithms deliver at the identical time too, not just via the same car — a direct
    // consequence of now sharing byte-for-byte identical candidate-eligibility logic whenever
    // every candidate actually has passengers onboard.
    const fcfsDelivery = fcfsResult.log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'trap',
    );
    const directionalDelivery = directionalResult.log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'trap',
    );
    expect(directionalDelivery!.time).toBe(fcfsDelivery!.time);
  });

  it('the ONE surviving distinction: an empty-but-moving car (nobody onboard) is still freely redirectable under FCFS, but not under directional matching', () => {
    // Direct, timing-independent proof at the decision level: E1 is `moving` (a stale/committed
    // direction) but has NOBODY onboard (carButtons empty) -- nothing for either algorithm to
    // protect, in principle, but nearestCarDirectional.ts's isCompatible keys off engine `state`
    // (not idle -> direction/position checked regardless), while fcfsNearestCar.ts's isCompatible
    // keys off carButtons.length === 0 (nobody onboard -> always compatible). E2 is farther but
    // genuinely idle.
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
    const snapshot: DispatchSnapshot = {
      time: 0,
      elevators: [
        makeElevator({ id: 'E1', currentFloor: 8, state: 'moving', direction: 'down' }),
        makeElevator({ id: 'E2', currentFloor: 0, state: 'idle', direction: null }),
      ],
      activeHallCalls: [{ floor: 9, direction: 'up' }],
      idleReturnThresholdMs: 30000,
      floorTravelTimeMs: 100,
    };

    expect(fcfsNearestCar.createHook()(snapshot)).toEqual([
      { type: 'travel', elevatorId: 'E1', direction: 'up' }, // nearer, empty, freely redirected
      { type: 'idle', elevatorId: 'E2' },
    ]);
    expect(nearestCarDirectional.createHook()(snapshot)).toEqual([
      { type: 'idle', elevatorId: 'E1' }, // still excluded: not idle, wrong direction
      { type: 'travel', elevatorId: 'E2', direction: 'up' }, // farther-but-idle E2 instead
    ]);
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
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.createHook).toBe('function');
      // Every factory actually produces a callable hook, proving these are real algorithm
      // modules (types.ts/shared.ts export no such shape and would have failed this).
      expect(typeof entry.createHook()).toBe('function');
    }
  });
});
