import { describe, expect, it } from 'vitest';
import { algorithms } from '../../algorithms';
import { algorithmColorVar, algorithmRegistryIndex } from './algorithmColor';

// The three ids that existed before Unit 10 added the three homing variants -- sorting all 6
// filenames alphabetically interleaves each `*Homing.ts` file immediately after its base
// counterpart (fcfsNearestCar.ts, fcfsNearestCarHoming.ts, nearestCarDirectional.ts, ...), which
// is exactly what would have shifted `nearestCarDirectional`'s and `scanLook`'s glob-derived index
// had algorithmRegistryIndex still been implemented as `algorithms.findIndex(...)`. This is the
// direct regression this unit's own file additions would otherwise cause -- these fixed indices
// are this test's whole point, so they're hand-pinned here rather than derived from `algorithms`.
const ORIGINAL_THREE: ReadonlyArray<{ id: string; expectedIndex: number }> = [
  { id: 'fcfs-nearest-car', expectedIndex: 0 },
  { id: 'nearest-car-directional', expectedIndex: 1 },
  { id: 'scan-look', expectedIndex: 2 },
];

const NEW_HOMING_THREE: ReadonlyArray<{ id: string; expectedIndex: number }> = [
  { id: 'fcfs-nearest-car-homing', expectedIndex: 3 },
  { id: 'nearest-car-directional-homing', expectedIndex: 4 },
  { id: 'scan-look-homing', expectedIndex: 5 },
];

describe('algorithmRegistryIndex', () => {
  it(
    "the original three algorithms' color slots are UNCHANGED by the three new homing files " +
      'existing -- the actual regression this unit introduces the risk of, and the reason ' +
      'algorithmRegistryIndex no longer derives from algorithms.findIndex(...) (glob/alphabetical ' +
      'order). This assertion would FAIL against the old findIndex-based implementation, since ' +
      'alphabetical sort interleaves fcfsNearestCarHoming.ts before nearestCarDirectional.ts and ' +
      "scanLookHoming.ts before nothing after scanLook.ts, shifting nearestCarDirectional's glob " +
      'index from 1 to 2 and scanLook.ts from 2 to 4.',
    () => {
      for (const { id, expectedIndex } of ORIGINAL_THREE) {
        expect(algorithmRegistryIndex(id)).toBe(expectedIndex);
      }
    },
  );

  it('the three new homing algorithms get their own stable slots, appended after the original three', () => {
    for (const { id, expectedIndex } of NEW_HOMING_THREE) {
      expect(algorithmRegistryIndex(id)).toBe(expectedIndex);
    }
  });

  it('returns -1 for an id that is not a registered algorithm', () => {
    expect(algorithmRegistryIndex('not-a-real-algorithm')).toBe(-1);
  });

  it('COLOR_ORDER stays in sync with the real algorithm registry: every registered algorithm has a slot, and every slot corresponds to a real algorithm', () => {
    const registryIds = new Set(algorithms.map((a) => a.id));
    const allExpected = [...ORIGINAL_THREE, ...NEW_HOMING_THREE];

    expect(registryIds.size).toBe(allExpected.length);
    for (const { id } of allExpected) {
      expect(registryIds.has(id)).toBe(true);
      expect(algorithmRegistryIndex(id)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('algorithmColorVar', () => {
  it('assigns a distinct, stable series slot to each of the six algorithms', () => {
    for (const { id, expectedIndex } of [...ORIGINAL_THREE, ...NEW_HOMING_THREE]) {
      expect(algorithmColorVar(id)).toBe(`var(--series-${expectedIndex + 1})`);
    }
  });

  it(
    'is stable across a filtered subset -- the direct regression test for recolor-on-filter: ' +
      "selectedAlgorithmIds may produce any subset of the registry, so a surviving algorithm's " +
      "color must match the full-registry fixture, never a color derived from the subset's own " +
      'order/length',
    () => {
      const full = [...ORIGINAL_THREE, ...NEW_HOMING_THREE].map((a) => a.id);
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
