// createRng's own behavior is covered by src/engine/rng.test.ts (its new home as of Unit 11).
// This file covers only what's still generation-specific: deriveTrialSeeds, plus a smoke test
// that the re-export from ../engine/rng still works.

import { describe, expect, it } from 'vitest';
import { createRng, deriveTrialSeeds } from './rng';

describe('createRng (re-export smoke test)', () => {
  it('is reachable via src/generation/rng.ts and still deterministic', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(a.next()).toBe(b.next());
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
