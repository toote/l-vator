// Public entry point for the metrics layer. See dev_log/05_metrics.md, "Public API".
//
// Groups trialResults by algorithmId (not assumed pre-grouped/ordered), calls
// generateTrialBatch(scenario) exactly ONCE (it's deterministic and identical for every
// algorithm, per Unit 04's fairness guarantee -- one call suffices and avoids redundant
// regeneration work), then computes per-trial metrics by matching each TrialRunResult against
// `batch[trialResult.trialIndex]` -- and ONLY that index. This matters: under a RandomScenario,
// passenger ids like "arrival-0" can repeat across different trialIndex values (each trial has
// its own independent arrival sequence starting its own id numbering), so matching must stay
// scoped to the specific trialIndex a given TrialRunResult came from -- never flattened or merged
// across trials.

import type { ScriptedInput } from '../engine';
import { generateTrialBatch, type Scenario, type TrialRunResult } from '../generation';
import { aggregateTrialMetrics } from './aggregate';
import { computeTrialMetrics } from './trialMetrics';
import type { AlgorithmMetrics, TrialMetrics } from './types';

export function computeMetrics(
  trialResults: TrialRunResult[],
  scenario: Scenario,
): AlgorithmMetrics[] {
  const batch: ScriptedInput[] = generateTrialBatch(scenario); // called exactly once

  const byAlgorithm = new Map<string, TrialMetrics[]>();
  for (const trialResult of trialResults) {
    const arrivals = batch[trialResult.trialIndex];
    if (arrivals === undefined) {
      throw new Error(
        `computeMetrics: trialIndex ${trialResult.trialIndex} has no corresponding entry in the ` +
          `regenerated batch (batch has ${batch.length} trials) -- trialResults and scenario ` +
          'must come from the same batch.',
      );
    }

    // Scoped strictly to this trialResult's own trialIndex -- see module doc comment above.
    const metrics = computeTrialMetrics(trialResult, arrivals, scenario.building);

    const existing = byAlgorithm.get(trialResult.algorithmId);
    if (existing) {
      existing.push(metrics);
    } else {
      byAlgorithm.set(trialResult.algorithmId, [metrics]);
    }
  }

  return Array.from(byAlgorithm.values()).map((perTrial) => aggregateTrialMetrics(perTrial));
}
