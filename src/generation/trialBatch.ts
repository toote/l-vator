// Fixes a scenario's arrivals for a whole N-trial batch, once, up front, independent of any
// algorithm. See dev_log/04_generation.md, "Trial batch generation: trialBatch.ts" — this is the
// single function the fairness guarantee falls directly out of: calling it exactly once per
// batch and reusing its result across every algorithm (trialRunner.ts's job).

import type { ScriptedInput } from '../engine';
import { generateRandomArrivals } from './randomArrivals';
import { deriveTrialSeeds } from './rng';
import { loadScriptedScenario } from './scriptedScenario';
import type { Scenario } from './types';

export function generateTrialBatch(scenario: Scenario): ScriptedInput[] {
  if (scenario.type === 'scripted') {
    const script = loadScriptedScenario(scenario);
    // Same array reference reused N times, deliberately: PassengerArrival records are treated
    // as immutable data throughout the engine (runSimulation never mutates the input script —
    // it copies each arrival's fields into a fresh Passenger), so aliasing is safe and avoids
    // pointless defensive copies.
    return Array.from({ length: scenario.trialCount }, () => script);
  }

  const trialSeeds = deriveTrialSeeds(scenario.seed, scenario.trialCount);
  return trialSeeds.map((seed) =>
    generateRandomArrivals(scenario.building, scenario.arrivals, scenario.durationMs, seed),
  );
}
