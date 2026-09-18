// Zone-restricted nearest-car dispatch, with a cross-zone fallback. See
// dev_log/11_algorithm_expansion.md, "New algorithm 1: Zoning".
//
// Identical to zoning.ts (deliberately duplicated, not shared -- see that file's header comment
// for the full zoning model/rationale) except for ONE difference: when every zone-eligible
// candidate for a call is full (or none exists), this variant falls back to the nearest ANY
// capacity-available elevator regardless of zone, on that same decision pass -- softening zoning
// into a preference rather than a hard boundary. zoning.ts's own strict behavior (the call simply
// waits) is preserved there, unchanged, as the honest "hard boundary" comparison point.

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

/** A contiguous floor range, inclusive. See zoning.ts's identical type for the full rationale. */
interface Zone {
  min: FloorIndex;
  max: FloorIndex;
}

/** See zoning.ts's identical function for the full rationale -- duplicated, not shared, per this
 * project's established per-file duplication convention. */
function zoneFor(elevatorIndex: number, elevatorCount: number, floorCount: number): Zone {
  const base = Math.floor(floorCount / elevatorCount);
  const remainder = floorCount % elevatorCount;

  let start = 1;
  for (let i = 0; i < elevatorIndex; i++) {
    start += base + (i < remainder ? 1 : 0);
  }
  const size = base + (elevatorIndex < remainder ? 1 : 0);
  return size === 0 ? { min: start, max: start - 1 } : { min: start, max: start + size - 1 };
}

function isZoneEligible(zone: Zone, call: HallCall): boolean {
  if (call.floor === 0) return true;
  return call.floor >= zone.min && call.floor <= zone.max;
}

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

interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Identical to zoning.ts's refreshAssignments except for the fallback step: a call with no
 * zone-eligible candidate is retried against the full elevator pool (still capacity-available,
 * still unclaimed this pass) before being left unassigned.
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

  const zones = snapshot.elevators.map((_, index) =>
    zoneFor(index, snapshot.elevators.length, snapshot.floorCount),
  );

  const assignedCallKeys = new Set(Array.from(assignments.values()).map((a) => callKey(a.call)));
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    const unclaimed = snapshot.elevators.filter(
      (elevator) => !assignments.has(elevator.id) && elevator.capacityRemaining > 0,
    );
    const zoneEligible = unclaimed.filter((elevator) => {
      const index = snapshot.elevators.indexOf(elevator);
      return isZoneEligible(zones[index]!, call);
    });
    // Prefer zone-eligible candidates; fall back to the full unclaimed pool only when none exist.
    const candidates = zoneEligible.length > 0 ? zoneEligible : unclaimed;
    if (candidates.length === 0) continue;

    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (distance(candidate.currentFloor, call.floor) < distance(best.currentFloor, call.floor)) {
        best = candidate;
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
  id: 'zoning-fallback',
  name: 'Zoning (With Fallback)',
  description:
    'The Zoning strategy, but softened: if every elevator eligible for a call’s zone is ' +
    'full, the call falls back to the nearest available elevator from any zone instead of ' +
    'waiting. Keeps the same spatial preference as plain Zoning, but never strands a call just ' +
    'because its own zone is temporarily saturated.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
