import { describe, expect, it } from 'vitest';

import type { BuildingConfig, Direction, FloorIndex, PassengerArrival } from '../engine';
import { runSimulation } from '../engine';
import { algorithms } from './index';
import { algorithm as nearestCarDirectional } from './nearestCarDirectional';
import { algorithm as etaDispatch } from './etaDispatch';
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
  // Amendment (Unit 11, FCFS removed from the roster): this describe block used to build around
  // FCFS's own quirks (see 03_algorithms_done.md for that history, kept as a historical record).
  // With FCFS gone, its coverage of direction-compatibility now lives standalone in
  // nearestCarDirectional.test.ts. What's left here is broader cross-algorithm sanity: proving
  // the surviving strategies are genuinely different fleet-usage patterns, not restatements of
  // each other under different names.
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

  it('ETA-based dispatch and nearest-car-directional agree on this scenario (both exclude the nearer-but-wrong-way car), but arrive at the answer through different mechanisms', () => {
    // Directional matching hard-excludes E1 (wrong direction); ETA-based dispatch never
    // hard-excludes anyone -- it simply prices E1's detour-then-reverse so high that E2 wins on
    // cost instead. Same outcome, genuinely different reasoning -- worth proving they still land
    // in the same place on an "obvious" case before trusting ETA's cost math on less obvious ones
    // (see etaDispatch.test.ts for cases where it actually diverges).
    const config = buildConfig();
    const directionalResult = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );
    const etaResult = runSimulation(config, script, etaDispatch.createHook(), SAFETY_CUTOFF);

    const directionalBoard = directionalResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    const etaBoard = etaResult.log.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'trap',
    );
    expect(directionalBoard).toMatchObject({ elevatorId: 'E2' });
    expect(etaBoard).toMatchObject({ elevatorId: 'E2' });
  });

  it('SCAN/LOOK is a genuinely different strategy, not a third name for one of the others', () => {
    const config = buildConfig();
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
  it('contains exactly the twelve expected algorithms, discovered automatically (Unit 11 removed FCFS and added zoning/ETA/random, each with a homing variant)', () => {
    expect(algorithms).toHaveLength(12);
    expect(algorithms.map((a) => a.id).sort()).toEqual([
      'eta-dispatch',
      'eta-dispatch-homing',
      'nearest-car-directional',
      'nearest-car-directional-homing',
      'random-dispatch',
      'random-dispatch-homing',
      'scan-look',
      'scan-look-homing',
      'zoning',
      'zoning-fallback',
      'zoning-fallback-homing',
      'zoning-homing',
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
