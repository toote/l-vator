import { describe, expect, it } from 'vitest';
import { aggregateTrialMetrics } from './aggregate';
import type { TrialMetrics } from './types';

/**
 * A fully "empty-weight" baseline TrialMetrics: every ratio metric's underlying count is 0, so
 * every pooled metric is safely skipped (weight 0) regardless of the null/0 value carried here.
 * Individual tests override only the fields relevant to what they're proving, keeping the rest
 * internally consistent by construction.
 */
function baseTrial(trialIndex: number): TrialMetrics {
  return {
    algorithmId: 'algo',
    trialIndex,
    simulatedDurationMs: 3_600_000, // 1 hour, so throughput weight = 1 unless overridden
    averageWaitTimeMs: null,
    maxWaitTimeMs: null,
    averageTravelTimeMs: null,
    totalDistanceFloors: 0,
    throughputPerHour: 0, // servedCounts.served = 0, durationMs != 0 -> 0, not null
    averageOccupancyWhileMovingPct: null,
    deadheadTravelPct: null,
    unservedCount: 0,
    unservedPct: null,
    servedCounts: { total: 0, served: 0, boardedOnly: 0, neverBoarded: 0 },
  };
}

describe('aggregateTrialMetrics', () => {
  it('throws on an empty array (no algorithmId to report)', () => {
    expect(() => aggregateTrialMetrics([])).toThrow();
  });

  it('pools average wait time (sum of waits / sum of counts) rather than averaging per-trial averages', () => {
    // Deliberately different-sized trials: trial A has 2 wait-eligible passengers, trial B has 20.
    const trialA: TrialMetrics = {
      ...baseTrial(0),
      averageWaitTimeMs: 100,
      averageTravelTimeMs: 100,
      maxWaitTimeMs: 150,
      servedCounts: { total: 2, served: 2, boardedOnly: 0, neverBoarded: 0 },
    };
    const trialB: TrialMetrics = {
      ...baseTrial(1),
      averageWaitTimeMs: 1000,
      averageTravelTimeMs: 1000,
      maxWaitTimeMs: 1200,
      servedCounts: { total: 20, served: 20, boardedOnly: 0, neverBoarded: 0 },
    };

    const aggregate = aggregateTrialMetrics([trialA, trialB]);

    // Pooled: (100*2 + 1000*20) / (2 + 20) = 20200 / 22 = 10100/11.
    const pooled = 20200 / 22;
    // Naive (wrong) mean-of-averages, for contrast: (100 + 1000) / 2 = 550.
    const naiveMeanOfAverages = 550;

    expect(aggregate.averageWaitTimeMs).toBeCloseTo(pooled, 10);
    expect(aggregate.averageTravelTimeMs).toBeCloseTo(pooled, 10); // same numbers, same principle
    expect(aggregate.averageWaitTimeMs).not.toBeCloseTo(naiveMeanOfAverages, 1);
  });

  it('resolves max wait as true max-across-all-trials, distinct from meanOfPerTrialMaxWaitTimeMs', () => {
    const trials: TrialMetrics[] = [500, 9000, 200].map((maxWaitTimeMs, trialIndex) => ({
      ...baseTrial(trialIndex),
      maxWaitTimeMs,
      servedCounts: { total: 1, served: 0, boardedOnly: 0, neverBoarded: 1 },
      unservedCount: 1,
      unservedPct: 100,
    }));

    const aggregate = aggregateTrialMetrics(trials);

    expect(aggregate.maxWaitTimeMs).toBe(9000); // max(500, 9000, 200)
    expect(aggregate.meanOfPerTrialMaxWaitTimeMs).toBeCloseTo((500 + 9000 + 200) / 3, 10); // 3233.33...
    expect(aggregate.maxWaitTimeMs).not.toBe(aggregate.meanOfPerTrialMaxWaitTimeMs);
  });

  it('sums unservedCount/servedCounts across trials and recomputes unservedPct from the summed totals, not averaged per-trial percentages', () => {
    const trialA: TrialMetrics = {
      ...baseTrial(0),
      averageWaitTimeMs: 100,
      averageTravelTimeMs: 50,
      maxWaitTimeMs: 300,
      servedCounts: { total: 10, served: 8, boardedOnly: 1, neverBoarded: 1 },
      unservedCount: 2,
      unservedPct: 20, // 2/10 * 100
    };
    const trialB: TrialMetrics = {
      ...baseTrial(1),
      averageWaitTimeMs: 200,
      averageTravelTimeMs: 80,
      maxWaitTimeMs: 900,
      servedCounts: { total: 100, served: 50, boardedOnly: 30, neverBoarded: 20 },
      unservedCount: 50,
      unservedPct: 50, // 50/100 * 100
    };

    const aggregate = aggregateTrialMetrics([trialA, trialB]);

    expect(aggregate.unservedCount).toBe(52); // 2 + 50, summed
    expect(aggregate.servedCounts).toEqual({
      total: 110,
      served: 58,
      boardedOnly: 31,
      neverBoarded: 21,
    });
    // Pooled from summed totals: 52 / 110 * 100, NOT the naive mean of 20 and 50.
    const pooledUnservedPct = (52 / 110) * 100;
    const naiveMeanOfPercentages = (20 + 50) / 2;
    expect(aggregate.unservedPct).toBeCloseTo(pooledUnservedPct, 10);
    expect(aggregate.unservedPct).not.toBeCloseTo(naiveMeanOfPercentages, 1);
  });

  it('pools throughput and occupancy/deadhead percentages by their own per-trial weights (hours, hop counts)', () => {
    const trialA: TrialMetrics = {
      ...baseTrial(0),
      simulatedDurationMs: 3_600_000, // 1 hour
      averageWaitTimeMs: 111, // served/boardedOnly count is nonzero below, so this must be real
      averageTravelTimeMs: 222,
      maxWaitTimeMs: 333,
      throughputPerHour: 10,
      servedCounts: { total: 10, served: 10, boardedOnly: 0, neverBoarded: 0 },
      totalDistanceFloors: 4,
      averageOccupancyWhileMovingPct: 50,
      deadheadTravelPct: 25,
    };
    const trialB: TrialMetrics = {
      ...baseTrial(1),
      simulatedDurationMs: 7_200_000, // 2 hours
      averageWaitTimeMs: 444,
      averageTravelTimeMs: 555,
      maxWaitTimeMs: 666,
      throughputPerHour: 20,
      servedCounts: { total: 40, served: 40, boardedOnly: 0, neverBoarded: 0 },
      totalDistanceFloors: 16,
      averageOccupancyWhileMovingPct: 25,
      deadheadTravelPct: 75,
    };

    const aggregate = aggregateTrialMetrics([trialA, trialB]);

    // Pooled throughput: sum(served) / sum(hours) = (10 + 40) / (1 + 2) = 50/3.
    expect(aggregate.throughputPerHour).toBeCloseTo(50 / 3, 10);
    // Pooled occupancy: weighted by hop counts (4, 16): (50*4 + 25*16) / 20 = 30.
    expect(aggregate.averageOccupancyWhileMovingPct).toBeCloseTo(30, 10);
    // Pooled deadhead: (25*4 + 75*16) / 20 = 65.
    expect(aggregate.deadheadTravelPct).toBeCloseTo(65, 10);
    // totalDistanceFloors is a simple mean of per-trial totals, not pooled: (4 + 16) / 2 = 10.
    expect(aggregate.totalDistanceFloors).toBe(10);
  });

  it('retains perTrial sorted by trialIndex and reports the correct trialCount/algorithmId', () => {
    const trialB = { ...baseTrial(1) };
    const trialA = { ...baseTrial(0) };
    const aggregate = aggregateTrialMetrics([trialB, trialA]); // deliberately out of order

    expect(aggregate.algorithmId).toBe('algo');
    expect(aggregate.trialCount).toBe(2);
    expect(aggregate.perTrial.map((t) => t.trialIndex)).toEqual([0, 1]);
  });
});
