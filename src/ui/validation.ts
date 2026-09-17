// Thin pre-run guard, run once at "Run" time -- not a form-validation framework. Pure, no DOM.
// See dev_log/06_ui.md, "Validation" and its "Correction" note (floorCount minimum of 1).

import type { AppState } from './types';

export function validate(state: AppState): string | null {
  // Nothing throws for an empty algorithm list -- runTrialBatch would just return [] and the
  // results table would silently render empty, which is more confusing than a clear message.
  if (state.selectedAlgorithmIds.length === 0) {
    return 'Select at least one algorithm to run.';
  }

  if (state.config.mode === 'scripted') {
    if (!state.config.scriptedScenario) {
      return 'Select an example scenario to run.';
    }
    if (!Number.isFinite(state.config.trialCount)) {
      return 'Trial count must be a number.';
    }
    return null;
  }

  const { building, arrivals } = state.config;
  // A blank/non-numeric <input type="number"> yields NaN in the DOM, which would otherwise
  // propagate into a BuildingConfig and fail deep inside the engine with a less legible message
  // than catching it here, at the form boundary.
  const numericFields: Array<[string, number]> = [
    ['Floors (above ground)', building.floorCount],
    ['Elevators', building.elevatorCount],
    ['Capacity', building.capacity],
    ['Floor travel time', building.floorTravelTimeMs],
    ['Door dwell base', building.doorDwellBaseMs],
    ['Door dwell per-passenger multiplier', building.doorDwellPerPassengerMultiplier],
    ['Arrival rate', arrivals.baseRatePerMinute],
    ['Trial count', state.config.trialCount],
    ['Duration (minutes)', state.config.durationMinutes],
    ['Seed', state.config.seed],
  ];
  for (const [label, value] of numericFields) {
    if (!Number.isFinite(value)) {
      return `${label} must be a number.`;
    }
  }

  // Correction (developer review): floorCount: 0 reaches Unit 04's random generator and
  // deterministically returns an out-of-bounds floor under up-peak/random, crashing mid-run with
  // a cryptic bounds-check error instead of a clear validation message. Fixed here, at the UI
  // layer -- not by touching Unit 04 -- alongside the input's HTML min="1".
  if (building.floorCount < 1) {
    return 'Floors (above ground) must be at least 1.';
  }

  return null;
}
