import { describe, expect, it } from 'vitest';
import type { AlgorithmMetrics } from '../../metrics';
import { computeChartPanels } from './dashboardChartData';

// Real registered algorithm ids, in ascending algorithmRegistryIndex (COLOR_ORDER) order --
// computeChartPanels row-orders by that fixed index (see algorithmColor.ts), NOT by
// `algorithms`' own import.meta.glob-derived order, which (since Unit 10 added homing variants)
// no longer happens to agree with COLOR_ORDER for its first three entries. Using real, registered
// ids (rather than arbitrary placeholders) still exercises the real lookup.
const ALG_A = 'nearest-car-directional';
const ALG_B = 'scan-look';
const ALG_C = 'nearest-car-directional-homing';

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

describe('computeChartPanels', () => {
  it('computes the four charted panels in the fixed order', () => {
    const panels = computeChartPanels([metrics({ algorithmId: ALG_A })]);
    expect(panels.map((p) => p.metricKey)).toEqual([
      'averageWaitTimeMs',
      'maxWaitTimeMs',
      'throughputPerHour',
      'unservedPct',
    ]);
  });

  it('computes proportion relative to that panel’s own max for ordinary values', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, averageWaitTimeMs: 100 }),
      metrics({ algorithmId: ALG_B, averageWaitTimeMs: 400 }),
      metrics({ algorithmId: ALG_C, averageWaitTimeMs: 200 }),
    ];
    const [avgWaitPanel] = computeChartPanels(rows);
    expect(avgWaitPanel.max).toBe(400);
    const byId = new Map(avgWaitPanel.bars.map((b) => [b.algorithmId, b]));
    expect(byId.get(ALG_A)?.proportion).toBeCloseTo(0.25);
    expect(byId.get(ALG_B)?.proportion).toBeCloseTo(1);
    expect(byId.get(ALG_C)?.proportion).toBeCloseTo(0.5);
  });

  it('a null value produces the "n/a" marker (null proportion), not a 0 proportion', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, averageWaitTimeMs: null }),
      metrics({ algorithmId: ALG_B, averageWaitTimeMs: 200 }),
    ];
    const [avgWaitPanel] = computeChartPanels(rows);
    const a = avgWaitPanel.bars.find((b) => b.algorithmId === ALG_A);
    expect(a?.value).toBeNull();
    expect(a?.proportion).toBeNull();
  });

  it('all-null for one metric: no divide by zero, every row is "n/a"', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, averageWaitTimeMs: null }),
      metrics({ algorithmId: ALG_B, averageWaitTimeMs: null }),
    ];
    const [avgWaitPanel] = computeChartPanels(rows);
    expect(avgWaitPanel.max).toBe(0);
    expect(Number.isNaN(avgWaitPanel.max)).toBe(false);
    for (const bar of avgWaitPanel.bars) {
      expect(bar.value).toBeNull();
      expect(bar.proportion).toBeNull();
      expect(Number.isNaN(bar.proportion as number)).toBe(false);
    }
  });

  it('all-zero (every algorithm has a real 0): real zero-length bars, not "n/a"', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, unservedPct: 0 }),
      metrics({ algorithmId: ALG_B, unservedPct: 0 }),
    ];
    const panels = computeChartPanels(rows);
    const unservedPanel = panels.find((p) => p.metricKey === 'unservedPct');
    expect(unservedPanel?.max).toBe(0);
    for (const bar of unservedPanel?.bars ?? []) {
      expect(bar.value).toBe(0);
      expect(bar.proportion).toBe(0);
    }
  });

  it('mixed null and real values in the same panel', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, throughputPerHour: null }),
      metrics({ algorithmId: ALG_B, throughputPerHour: 50 }),
      metrics({ algorithmId: ALG_C, throughputPerHour: 25 }),
    ];
    const panels = computeChartPanels(rows);
    const throughputPanel = panels.find((p) => p.metricKey === 'throughputPerHour');
    const byId = new Map(throughputPanel?.bars.map((b) => [b.algorithmId, b]));
    expect(byId.get(ALG_A)?.value).toBeNull();
    expect(byId.get(ALG_A)?.proportion).toBeNull();
    expect(byId.get(ALG_B)?.proportion).toBeCloseTo(1);
    expect(byId.get(ALG_C)?.proportion).toBeCloseTo(0.5);
  });

  it('proportion is independent across panels (different units/scales, not a shared max)', () => {
    const rows = [
      metrics({ algorithmId: ALG_A, averageWaitTimeMs: 1000, throughputPerHour: 5 }),
      metrics({ algorithmId: ALG_B, averageWaitTimeMs: 100, throughputPerHour: 50 }),
    ];
    const panels = computeChartPanels(rows);
    const avgWaitPanel = panels.find((p) => p.metricKey === 'averageWaitTimeMs');
    const throughputPanel = panels.find((p) => p.metricKey === 'throughputPerHour');
    expect(avgWaitPanel?.max).toBe(1000);
    expect(throughputPanel?.max).toBe(50);
    const waitA = avgWaitPanel?.bars.find((b) => b.algorithmId === ALG_A);
    const throughputA = throughputPanel?.bars.find((b) => b.algorithmId === ALG_A);
    expect(waitA?.proportion).toBeCloseTo(1); // ALG_A has the max wait
    expect(throughputA?.proportion).toBeCloseTo(0.1); // but the min throughput
  });

  it('bar rows follow the fixed registry order, not the order metrics happens to arrive in', () => {
    // metrics deliberately passed out of registry order (as an arbitrary selectedAlgorithmIds
    // subset/order might).
    const rows = [
      metrics({ algorithmId: ALG_C }),
      metrics({ algorithmId: ALG_A }),
      metrics({ algorithmId: ALG_B }),
    ];
    const [avgWaitPanel] = computeChartPanels(rows);
    expect(avgWaitPanel.bars.map((b) => b.algorithmId)).toEqual([ALG_A, ALG_B, ALG_C]);
  });

  it('formatValue formats a representative value per metric', () => {
    const rows = [
      metrics({
        algorithmId: ALG_A,
        averageWaitTimeMs: 1234.5,
        maxWaitTimeMs: 9876.5,
        throughputPerHour: 12.34,
        unservedPct: 5.678,
      }),
    ];
    const panels = computeChartPanels(rows);
    const formatted = Object.fromEntries(panels.map((p) => [p.metricKey, p.formatValue(p.max)]));
    expect(formatted.averageWaitTimeMs).toBe('1235 ms');
    expect(formatted.maxWaitTimeMs).toBe('9877 ms');
    expect(formatted.throughputPerHour).toBe('12.3/hr');
    expect(formatted.unservedPct).toBe('5.7%');
  });
});
