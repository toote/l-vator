// Builds the app's single initial AppState. See dev_log/06_ui.md, "Config panel fields and
// defaults" for the default table this mirrors exactly.

import { algorithms } from '../algorithms';
import type { ScriptedScenario } from '../generation';
import { scenarios } from '../scenarios';
import type { AppState, ConfigDraft } from './types';

/** Math.random() is fine here -- it only ever picks a default SEED, never used inside the
 * reproducible simulation itself. See dev_log/06_ui.md, "durationMs and seed". */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * `src/scenarios`'s exported `scenarios` is typed `Scenario[]` (the full union), since nothing
 * in src/scenarios/index.ts's own type restricts it to scripted examples today -- even though
 * every scenario currently on disk (upPeakDemo.ts) happens to be a ScriptedScenario. This unit's
 * "Load example scenario" mode is specifically about scripted examples (per dev_log/06_ui.md,
 * "Scenario type toggle"), so this narrows via a type predicate rather than widening
 * ConfigDraft.scriptedScenario to the full Scenario union -- src/scenarios/index.ts itself is
 * left untouched, per this unit's scope.
 */
export function scriptedScenarios(): ScriptedScenario[] {
  return scenarios.filter((scenario): scenario is ScriptedScenario => scenario.type === 'scripted');
}

export function defaultConfig(): ConfigDraft {
  return {
    mode: 'random',
    building: {
      floorCount: 5,
      elevatorCount: 2,
      capacity: 8,
      floorTravelTimeMs: 5000,
      doorDwellBaseMs: 1000,
      doorDwellPerPassengerMultiplier: 0.5,
      idleReturnThresholdMs: 30000,
    },
    arrivals: {
      baseRatePerMinute: 6,
      pattern: 'up-peak',
      floorRates: {},
    },
    durationMinutes: 5,
    seed: randomSeed(),
    trialCount: 10,
    scriptedScenario: scriptedScenarios()[0] ?? null,
  };
}

export function initialState(): AppState {
  return {
    config: defaultConfig(),
    // All algorithms checked by default -- see dev_log/06_ui.md, "Algorithm selection".
    selectedAlgorithmIds: algorithms.map((algorithm) => algorithm.id),
    run: { status: 'idle' },
    replay: null,
  };
}
