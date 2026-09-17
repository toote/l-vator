// Per-elevator log-replay reconstruction of hop occupancy, total distance, average occupancy,
// and deadhead percentage. See dev_log/05_metrics.md, "Total distance traveled and occupancy
// (distanceOccupancy.ts)" -- the exact event-ordering logic below was verified carefully during
// plan review; re-derived here from the plan's pseudocode precisely, not simplified/reinterpreted.
//
// `elevatorArrived` fires exactly once per floor-to-floor hop (never a multi-floor jump), so
// total distance = count of `elevatorArrived` entries, summed across elevators.
//
// Occupancy-per-hop is reconstructed by replaying each elevator's own log entries in order
// (already globally time-ordered, and one elevator's own entries are necessarily in true
// chronological order within that global order): boarding/alighting only ever happens between a
// `doorsOpened` and the following `doorsClosed`, never while moving, so an elevator's onboard
// count is constant for the entire duration of any single hop. When `elevatorArrived` fires,
// `onboard` still reflects whoever boarded/alighted at the PREVIOUS stop -- exactly who was
// actually carried across the hop that just completed -- because boarding/alighting for the stop
// the elevator has just arrived at hasn't been processed yet (it happens later, at the
// `doorsOpened` step triggered by this same arrival's dispatch decision).

import type { SimEventLogEntry } from '../engine';

export interface DistanceOccupancyResult {
  totalDistanceFloors: number;
  averageOccupancyWhileMovingPct: number | null; // null for zero hops, not 0/NaN
  deadheadTravelPct: number | null; // null for zero hops, not 0/NaN
}

export function computeDistanceOccupancy(
  log: readonly SimEventLogEntry[],
  elevatorIds: readonly string[],
  capacity: number,
): DistanceOccupancyResult {
  const hopOccupancies: number[] = [];

  for (const elevatorId of elevatorIds) {
    let onboard = 0;
    for (const entry of log) {
      if (entry.type === 'passengerBoarded') {
        if (entry.elevatorId === elevatorId) onboard += 1;
      } else if (entry.type === 'passengerAlighted') {
        if (entry.elevatorId === elevatorId) onboard -= 1;
      } else if (entry.type === 'elevatorArrived') {
        if (entry.elevatorId === elevatorId) hopOccupancies.push(onboard);
      }
    }
  }

  if (hopOccupancies.length === 0) {
    return {
      totalDistanceFloors: 0,
      averageOccupancyWhileMovingPct: null,
      deadheadTravelPct: null,
    };
  }

  const totalDistanceFloors = hopOccupancies.length;
  const averageOccupancyWhileMovingPct =
    (hopOccupancies.reduce((sum, occupancy) => sum + occupancy / capacity, 0) /
      totalDistanceFloors) *
    100;
  const deadheadTravelPct =
    (hopOccupancies.filter((occupancy) => occupancy === 0).length / totalDistanceFloors) * 100;

  return { totalDistanceFloors, averageOccupancyWhileMovingPct, deadheadTravelPct };
}
