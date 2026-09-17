// Public data shapes for the metrics-computation layer. See dev_log/05_metrics.md, "Public API".
// Plain data only, no classes -- consistent with src/engine, src/algorithms, src/generation.

export type PassengerStatus = 'served' | 'boardedOnly' | 'neverBoarded';

/**
 * Per-passenger classification for one trial, built by passengerRecords.ts from that trial's
 * regenerated arrivals + log (see dev_log/05_metrics.md, "Wait/travel time and passenger
 * status"). A discriminated union on `status` rather than one shape with optional fields: each
 * status has exactly the timing fields that status can produce, so nothing downstream needs a
 * non-null assertion to use them.
 */
export type PassengerRecord =
  | { id: string; status: 'served'; waitTimeMs: number; travelTimeMs: number }
  | { id: string; status: 'boardedOnly'; waitTimeMs: number }
  | { id: string; status: 'neverBoarded'; censoredWaitMs: number };

export interface ServedCounts {
  total: number;
  served: number; // boarded AND alighted
  boardedOnly: number; // boarded, not yet alighted at trial end
  neverBoarded: number;
}

export interface TrialMetrics {
  algorithmId: string;
  trialIndex: number;
  simulatedDurationMs: number; // finalState.time
  averageWaitTimeMs: number | null; // over served + boardedOnly; null if none
  maxWaitTimeMs: number | null; // over ALL passengers, censored for neverBoarded
  averageTravelTimeMs: number | null; // over served only; null if none
  totalDistanceFloors: number;
  throughputPerHour: number | null;
  averageOccupancyWhileMovingPct: number | null;
  deadheadTravelPct: number | null;
  unservedCount: number; // boardedOnly + neverBoarded -- 8th headline metric,
  // promoted from ServedCounts per developer request
  unservedPct: number | null; // unservedCount / servedCounts.total * 100; null if total 0
  servedCounts: ServedCounts; // full breakdown retained underneath
}

export interface AlgorithmMetrics {
  algorithmId: string;
  trialCount: number;
  averageWaitTimeMs: number | null; // pooled across trials
  maxWaitTimeMs: number | null; // max across ALL trials (see recommendation)
  meanOfPerTrialMaxWaitTimeMs: number | null; // supporting stat, alternate definition
  averageTravelTimeMs: number | null; // pooled
  totalDistanceFloors: number; // mean per-trial total
  throughputPerHour: number | null; // pooled
  averageOccupancyWhileMovingPct: number | null; // pooled
  deadheadTravelPct: number | null; // pooled
  unservedCount: number; // summed across trials
  unservedPct: number | null; // unservedCount / servedCounts.total * 100
  servedCounts: ServedCounts; // summed across trials
  perTrial: TrialMetrics[]; // retained in full for Unit 07's per-run detail
}
