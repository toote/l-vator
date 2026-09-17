// Seedable PRNG + derived sampling helpers. `Math.random()` cannot be seeded, so a small
// seedable PRNG is required for reproducible, seeded batch comparisons — see
// dev_log/04_generation.md, "RNG: rng.ts". mulberry32: a single uint32 of state, ~5 lines, no
// dependency, good enough statistical quality for a teaching/toy simulation (explicitly not
// cryptographic, which isn't a requirement here).

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

/**
 * Inverse-CDF exponential sample: the standard way to draw a Poisson-process inter-arrival gap
 * (ms) given a rate expressed in events per ms.
 *
 * Caller contract: `ratePerMs` must be strictly positive. A zero (or negative) rate is not
 * validated/guarded here — callers (randomArrivals.ts) are responsible for never invoking this
 * with a non-positive rate. See dev_log/04_generation.md's "Correction" note under "Random
 * arrival generation" for why a rate of exactly 0 passed through to this formula would produce
 * `NaN` (via `-Math.log(1 - 0) / 0 = -0 / 0`) on the rare draw where `rng.next()` returns exactly
 * `0`, silently breaking termination in a calling loop.
 */
export function sampleExponentialGapMs(rng: Rng, ratePerMs: number): number {
  return -Math.log(1 - rng.next()) / ratePerMs;
}

/**
 * Deterministically expands one base seed into `count` child seeds. This is the mechanism that
 * makes "N seeded trials, same seed sequence across every algorithm" tractable with a single
 * number: a scenario only needs ONE seed (`Scenario.seed`) to reproduce an entire N-trial batch,
 * because the batch's own generation (trialBatch.ts) always re-derives the same N child seeds
 * from it, in the same order, regardless of which algorithm(s) later consume the resulting
 * arrivals.
 */
export function deriveTrialSeeds(baseSeed: Seed, count: number): Seed[] {
  const rng = createRng(baseSeed);
  return Array.from({ length: count }, () => Math.floor(rng.next() * 0xffffffff) >>> 0);
}
