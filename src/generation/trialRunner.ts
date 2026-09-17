// Runs the SAME generated batch against every algorithm under comparison. See
// dev_log/04_generation.md, "Trial runner: trialRunner.ts" — `batch` is built once, before the
// algorithm loop, so `batch[trialIndex]` is the literal same array/object handed to every
// algorithm for that trial index. This is the concrete mechanism that makes "byte-for-byte
// identical arrivals no matter which algorithm consumes them" true by construction rather than
// by convention. See fairness.test.ts for the regression test proving this holds end-to-end.

import type { Algorithm } from '../algorithms/types';
import { runSimulation, type RunSimulationResult } from '../engine';
import { generateTrialBatch } from './trialBatch';
import type { Scenario } from './types';

export interface TrialRunResult {
  algorithmId: string;
  trialIndex: number;
  result: RunSimulationResult;
}

// A generous multiple of the scenario's own time horizon, used as the default `maxTimeMs` safety
// cutoff when the caller doesn't supply one — large enough that a normally-quiescing run is never
// cut short, but still bounded so a pathological non-terminating hook fails fast rather than
// hanging the whole batch (same rationale Unit 02 used for runSimulation's own cutoff).
const DEFAULT_MAX_TIME_MULTIPLIER = 20;

function defaultMaxTimeMs(scenario: Scenario): number {
  if (scenario.type === 'random') {
    return scenario.durationMs * DEFAULT_MAX_TIME_MULTIPLIER;
  }
  const lastArrivalTime = scenario.script.reduce(
    (max, arrival) => Math.max(max, arrival.arrivalTime),
    0,
  );
  // The `|| DEFAULT_MAX_TIME_MULTIPLIER` fallback guards an empty/all-zero-arrival-time script,
  // where `lastArrivalTime * multiplier` would itself compute to 0 and cut the run short
  // immediately instead of giving it any room to run at all.
  return lastArrivalTime * DEFAULT_MAX_TIME_MULTIPLIER || DEFAULT_MAX_TIME_MULTIPLIER;
}

export function runTrialBatch(
  scenario: Scenario,
  algorithms: Algorithm[],
  options?: { maxTimeMs?: number },
): TrialRunResult[] {
  const batch = generateTrialBatch(scenario); // computed ONCE — shared across every algorithm
  const maxTimeMs = options?.maxTimeMs ?? defaultMaxTimeMs(scenario);
  const results: TrialRunResult[] = [];
  for (const algorithm of algorithms) {
    for (let trialIndex = 0; trialIndex < batch.length; trialIndex++) {
      const hook = algorithm.createHook(); // fresh per runSimulation call — per Unit 03's contract
      const result = runSimulation(scenario.building, batch[trialIndex], hook, { maxTimeMs });
      results.push({ algorithmId: algorithm.id, trialIndex, result });
    }
  }
  return results;
}
