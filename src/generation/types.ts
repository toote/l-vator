// Scenario shapes for the call-generation layer. See dev_log/04_generation.md, "Scenario shape:
// types.ts". Plain data only, no classes — consistent with src/engine and src/algorithms's
// established style.

import type { BuildingConfig, FloorIndex, ScriptedInput } from '../engine';

export type ArrivalPattern = 'up-peak' | 'down-peak' | 'lunch-peak' | 'random';
// up-peak    = fixed-from-floor-0 ("morning rush"): everyone originates at the ground floor.
// down-peak  = fixed-to-floor-0 ("evening rush"): everyone's destination is the ground floor.
// lunch-peak = both peaks at once ("midday interfloor traffic"): every floor generates its own
//              arrivals (independently rated, like `random` — see RandomArrivalParams.floorRates),
//              but destinations aren't uniform everywhere: floor 0 behaves like up-peak (its
//              passengers can be headed to any other floor), while every OTHER floor behaves like
//              down-peak (its passengers are always headed back to floor 0) — see
//              randomArrivals.ts's "generating floors" doc comment.
// random     = origin AND destination both drawn at random (see randomArrivals.ts).

export interface RandomArrivalParams {
  /** Average arrivals per MINUTE, applied uniformly unless overridden by floorRates. */
  baseRatePerMinute: number;
  pattern: ArrivalPattern;
  /**
   * Optional per-floor override (arrivals/minute), keyed by FloorIndex. A floor not present
   * falls back to baseRatePerMinute. Only meaningful for floors the chosen pattern actually
   * generates arrivals from — see randomArrivals.ts's "generating floors" doc comment. An
   * override on a non-generating floor is a silent no-op (resolved by developer — see
   * dev_log/04_generation.md, open question 6).
   */
  floorRates?: Partial<Record<FloorIndex, number>>;
}

export interface RandomScenario {
  type: 'random';
  building: BuildingConfig;
  arrivals: RandomArrivalParams;
  /** Simulated time window (ms) over which arrivals are generated. */
  durationMs: number;
  /** Number of seeded trials in the batch. */
  trialCount: number;
  /** The ONE seed needed to reproduce the entire N-trial batch — see rng.ts's deriveTrialSeeds. */
  seed: number;
}

export interface ScriptedScenario {
  type: 'scripted';
  building: BuildingConfig;
  /** Fixed, hand-authored — identical for every trial by construction (no randomness to vary). */
  script: ScriptedInput;
  trialCount: number;
}

export type Scenario = RandomScenario | ScriptedScenario;
