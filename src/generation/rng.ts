// Generation-specific RNG helpers. `createRng`/`Rng`/`Seed` themselves moved to
// src/engine/rng.ts in Unit 11 (so src/algorithms/ can use them too, without a circular
// dependency — see dev_log/11_algorithm_expansion.md) and are re-exported here so every
// pre-existing import of this module keeps working unchanged.

import { createRng } from '../engine/rng';
import type { Rng, Seed } from '../engine/rng';

export { createRng };
export type { Rng, Seed };

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
