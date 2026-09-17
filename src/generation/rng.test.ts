import { describe, expect, it } from 'vitest';
import { createRng, deriveTrialSeeds } from './rng';

function drawSequence(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('produces the same sequence for the same seed across repeated instantiations', () => {
    expect(drawSequence(12345, 20)).toEqual(drawSequence(12345, 20));
  });

  it('produces a different sequence for a different seed', () => {
    expect(drawSequence(1, 20)).not.toEqual(drawSequence(2, 20));
  });

  it('produces values in [0, 1)', () => {
    for (const value of drawSequence(999, 200)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('deriveTrialSeeds', () => {
  it('is deterministic: the same inputs produce the same array across repeated calls', () => {
    expect(deriveTrialSeeds(42, 10)).toEqual(deriveTrialSeeds(42, 10));
  });

  it('produces pairwise-distinct seeds for a representative count', () => {
    const seeds = deriveTrialSeeds(42, 50);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('produces a different sequence of seeds for a different base seed', () => {
    expect(deriveTrialSeeds(1, 10)).not.toEqual(deriveTrialSeeds(2, 10));
  });
});
