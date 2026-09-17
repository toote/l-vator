import { describe, expect, it } from 'vitest';
import { algorithms } from '../../algorithms';
import { algorithmColorVar, algorithmRegistryIndex } from './algorithmColor';

describe('algorithmRegistryIndex', () => {
  it('returns each registered algorithm at its position in the full registry', () => {
    algorithms.forEach((algorithm, index) => {
      expect(algorithmRegistryIndex(algorithm.id)).toBe(index);
    });
  });

  it('returns -1 for an id that is not a registered algorithm', () => {
    expect(algorithmRegistryIndex('not-a-real-algorithm')).toBe(-1);
  });
});

describe('algorithmColorVar', () => {
  it('assigns a distinct series slot to each registered algorithm, by registry index', () => {
    algorithms.forEach((algorithm, index) => {
      expect(algorithmColorVar(algorithm.id)).toBe(`var(--series-${index + 1})`);
    });
  });

  it(
    'is stable across a filtered subset -- the direct regression test for recolor-on-filter: ' +
      "selectedAlgorithmIds may produce any subset of the registry, so a surviving algorithm's " +
      "color must match the full-registry fixture, never a color derived from the subset's own " +
      'order/length',
    () => {
      const full = algorithms.map((a) => a.id);
      // Simulates a run with the first registered algorithm filtered out of selectedAlgorithmIds.
      const subset = full.slice(1);
      expect(subset.length).toBeGreaterThan(0);

      subset.forEach((id, subsetIndex) => {
        const fullIndex = full.indexOf(id);
        // The real assertion: color keys off the full-registry index, not the subset's position
        // -- guards against a hypothetical position-in-subset-based implementation, which this
        // slice construction guarantees would disagree (subsetIndex is always fullIndex - 1
        // here).
        expect(fullIndex).not.toBe(subsetIndex);
        expect(algorithmColorVar(id)).toBe(`var(--series-${fullIndex + 1})`);
      });
    },
  );
});
