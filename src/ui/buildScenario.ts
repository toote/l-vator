// Pure: turns the UI's ConfigDraft into a Scenario runTrialBatch can consume. No DOM. See
// dev_log/06_ui.md, "Directory/file layout" and "Scenario type toggle: random vs. scripted".

import { generatingFloors, type RandomArrivalParams, type Scenario } from '../generation';
import type { ConfigDraft } from './types';

export function buildScenario(draft: ConfigDraft): Scenario {
  if (draft.mode === 'scripted') {
    if (!draft.scriptedScenario) {
      throw new Error('No example scenario selected.');
    }
    // The stored scenario's own trialCount is just its own default -- the UI's current trial
    // count is spliced in, per dev_log/06_ui.md's "Scenario type toggle" section.
    return { ...draft.scriptedScenario, trialCount: draft.trialCount };
  }

  // Only pattern-relevant floors' entered overrides survive -- mirrors randomArrivals.ts's own
  // generatingFloors rule exactly (imported, not duplicated -- see dev_log/06_ui.md open
  // question 4), so an override on a floor the pattern would never generate from is dropped here
  // rather than silently no-op-ing deeper in the generation layer.
  const relevantFloors = generatingFloors(draft.arrivals.pattern, draft.building.floorCount);
  const floorRates: Partial<Record<number, number>> = {};
  for (const floor of relevantFloors) {
    const rate = draft.arrivals.floorRates[floor];
    if (rate !== undefined && !Number.isNaN(rate)) {
      floorRates[floor] = rate;
    }
  }

  const arrivals: RandomArrivalParams =
    Object.keys(floorRates).length > 0
      ? {
          baseRatePerMinute: draft.arrivals.baseRatePerMinute,
          pattern: draft.arrivals.pattern,
          floorRates,
        }
      : {
          baseRatePerMinute: draft.arrivals.baseRatePerMinute,
          pattern: draft.arrivals.pattern,
        };

  return {
    type: 'random',
    building: { ...draft.building },
    arrivals,
    durationMs: draft.durationMinutes * 60000,
    trialCount: draft.trialCount,
    seed: draft.seed,
  };
}
