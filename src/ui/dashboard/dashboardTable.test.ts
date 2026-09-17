import { describe, expect, it } from 'vitest';
import type { AlgorithmMetrics } from '../../metrics';
import { bestAlgorithmId } from './dashboardTable';

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

describe('bestAlgorithmId', () => {
  it('picks the lowest value for a lower-is-better metric', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 300 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 200 }),
    ];
    expect(bestAlgorithmId(rows, 'averageWaitTimeMs', 'lower')).toBe('b');
  });

  it('picks the highest value for a higher-is-better metric', () => {
    const rows = [
      metrics({ algorithmId: 'a', throughputPerHour: 30 }),
      metrics({ algorithmId: 'b', throughputPerHour: 90 }),
      metrics({ algorithmId: 'c', throughputPerHour: 60 }),
    ];
    expect(bestAlgorithmId(rows, 'throughputPerHour', 'higher')).toBe('b');
  });

  it('returns null on a tie for best -- no single winner to highlight', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 100 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: 200 }),
    ];
    expect(bestAlgorithmId(rows, 'averageWaitTimeMs', 'lower')).toBeNull();
  });

  it('skips null-valued metrics (e.g. averageWaitTimeMs: null when nobody was served)', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: null }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: 150 }),
      metrics({ algorithmId: 'c', averageWaitTimeMs: null }),
    ];
    expect(bestAlgorithmId(rows, 'averageWaitTimeMs', 'lower')).toBe('b');
  });

  it('returns null when every value is null', () => {
    const rows = [
      metrics({ algorithmId: 'a', averageWaitTimeMs: null }),
      metrics({ algorithmId: 'b', averageWaitTimeMs: null }),
    ];
    expect(bestAlgorithmId(rows, 'averageWaitTimeMs', 'lower')).toBeNull();
  });

  it('returns null for an empty metrics list', () => {
    expect(bestAlgorithmId([], 'averageWaitTimeMs', 'lower')).toBeNull();
  });

  it('handles a single-row list (trivially the best)', () => {
    const rows = [metrics({ algorithmId: 'only', unservedCount: 5 })];
    expect(bestAlgorithmId(rows, 'unservedCount', 'lower')).toBe('only');
  });
});
