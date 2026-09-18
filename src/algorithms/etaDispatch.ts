// ETA-based dispatch: no hard compatibility filter, lowest-estimated-arrival-time wins. See
// dev_log/11_algorithm_expansion.md, "New algorithm 2: ETA-based dispatch".
//
// Every capacity-available, unassigned elevator is a candidate for every unassigned call -- a
// wrong-direction or busy elevator is never hard-excluded (unlike nearestCarDirectional.ts), it
// simply gets a higher cost estimate (it has to finish its current commitments, then reverse,
// before it can even start toward the call). This naturally subsumes the direction question
// through cost rather than a hard filter, which is what real elevator dispatch approximates.
//
// Same assignment-map/hasVisited/unvisited-timeout structure as nearestCarDirectional.ts, reused
// for consistency (this project's established per-file-duplication convention, not a shared
// module) -- an ETA estimate is only meaningful as a snapshot-in-time value, so it's recomputed
// fresh every refreshAssignments pass, same as distance already is for the other algorithms; no
// need to "lock in" a stale estimate.

import type {
  DispatchAction,
  DispatchHook,
  DispatchSnapshot,
  ElevatorSnapshot,
  FloorIndex,
  HallCall,
} from '../engine';
import { directionFrom, distance } from './shared';
import type { Algorithm } from './types';

function callKey(call: HallCall): string {
  return `${call.floor}:${call.direction}`;
}

function nearestFloor(floors: readonly FloorIndex[], from: FloorIndex): FloorIndex | undefined {
  let best: FloorIndex | undefined;
  let bestDistance = Infinity;
  for (const floor of floors) {
    const d = distance(from, floor);
    if (d < bestDistance) {
      bestDistance = d;
      best = floor;
    }
  }
  return best;
}

/** Same idea as nearestCarDirectional.ts's isCompatible: idle or empty (no committed direction
 * to conflict with) is always "compatible" -- straight there, no detour needed. */
function isCompatibleDirection(elevator: ElevatorSnapshot, call: HallCall): boolean {
  if (elevator.state === 'idle') return true;
  if (elevator.direction !== call.direction) return false;
  return call.direction === 'up'
    ? elevator.currentFloor <= call.floor
    : elevator.currentFloor >= call.floor;
}

/** Car-button stops strictly between `from` and `to` (both exclusive), regardless of direction. */
function stopsBetweenExclusive(
  carButtons: readonly FloorIndex[],
  from: FloorIndex,
  to: FloorIndex,
): number {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return carButtons.filter((f) => f > lo && f < hi).length;
}

/** Car-button stops strictly after `from`, up to and including `to`, in whichever direction `to`
 * lies from `from`. Used for "stops on the way to the turnaround floor", which IS itself a stop. */
function stopsAheadInclusive(
  carButtons: readonly FloorIndex[],
  from: FloorIndex,
  to: FloorIndex,
): number {
  if (to >= from) return carButtons.filter((f) => f > from && f <= to).length;
  return carButtons.filter((f) => f < from && f >= to).length;
}

/**
 * Estimated ms until `elevator` could realistically reach `call.floor`.
 *
 * Compatible (idle, or already heading the call's direction and hasn't passed it): straight
 * there -- travel time plus one dwell per existing car-button stop strictly en route.
 *
 * Incompatible (committed to a different direction, or already passed): must finish its current
 * commitment first -- travel to its farthest remaining car button in its committed direction
 * (paying a dwell per stop along the way, including that final stop), THEN reverse and travel to
 * the call. A flat per-stop dwell approximation, not this project's real per-passenger dwell
 * formula -- the destinations of not-yet-boarded passengers are never known ahead of boarding, so
 * the real formula's occupancy-dependent term isn't computable in advance.
 */
