// Public barrel export for the metrics-computation layer. See dev_log/05_metrics.md,
// "Implementation" directory layout and "Public API".

export { aggregateTrialMetrics } from './aggregate';
export { computeMetrics } from './computeMetrics';
export type { DistanceOccupancyResult } from './distanceOccupancy';
export { computeDistanceOccupancy } from './distanceOccupancy';
export { buildPassengerRecords } from './passengerRecords';
export { computeThroughputPerHour } from './throughput';
export { computeTrialMetrics } from './trialMetrics';
export type {
  AlgorithmMetrics,
  PassengerRecord,
  PassengerStatus,
  ServedCounts,
  TrialMetrics,
} from './types';
