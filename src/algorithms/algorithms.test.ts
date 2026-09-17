import { describe, expect, it } from 'vitest';

import type { BuildingConfig, Direction, FloorIndex, PassengerArrival } from '../engine';
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
  // 'setup' sends E1 (nearest idle car, tie-broken over E2) up to floor 8, then back down toward
  // its destination floor 0. 'trap' registers at floor 9 — ABOVE E1's pickup floor and outside
  // its entire return path (8 down to 0 never revisits 9) — once E1 has already committed to
  // heading down (registered at t=950, safely after E1's own t=900 doors-closed decision, so
  // there's no race with E1's stale pre-descent direction). E1 (at floor 8) is still numerically
  // nearer to floor 9 (distance 1) than idle E2 (at floor 0, distance 9), but is now moving away
  // from it entirely.
  //
  // FCFS/naive nearest-car (Algorithm 1) doesn't check direction or state — only distance — so it
  // assigns 'trap' to E1 anyway. E1 has to finish its entire trip down to 0 (dropping off 'setup')
  // before it can even start back up toward floor 9, producing a large, visible detour. Nearest-
  // car-directional (Algorithm 3) excludes E1 (wrong direction) and assigns the farther-but-
  // compatible, idle E2 instead, which goes straight there. This is the concrete form of the flaw
  // described in this unit's Objective ("[FCFS] can send the geometrically nearest car even when
  // that car is already moving away from the call") — see dev_log/03_algorithms.md's "Correction"
  // note under Algorithm 1 for how an earlier, buggy version of FCFS (idle-only candidates) made
  // this scenario unconstructible.
  const script = [arrival('setup', 8, 'down', 0, 0), arrival('trap', 9, 'up', 10, 950)];

  it('FCFS sends the nearer-but-departing car, producing a large detour', () => {
    const config = buildConfig();
    const { log } = runSimulation(config, script, fcfsNearestCar.createHook(), SAFETY_CUTOFF);

    const setupAlight = log.find(
      (e) => e.type === 'passengerAlighted' && e.passengerId === 'setup',
    );
    const trapBoard = log.find((e) => e.type === 'passengerBoarded' && e.passengerId === 'trap');
    expect(setupAlight).toBeDefined();
    expect(trapBoard).toBeDefined();
    // E1 must finish its own trip to floor 0 (dropping off 'setup') before it can even start
    // back up toward 'trap' at floor 9 — proving it was assigned despite heading away.
    expect(trapBoard!.time).toBeGreaterThan(setupAlight!.time);
    expect(trapBoard).toMatchObject({ elevatorId: 'E1' });

    // E2 never had to move at all — it was never assigned, all the (wasted) travel was E1's.
    const e2Arrivals = log.filter((e) => e.type === 'elevatorArrived' && e.elevatorId === 'E2');
    expect(e2Arrivals).toHaveLength(0);
  });

  it('nearest-car-directional sends the farther-but-compatible idle car directly, no detour', () => {
    const config = buildConfig();
    const { log } = runSimulation(
      config,
      script,
      nearestCarDirectional.createHook(),
      SAFETY_CUTOFF,
    );

    const trapBoard = log.find((e) => e.type === 'passengerBoarded' && e.passengerId === 'trap');
    expect(trapBoard).toBeDefined();
    // E2 (idle, compatible) serves 'trap' directly - E1 (moving away) is correctly excluded.
    expect(trapBoard).toMatchObject({ elevatorId: 'E2' });

    const e1TrapInvolvement = log.some(
      (e) =>
        (e.type === 'passengerBoarded' || e.type === 'passengerAlighted') &&
        e.passengerId === 'trap' &&
        e.elevatorId === 'E1',
    );
    expect(e1TrapInvolvement).toBe(false);
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
    // Strictly less, not just <=, given the deliberate detour built into this scenario.
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

    // SCAN/LOOK never maintains a call-to-elevator assignment map at all, so E2 (never sent
    // anywhere by directional matching) is a meaningfully different fleet-usage pattern to
    // compare against directly: SCAN commits whichever elevator first goes idle-and-picks-a-
    // direction, independent of any assignment bookkeeping.
    expect(scanResult.log).not.toEqual(fcfsResult.log);
    expect(scanResult.log).not.toEqual(directionalResult.log);

    // Still fully serves both passengers, whichever car(s) it used.
    expect(scanResult.finalState.waitingPassengers).toEqual([]);
    expect(
      scanResult.log.filter((e) => e.type === 'passengerAlighted' && e.passengerId === 'trap'),
    ).toHaveLength(1);
    expect(
      scanResult.log.filter((e) => e.type === 'passengerAlighted' && e.passengerId === 'setup'),
    ).toHaveLength(1);
  });
});

describe('algorithms discovery (index.ts)', () => {
  it('contains exactly the three expected algorithms, discovered automatically', () => {
    expect(algorithms).toHaveLength(3);
    expect(algorithms.map((a) => a.id).sort()).toEqual([
      'fcfs-nearest-car',
      'nearest-car-directional',
      'scan-look',
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