export function estimateArrivalMs(
  elevator: ElevatorSnapshot,
  call: HallCall,
  floorTravelTimeMs: number,
  doorDwellBaseMs: number,
): number {
  if (isCompatibleDirection(elevator, call)) {
    const stopsEnRoute = stopsBetweenExclusive(
      elevator.carButtons,
      elevator.currentFloor,
      call.floor,
    );
    return (
      distance(elevator.currentFloor, call.floor) * floorTravelTimeMs +
      stopsEnRoute * doorDwellBaseMs
    );
  }

  const turnaroundFloor =
    elevator.carButtons.length === 0
      ? elevator.currentFloor
      : elevator.direction === 'up'
        ? Math.max(...elevator.carButtons)
        : Math.min(...elevator.carButtons);
  const stopsToTurnaround = stopsAheadInclusive(
    elevator.carButtons,
    elevator.currentFloor,
    turnaroundFloor,
  );
  return (
    distance(elevator.currentFloor, turnaroundFloor) * floorTravelTimeMs +
    stopsToTurnaround * doorDwellBaseMs +
    distance(turnaroundFloor, call.floor) * floorTravelTimeMs
  );
}

/** See nearestCarDirectional.ts's identical shape for the full rationale. */
interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

/** See nearestCarDirectional.ts's identical constant for the full rationale. */
const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Identical structure to nearestCarDirectional.ts's refreshAssignments, except candidate
 * selection has no compatibility filter at all (every capacity-available, unclaimed elevator is
 * eligible) and picks the lowest `estimateArrivalMs`, tie-broken by array order (lowest id).
 */
function refreshAssignments(
  snapshot: DispatchSnapshot,
  assignments: Map<string, Assignment>,
): void {
  const activeKeys = new Set(snapshot.activeHallCalls.map(callKey));
  const elevatorsById = new Map(snapshot.elevators.map((e) => [e.id, e]));
  const unvisitedTimeoutMs = UNVISITED_RELEASE_FLOOR_MULTIPLIER * snapshot.floorTravelTimeMs;

  for (const [elevatorId, assignment] of assignments) {
    if (!activeKeys.has(callKey(assignment.call))) {
      assignments.delete(elevatorId);
      continue;
    }
    const elevator = elevatorsById.get(elevatorId);
    if (!elevator) continue;
    if (elevator.currentFloor === assignment.call.floor) {
      assignment.hasVisited = true;
    } else if (assignment.hasVisited) {
      assignments.delete(elevatorId);
    } else if (snapshot.time - assignment.assignedAt >= unvisitedTimeoutMs) {
      assignments.delete(elevatorId);
    }
  }

  const assignedCallKeys = new Set(Array.from(assignments.values()).map((a) => callKey(a.call)));
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    const candidates = snapshot.elevators.filter(
      (elevator) => !assignments.has(elevator.id) && elevator.capacityRemaining > 0,
    );
    if (candidates.length === 0) continue;

    let best = candidates[0]!;
    let bestEta = estimateArrivalMs(
      best,
      call,
      snapshot.floorTravelTimeMs,
      snapshot.doorDwellBaseMs,
    );
    for (const candidate of candidates.slice(1)) {
      const eta = estimateArrivalMs(
        candidate,
        call,
        snapshot.floorTravelTimeMs,
        snapshot.doorDwellBaseMs,
      );
      if (eta < bestEta) {
        best = candidate;
        bestEta = eta;
      }
    }
    assignments.set(best.id, {
      call,
      hasVisited: best.currentFloor === call.floor,
      assignedAt: snapshot.time,
    });
  }
}

function decide(elevator: ElevatorSnapshot, assignments: Map<string, Assignment>): DispatchAction {
  if (elevator.carButtons.includes(elevator.currentFloor)) {
    return { type: 'stop', elevatorId: elevator.id };
  }

  const call = assignments.get(elevator.id)?.call;
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
    return { type: 'stop', elevatorId: elevator.id };
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    return { type: 'idle', elevatorId: elevator.id };
  }

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    return { type: 'idle', elevatorId: elevator.id };
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'eta-dispatch',
  name: 'ETA-Based',
  description:
    'Estimates how long every capacity-available elevator would take to reach each call ' +
    '(travel time plus dwell for any stops along the way, factoring in a reversal for an ' +
    'elevator already committed the wrong way) and assigns the call to whichever elevator has ' +
    'the lowest estimate. No elevator is ever hard-excluded by direction -- a bad match simply ' +
    'costs more.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
