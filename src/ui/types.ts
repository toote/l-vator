// UI-only state shapes. Plain data, no classes -- consistent with src/engine, src/algorithms,
// src/generation and src/metrics's established style. See dev_log/06_ui.md, "State model" and
// "Config panel fields and defaults".

import type { FloorIndex } from '../engine';
import type { ArrivalPattern, ScriptedScenario } from '../generation';
import type { AlgorithmMetrics } from '../metrics';

export type ScenarioMode = 'random' | 'scripted';

export interface BuildingDraft {
  floorCount: number;
  elevatorCount: number;
  capacity: number;
  floorTravelTimeMs: number;
  doorDwellBaseMs: number;
  doorDwellPerPassengerMultiplier: number;
}

export interface ArrivalsDraft {
  baseRatePerMinute: number;
  pattern: ArrivalPattern;
  /**
   * Per-floor override, keyed by FloorIndex. Only floors the user has actually typed a value
   * into are present -- an empty input is omitted here, not stored as NaN or 0. See
   * configPanel.ts's renderFloorRatesPanel and buildScenario.ts.
   */
  floorRates: Partial<Record<FloorIndex, number>>;
}

/** Everything the config panel edits. Numeric fields may transiently hold NaN while a user is
 * mid-edit (an empty <input type="number">'s valueAsNumber) -- validation.ts catches that before
 * a run, buildScenario.ts is never called with an invalid draft. */
export interface ConfigDraft {
  mode: ScenarioMode;
  building: BuildingDraft;
  arrivals: ArrivalsDraft;
  /** Minutes, for UI readability -- converted to RandomScenario's durationMs by buildScenario. */
  durationMinutes: number;
  seed: number;
  /** Shared between modes -- legal for a scripted scenario too (N identical trials). */
  trialCount: number;
  /** Selected example scenario for 'scripted' mode. Null only when none are available or none
   * has been selected yet. */
  scriptedScenario: ScriptedScenario | null;
}

/**
 * A fully consistent discriminated union on `status` -- resolving this plan's own inline
 * pseudocode (`'idle' | 'running' | {status:'done',...} | {status:'error',...}`) in favor of the
 * object form the "Run controls" section's step 2 explicitly writes (`state.run = { status:
 * 'running' }`), for one consistent shape throughout instead of mixing bare string literals with
 * objects.
 */
export type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; metrics: AlgorithmMetrics[] }
  | { status: 'error'; message: string };

export interface AppState {
  config: ConfigDraft;
  selectedAlgorithmIds: string[];
  run: RunState;
}
