import { describe, expect, it } from 'vitest';
import { algorithms } from '../../algorithms';
import { algorithmColorVar, algorithmRegistryIndex } from './algorithmColor';

// COLOR_ORDER's full 12-entry mapping (Unit 11: FCFS removed, zoning/ETA/random added) -- these
// fixed indices are this test's whole point, so they're hand-pinned here rather than derived from
// `algorithms` (which would just restate the implementation, not verify it).
const EXPECTED: ReadonlyArray<{ id: string; expectedIndex: number }> = [
  { id: 'nearest-car-directional', expectedIndex: 0 },
  { id: 'scan-look', expectedIndex: 1 },
  { id: 'nearest-car-directional-homing', expectedIndex: 2 },
  { id: 'scan-look-homing', expectedIndex: 3 },
  { id: 'zoning', expectedIndex: 4 },
  { id: 'zoning-homing', expectedIndex: 5 },
  { id: 'zoning-fallback', expectedIndex: 6 },
  { id: 'zoning-fallback-homing', expectedIndex: 7 },
  { id: 'eta-dispatch', expectedIndex: 8 },
  { id: 'eta-dispatch-homing', expectedIndex: 9 },
  { id: 'random-dispatch', expectedIndex: 10 },
  { id: 'random-dispatch-homing', expectedIndex: 11 },
];

describe('algorithmRegistryIndex', () => {
  it('every registered algorithm resolves to its fixed COLOR_ORDER slot', () => {
    for (const { id, expectedIndex } of EXPECTED) {
      expect(algorithmRegistryIndex(id)).toBe(expectedIndex);
    }
  });

  it('returns -1 for an id that is not a registered algorithm', () => {
    expect(algorithmRegistryIndex('not-a-real-algorithm')).toBe(-1);
    // Also not a registered algorithm as of Unit 11's removal -- guards against COLOR_ORDER
    // silently keeping a stale entry for an id that no longer exists in the registry.
    expect(algorithmRegistryIndex('fcfs-nearest-car')).toBe(-1);
  });

  it('COLOR_ORDER stays in sync with the real algorithm registry: every registered algorithm has a slot, and every slot corresponds to a real algorithm', () => {
    const registryIds = new Set(algorithms.map((a) => a.id));

    expect(registryIds.size).toBe(EXPECTED.length);
    for (const { id } of EXPECTED) {
      expect(registryIds.has(id)).toBe(true);
      expect(algorithmRegistryIndex(id)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('algorithmColorVar', () => {
  it('assigns a distinct, stable series slot to each of the twelve algorithms', () => {
    for (const { id, expectedIndex } of EXPECTED) {
      expect(algorithmColorVar(id)).toBe(`var(--series-${expectedIndex + 1})`);
    }
  });

  it(
    'is stable across a filtered subset -- the direct regression test for recolor-on-filter: ' +
      "selectedAlgorithmIds may produce any subset of the registry, so a surviving algorithm's " +
      "color must match the full-registry fixture, never a color derived from the subset's own " +
      'order/length',
    () => {
      const full = EXPECTED.map((a) => a.id);
      // Simulates a run with the first registered algorithm filtered out of selectedAlgorithmIds.
      const subset = full.slice(1);
      expect(subset.length).toBeGreaterThan(0);

      subset.forEach((id, subsetIndex) => {
        const fullIndex = full.indexOf(id);
        // The real assertion: color keys off the fixed COLOR_ORDER index, not the subset's
        // position -- guards against a hypothetical position-in-subset-based implementation,
        // which this slice construction guarantees would disagree (subsetIndex is always
        // fullIndex - 1 here).
        expect(fullIndex).not.toBe(subsetIndex);
        expect(algorithmColorVar(id)).toBe(`var(--series-${fullIndex + 1})`);
      });
    },
  );
});
