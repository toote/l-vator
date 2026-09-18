// The critical end-to-end regression test for this unit: two different REAL algorithms from
// src/algorithms, consuming the same generated batch, must see byte-for-byte identical
// hallCallRegistered log entries for a given trial index. See dev_log/04_generation.md,
// "fairness.test.ts", and 00_main.md's "Fairness/reproducibility" requirement.
//
// Two scenario-design subtleties are worth recording, both documented at length in
// dev_log/04_generation.md's "AI Interactions" section:
//
// 1. A latent bug was found in the existing (Unit 02/03) engine+algorithms while developing this
//    test: a fully-loaded elevator commanded to 'stop' at a floor with only an active PICKUP call
//    (nothing of its own to drop off there) boards nobody and alights nobody, producing a zero-ms
//    door dwell that re-triggers the identical decision forever at the same simulated timestamp —
//    a true infinite loop, reproduced with both fcfsNearestCar and scanLook. Fixing the
//    engine/algorithms is out of scope for this unit, so `building` below is deliberately
//    generous on capacity/elevatorCount relative to the arrival rate/duration.
//
// 2. `hallCallRegistered` is only logged when a (floor, direction) call transitions from
//    inactive to active (see simulation.ts's `wasActive` check) — if a second passenger arrives
//    at the same floor+direction while the first is still waiting, no second log entry is
//    emitted. Since exactly when a call clears depends on how fast each algorithm dispatches an
//    elevator to it, two algorithms CAN legitimately produce different `hallCallRegistered`
//    counts/timing for the same underlying PassengerArrival script, without that being any kind
//    of fairness violation — the shared, byte-for-byte-identical input is what trialBatch.test.ts
//    verifies directly, not this log. To make `hallCallRegistered` itself a valid, robust
//    algorithm-independent signal (as the approved plan's test design calls for), the scenario
//    parameters below were chosen so the generated batch has no two arrivals sharing a
//    (floor, direction) pair — verified directly against the real generator before being locked
//    in here — which guarantees every arrival's call is new (never already active), making
//    `hallCallRegistered` a deterministic 1:1 reflection of the input arrivals regardless of
//    dispatch speed.

import { describe, expect, it } from 'vitest';
import { algorithm as fcfs } from '../algorithms/fcfsNearestCar';
import { algorithm as scanLook } from '../algorithms/scanLook';
import type { BuildingConfig, Direction, FloorIndex, SimEventLogEntry } from '../engine';
import { runTrialBatch } from './trialRunner';
import type { RandomScenario } from './types';

const building: BuildingConfig = {
  floorCount: 6,
  elevatorCount: 3,
  capacity: 16,
  floorTravelTimeMs: 1000,
  doorDwellBaseMs: 1000,
  doorDwellPerPassengerMultiplier: 0.5,
  idleReturnThresholdMs: 30000,
};

interface HallCallFact {
  floor: FloorIndex;
  direction: Direction;
  time: number;
}

function hallCallFacts(log: SimEventLogEntry[]): HallCallFact[] {
  return log
    .filter(
      (entry): entry is Extract<SimEventLogEntry, { type: 'hallCallRegistered' }> =>
        entry.type === 'hallCallRegistered',
    )
    .map((entry) => ({ floor: entry.floor, direction: entry.direction, time: entry.time }));
}

describe('fairness: same seed sequence -> identical passenger arrivals across algorithms', () => {
  it('two different real algorithms see byte-for-byte identical hallCallRegistered entries for a given trial index', () => {
    const scenario: RandomScenario = {
      type: 'random',
      building,
      arrivals: { baseRatePerMinute: 3, pattern: 'random' },
      durationMs: 10000,
      trialCount: 3,
      seed: 7,
    };

    const results = runTrialBatch(scenario, [fcfs, scanLook]);

    const trialIndex = 1; // an arbitrary "chosen trial index K"
    const fcfsResult = results.find(
      (r) => r.algorithmId === fcfs.id && r.trialIndex === trialIndex,
    );
    const scanResult = results.find(
      (r) => r.algorithmId === scanLook.id && r.trialIndex === trialIndex,
    );
    if (!fcfsResult || !scanResult) {
      throw new Error('expected a result for both algorithms at the chosen trial index');
    }

    const fcfsCalls = hallCallFacts(fcfsResult.result.log);
    const scanCalls = hallCallFacts(scanResult.result.log);

    // The observable proof: the actual passenger-arrival facts consumed for trial K were the
    // same regardless of which algorithm ran it.
    expect(fcfsCalls.length).toBeGreaterThan(0);
    expect(fcfsCalls).toEqual(scanCalls);

    // The two algorithms' subsequent dispatch decisions — and therefore their full logs — are
    // free to diverge from that point on; this isn't itself required for fairness, but confirms
    // the equality above isn't trivially true because both algorithms happened to behave
    // identically on this scenario.
    expect(fcfsResult.result.log).not.toEqual(scanResult.result.log);
  });

  it('holds across every trial index in the batch, not just one', () => {
    const scenario: RandomScenario = {
      type: 'random',
      building,
      arrivals: { baseRatePerMinute: 3, pattern: 'random' },
      durationMs: 10000,
      trialCount: 4,
      seed: 35,
    };

    const results = runTrialBatch(scenario, [fcfs, scanLook]);

    for (let trialIndex = 0; trialIndex < scenario.trialCount; trialIndex++) {
      const fcfsResult = results.find(
        (r) => r.algorithmId === fcfs.id && r.trialIndex === trialIndex,
      );
      const scanResult = results.find(
        (r) => r.algorithmId === scanLook.id && r.trialIndex === trialIndex,
      );
      if (!fcfsResult || !scanResult) {
        throw new Error(`expected a result for both algorithms at trial ${trialIndex}`);
      }
      expect(hallCallFacts(fcfsResult.result.log)).toEqual(hallCallFacts(scanResult.result.log));
    }
  });
});
