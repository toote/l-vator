import { describe, expect, it } from 'vitest';
import type { BuildingConfig } from '../engine';
import { generateRandomArrivals } from './randomArrivals';
import type { RandomArrivalParams } from './types';

const building: BuildingConfig = {
  floorCount: 5,
  elevatorCount: 2,
  capacity: 4,
  floorTravelTimeMs: 2000,
  doorDwellBaseMs: 3000,
  doorDwellPerPassengerMultiplier: 0.5,
  idleReturnThresholdMs: 30000,
};

describe('generateRandomArrivals', () => {
  it('is deterministic: the same (building, params, durationMs, seed) produces deep-equal output', () => {
    const params: RandomArrivalParams = { baseRatePerMinute: 6, pattern: 'random' };
    const a = generateRandomArrivals(building, params, 60000, 777);
    const b = generateRandomArrivals(building, params, 60000, 777);
    expect(a).toEqual(b);
  });

  it('up-peak: every arrival originates at floor 0, has a non-zero destination, direction up', () => {
    const params: RandomArrivalParams = { baseRatePerMinute: 10, pattern: 'up-peak' };
    const arrivals = generateRandomArrivals(building, params, 120000, 1);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const arrival of arrivals) {
      expect(arrival.originFloor).toBe(0);
      expect(arrival.destinationFloor).not.toBe(0);
      expect(arrival.direction).toBe('up');
    }
  });

  it('down-peak: every arrival has destination floor 0, non-zero origin, direction down', () => {
    const params: RandomArrivalParams = { baseRatePerMinute: 10, pattern: 'down-peak' };
    const arrivals = generateRandomArrivals(building, params, 120000, 1);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const arrival of arrivals) {
      expect(arrival.destinationFloor).toBe(0);
      expect(arrival.originFloor).not.toBe(0);
      expect(arrival.direction).toBe('down');
    }
  });

  it('random: direction is always derived correctly, origin != destination always, and floors spread out', () => {
    const params: RandomArrivalParams = { baseRatePerMinute: 20, pattern: 'random' };
    const arrivals = generateRandomArrivals(building, params, 300000, 2);
    expect(arrivals.length).toBeGreaterThan(20);

    const origins = new Set<number>();
    const destinations = new Set<number>();
    for (const arrival of arrivals) {
      expect(arrival.originFloor).not.toBe(arrival.destinationFloor);
      expect(arrival.direction).toBe(
        arrival.destinationFloor > arrival.originFloor ? 'up' : 'down',
      );
      origins.add(arrival.originFloor);
      destinations.add(arrival.destinationFloor);
    }
    // Structural spread check, not a proof of uniformity: over a long run, origins/destinations
    // should not all collapse onto a single floor.
    expect(origins.size).toBeGreaterThan(1);
    expect(destinations.size).toBeGreaterThan(1);
  });

  it('rate/duration correctness: generated count tracks rate * duration within a statistical tolerance, averaged over many seeds', () => {
    const durationMs = 600000; // 10 minutes
    const ratePerMinute = 6;
    const expectedCount = ratePerMinute * (durationMs / 60000); // 60
    const trialSeeds = 40;

    let total = 0;
    for (let seed = 0; seed < trialSeeds; seed++) {
      const params: RandomArrivalParams = { baseRatePerMinute: ratePerMinute, pattern: 'up-peak' };
      total += generateRandomArrivals(building, params, durationMs, seed).length;
    }
    const average = total / trialSeeds;

    expect(average).toBeGreaterThan(expectedCount * 0.8);
    expect(average).toBeLessThan(expectedCount * 1.2);
  });

  it('a floor configured with a materially higher rate produces materially more arrivals than a base-rate floor, averaged over many seeds', () => {
    const durationMs = 300000; // 5 minutes
    const trialSeeds = 30;

    let baseFloorTotal = 0;
    let highRateFloorTotal = 0;
    for (let seed = 0; seed < trialSeeds; seed++) {
      const params: RandomArrivalParams = {
        baseRatePerMinute: 4,
        pattern: 'random',
        floorRates: { 2: 30 },
      };
      const arrivals = generateRandomArrivals(building, params, durationMs, seed * 7 + 1);
      baseFloorTotal += arrivals.filter((a) => a.originFloor === 1).length;
      highRateFloorTotal += arrivals.filter((a) => a.originFloor === 2).length;
    }

    expect(highRateFloorTotal).toBeGreaterThan(baseFloorTotal * 2);
  });

  it('all arrivalTimes fall within [0, durationMs] and the returned array is sorted ascending', () => {
    const durationMs = 200000;
    const params: RandomArrivalParams = { baseRatePerMinute: 15, pattern: 'random' };
    const arrivals = generateRandomArrivals(building, params, durationMs, 55);
    expect(arrivals.length).toBeGreaterThan(0);

    for (const arrival of arrivals) {
      expect(arrival.arrivalTime).toBeGreaterThanOrEqual(0);
      expect(arrival.arrivalTime).toBeLessThanOrEqual(durationMs);
    }
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i].arrivalTime).toBeGreaterThanOrEqual(arrivals[i - 1].arrivalTime);
    }
  });

  it('REGRESSION: a rate of exactly 0 (baseRatePerMinute) terminates promptly and produces zero arrivals', () => {
    const start = Date.now();
    const params: RandomArrivalParams = { baseRatePerMinute: 0, pattern: 'random' };
    const arrivals = generateRandomArrivals(building, params, 60000, 1);
    const elapsedMs = Date.now() - start;

    // Bounded/timed assertion: a regression of the rate=0 guard (see rng.ts's
    // sampleExponentialGapMs doc comment) would hang the generator via NaN propagation rather
    // than just run slowly, so this wall-clock bound is the signal that the guard held.
    expect(arrivals).toEqual([]);
    expect(elapsedMs).toBeLessThan(1000);
  }, 2000);

  it('REGRESSION: a floorRates override of exactly 0 skips that floor without hanging', () => {
    const start = Date.now();
    const params: RandomArrivalParams = {
      baseRatePerMinute: 10,
      pattern: 'random',
      floorRates: { 0: 0 },
    };
    const arrivals = generateRandomArrivals(building, params, 60000, 1);
    const elapsedMs = Date.now() - start;

    expect(arrivals.some((a) => a.originFloor === 0)).toBe(false);
    // Other generating floors (1..5) should still produce arrivals — proves the guard skips
    // only the zero-rate floor, not the whole generation pass.
    expect(arrivals.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000);
  }, 2000);

  it('throws a descriptive error on a negative baseRatePerMinute and generates nothing', () => {
    const params: RandomArrivalParams = { baseRatePerMinute: -1, pattern: 'random' };
    expect(() => generateRandomArrivals(building, params, 60000, 1)).toThrow(/baseRatePerMinute/);
  });

  it('throws a descriptive error identifying the offending floor on a negative floorRates entry, and generates nothing', () => {
    const params: RandomArrivalParams = {
      baseRatePerMinute: 5,
      pattern: 'random',
      floorRates: { 3: -2 },
    };
    expect(() => generateRandomArrivals(building, params, 60000, 1)).toThrow(/floorRates\[3\]/);
  });

  it('a floorRates override on a floor the pattern does not generate from is a silent no-op (no error, zero arrivals from it)', () => {
    // up-peak only generates from floor 0 — an override on floor 3 should be ignored entirely.
    const params: RandomArrivalParams = {
      baseRatePerMinute: 10,
      pattern: 'up-peak',
      floorRates: { 3: 999 },
    };
    expect(() => generateRandomArrivals(building, params, 60000, 1)).not.toThrow();
    const arrivals = generateRandomArrivals(building, params, 60000, 1);
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every((a) => a.originFloor !== 3)).toBe(true);
  });
});
