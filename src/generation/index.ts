// Public barrel export for the call-generation layer. See dev_log/04_generation.md, "Directory/
// file layout".

export { createRng, deriveTrialSeeds, sampleExponentialGapMs } from './rng';
export type { Rng, Seed } from './rng';

export { generateRandomArrivals, generatingFloors } from './randomArrivals';
export { loadScriptedScenario } from './scriptedScenario';
export { generateTrialBatch } from './trialBatch';
export { runTrialBatch } from './trialRunner';
export type { TrialRunResult } from './trialRunner';

export type {
  ArrivalPattern,
  RandomArrivalParams,
  RandomScenario,
  Scenario,
  ScriptedScenario,
} from './types';
