// Pooled cross-trial aggregation. See dev_log/05_metrics.md, "Aggregation across trials
// (aggregate.ts)".
//
// General policy for every ratio/average-shaped metric (average wait, average travel,
// throughput, average occupancy %, deadhead %): pool -- sum the numerator and denominator across
// all trials, then divide once -- rather than averaging each trial's already-computed ratio (a
// naive mean-of-averages implicitly gives a 3-passenger trial the same weight as a 300-passenger
// one, which is wrong when trial sizes vary, as they can under RandomScenario). Since this module
// receives only TrialMetrics[] (per-trial summaries, not raw passenger records), pooling is done
// by reconstructing each trial's numerator as (that trial's ratio * that trial's own denominator
// count) -- exact, not approximate, since ratio_i * count_i recovers the trial's summed value
// exactly (mathematically; ordinary floating-point rounding aside, which is already present in
// the stored per-trial ratio regardless of how it's later combined).
//
// Total distance traveled is a genuine total, not a ratio -- its aggregate is a simple mean of
// each trial's total. Max wait time is resolved (developer sign-off, see the plan's Open
// Questions) as true max-across-all-trials, with meanOfPerTrialMaxWaitTimeMs shipped alongside as
// a supporting stat. unservedCount/servedCounts are summed across trials, and unservedPct is
// recomputed from the summed totals -- never averaged from per-trial percentages, the same
// pooling principle as every other ratio metric.

import { MS_PER_HOUR } from './throughput';
import type { AlgorithmMetrics, ServedCounts, TrialMetrics } from './types';

interface WeightedValue {
  value: number | null;
  weight: number;
}

/**
 * Pools a set of (per-trial ratio, per-trial weight) pairs into one ratio: sum(value * weight) /
 * sum(weight), skipping zero-weight trials entirely. A positive weight paired with a null value
 * would mean a trial's own TrialMetrics computation is internally inconsistent (its per-trial
 * logic guarantees a non-null ratio whenever its corresponding count/weight is positive), so
 * that combination throws rather than silently producing NaN or a misleading number.
 */
function pooledAverage(pairs: readonly WeightedValue[]): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const { value, weight } of pairs) {
    if (weight <= 0) continue;
    if (value === null) {
      throw new Error(
        'aggregateTrialMetrics: a TrialMetrics had a positive weight but a null ratio -- ' +
          'this should be impossible by construction (see trialMetrics.ts).',
      );
    }
    weightedSum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function aggregateTrialMetrics(trialMetrics: TrialMetrics[]): AlgorithmMetrics {
  if (trialMetrics.length === 0) {
    throw new Error('aggregateTrialMetrics requires at least one TrialMetrics');
  }

  const perTrial = [...trialMetrics].sort((a, b) => a.trialIndex - b.trialIndex);
  const algorithmId = perTrial[0].algorithmId;
  const trialCount = perTrial.length;

  const averageWaitTimeMs = pooledAverage(
    perTrial.map((t) => ({
      value: t.averageWaitTimeMs,
      weight: t.servedCounts.served + t.servedCounts.boardedOnly,
    })),
  );

  const averageTravelTimeMs = pooledAverage(
    perTrial.map((t) => ({ value: t.averageTravelTimeMs, weight: t.servedCounts.served })),
  );

  const throughputPerHour = pooledAverage(
    perTrial.map((t) => ({
      value: t.throughputPerHour,
      weight: t.simulatedDurationMs / MS_PER_HOUR,
    })),
  );

  const averageOccupancyWhileMovingPct = pooledAverage(
    perTrial.map((t) => ({
      value: t.averageOccupancyWhileMovingPct,
      weight: t.totalDistanceFloors,
    })),
  );

  const deadheadTravelPct = pooledAverage(
    perTrial.map((t) => ({ value: t.deadheadTravelPct, weight: t.totalDistanceFloors })),
  );

  const maxWaits = perTrial.map((t) => t.maxWaitTimeMs).filter((w): w is number => w !== null);
  const maxWaitTimeMs = maxWaits.length > 0 ? Math.max(...maxWaits) : null;
  const meanOfPerTrialMaxWaitTimeMs = maxWaits.length > 0 ? mean(maxWaits) : null;

  const totalDistanceFloors = mean(perTrial.map((t) => t.totalDistanceFloors));

  const servedCounts: ServedCounts = perTrial.reduce(
    (acc, t) => ({
      total: acc.total + t.servedCounts.total,
      served: acc.served + t.servedCounts.served,
      boardedOnly: acc.boardedOnly + t.servedCounts.boardedOnly,
      neverBoarded: acc.neverBoarded + t.servedCounts.neverBoarded,
    }),
    { total: 0, served: 0, boardedOnly: 0, neverBoarded: 0 },
  );

  const unservedCount = perTrial.reduce((sum, t) => sum + t.unservedCount, 0);
  const unservedPct = servedCounts.total > 0 ? (unservedCount / servedCounts.total) * 100 : null;

  return {
    algorithmId,
    trialCount,
    averageWaitTimeMs,
    maxWaitTimeMs,
    meanOfPerTrialMaxWaitTimeMs,
    averageTravelTimeMs,
    totalDistanceFloors,
    throughputPerHour,
    averageOccupancyWhileMovingPct,
    deadheadTravelPct,
    unservedCount,
    unservedPct,
    servedCounts,
    perTrial,
  };
}
