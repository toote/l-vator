// Seedable PRNG. `Math.random()` cannot be seeded, so a small seedable PRNG is required for
// reproducible, seeded batch comparisons — see dev_log/04_generation.md, "RNG: rng.ts".
// mulberry32: a single uint32 of state, ~5 lines, no dependency, good enough statistical quality
// for a teaching/toy simulation (explicitly not cryptographic, which isn't a requirement here).
//
// Lives in engine/, not generation/, so that src/algorithms/ (which src/generation/ already
// depends on, via trialRunner.ts's import of the Algorithm type) can also depend on it without
// creating a circular module dependency — see dev_log/11_algorithm_expansion.md's "Random
// dispatch" section for the full rationale (randomDispatch.ts is the consumer). generation/rng.ts
// re-exports this for backward compatibility with every pre-existing import.

export type Seed = number; // treated as an unsigned 32-bit integer

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

export function createRng(seed: Seed): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
