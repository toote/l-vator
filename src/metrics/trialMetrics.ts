// Combines passengerRecords.ts, distanceOccupancy.ts, and throughput.ts into one TrialMetrics for
// a single trial. See dev_log/05_metrics.md, "Implementation" directory layout.

import type { BuildingConfig, ScriptedInput } from '../engine';
import type { TrialRunResult } from '../generation';
import { computeDistanceOccupancy } from './distanceOccupancy';
import { buildPassengerRecords } from './passengerRecords';
import { computeThroughputPerHour } from './throughput';
import type { PassengerRecord, ServedCounts, TrialMetrics } from './types';

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Every passenger whose wait is "done" (they have a real waitTimeMs, not a censored lower bound). */
function isWaitDone(
  record: PassengerRecord,
): record is Extract<PassengerRecord, { status: 'served' | 'boardedOnly' }> {
  return record.status === 'served' || record.status === 'boardedOnly';
}

function isServed(
  record: PassengerRecord,
): record is Extract<PassengerRecord, { status: 'served' }> {
  return record.status === 'served';
}

/** The wait duration to use for the MAX-wait metric, which includes every passenger (see
 * dev_log/05_metrics.md, "Never-served passengers"): a real waitTimeMs when available, otherwise
 * the neverBoarded passenger's censored lower bound. */
function waitForMax(record: PassengerRecord): number {
  return record.status === 'neverBoarded' ? record.censoredWaitMs : record.waitTimeMs;
}

export function computeTrialMetrics(
  trialResult: TrialRunResult,
  arrivals: ScriptedInput,
  building: BuildingConfig,
): TrialMetrics {
  const { finalState, log } = trialResult.result;
  const records = buildPassengerRecords(arrivals, log, finalState.time);

  const servedCounts: ServedCounts = {
    total: records.length,
    served: records.filter(isServed).length,
    boardedOnly: records.filter((r) => r.status === 'boardedOnly').length,
    neverBoarded: records.filter((r) => r.status === 'neverBoarded').length,
  };

  const waitDoneRecords = records.filter(isWaitDone);
  const averageWaitTimeMs =
    waitDoneRecords.length > 0 ? mean(waitDoneRecords.map((r) => r.waitTimeMs)) : null;

  const maxWaitTimeMs = records.length > 0 ? Math.max(...records.map(waitForMax)) : null;

  const servedRecords = records.filter(isServed);
  const averageTravelTimeMs =
    servedRecords.length > 0 ? mean(servedRecords.map((r) => r.travelTimeMs)) : null;

  const elevatorIds = finalState.elevators.map((e) => e.id);
  const { totalDistanceFloors, averageOccupancyWhileMovingPct, deadheadTravelPct } =
    computeDistanceOccupancy(log, elevatorIds, building.capacity);

  const throughputPerHour = computeThroughputPerHour(servedCounts.served, finalState.time);

  const unservedCount = servedCounts.boardedOnly + servedCounts.neverBoarded;
  const unservedPct = servedCounts.total > 0 ? (unservedCount / servedCounts.total) * 100 : null;

  return {
    algorithmId: trialResult.algorithmId,
    trialIndex: trialResult.trialIndex,
    simulatedDurationMs: finalState.time,
    averageWaitTimeMs,
    maxWaitTimeMs,
    averageTravelTimeMs,
    totalDistanceFloors,
    throughputPerHour,
    averageOccupancyWhileMovingPct,
    deadheadTravelPct,
    unservedCount,
    unservedPct,
    servedCounts,
  };
}
