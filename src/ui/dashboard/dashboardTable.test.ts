import { describe, expect, it } from 'vitest';
import type { AlgorithmMetrics } from '../../metrics';
import { bestAlgorithmIds } from './dashboardTable';

function metrics(overrides: Partial<AlgorithmMetrics> & { algorithmId: string }): AlgorithmMetrics {
  return {
    trialCount: 10,
    averageWaitTimeMs: 100,
    maxWaitTimeMs: 500,
    meanOfPerTrialMaxWaitTimeMs: 400,
    averageTravelTimeMs: 200,
    totalDistanceFloors: 50,
    throughputPerHour: 30,
    averageOccupancyWhileMovingPct: 60,
    deadheadTravelPct: 10,
    unservedCount: 0,
    unservedPct: 0,
    servedCounts: { total: 10, served: 10, boardedOnly: 0, neverBoarded: 0 },
    perTrial: [],
    ...overrides,
  };
}

describe('bestAlgorithmIds', () => {
  it('picks the lowest value for a lower-is-better metric', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 300 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 200 }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set(['b']));
  });

  it('picks the highest value for a higher-is-better metric', () => {
    const rows = [
      metrics({ algorithmId: 'a', throughputPerHour: 30 }),
      metrics({ algorithmId: 'b', throughputPerHour: 90 }),
      metrics({ algorithmId: 'c', throughputPerHour: 60 }),
    ];
    expect(bestAlgorithmIds(rows, 'throughputPerHour', 'higher')).toEqual(new Set(['b']));
  });

  it('includes every algorithm tied for best -- developer-reported: a tie should highlight all of them, not none', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 200 }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set(['a', 'b']));
  });

  it('includes every algorithm when all three tie', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 100 }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('handles a tie that is not the first value seen -- a later-arriving tie must still add both ids, not just the later one', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 200 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 100 }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set(['b', 'c']));
  });

  it('skips null-valued metrics (e.g. averageWaitTimeMs: null when nobody was served)', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: null }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 150 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: null }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set(['b']));
  });

  it('returns an empty set when every value is null', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: null }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: null }),
    ];
    expect(bestAlgorithmIds(rows, 'averageWaitTimeMs', 'lower')).toEqual(new Set());
  });

  it('returns an empty set for an empty metrics list', () => {
    expect(bestAlgorithmIds([], 'averageWaitTimeMs', 'lower')).toEqual(new Set());
  });

  it('handles a single-row list (trivially the best)', () => {
    const rows = [metrics({ algorithmId: 'only', unservedCount: 5 })];
    expect(bestAlgorithmIds(rows, 'unservedCount', 'lower')).toEqual(new Set(['only']));
  });
});
