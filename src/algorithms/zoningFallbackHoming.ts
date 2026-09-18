// Zoning dispatch, WITH cross-zone fallback, with a "returns to the lobby after sitting idle too
// long" homing policy layered on top. See dev_log/10_homing_algorithms.md for the homing
// mechanism's full rationale and dev_log/11_algorithm_expansion.md for zoning's own model.
//
// Everything except the idle fallback mirrors zoningFallback.ts (deliberately duplicated, not
// shared). The base zoningFallback.ts itself is completely untouched by this file.

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

const HOME_FLOOR: FloorIndex = 0;

interface Zone {
  min: FloorIndex;
  max: FloorIndex;
}

/** See zoning.ts's identical function for the full rationale. */
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

/** Identical to zoningFallback.ts's refreshAssignments. See zoningHoming.ts's identical note for
 * why homing needs no special-casing here either. */
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

/** See fcfsNearestCarHoming.ts's identical helper for the full rationale. */
function decideHoming(
  elevator: ElevatorSnapshot,
  snapshot: DispatchSnapshot,
  idleSince: Map<string, number>,
): DispatchAction {
  if (!idleSince.has(elevator.id)) {
    idleSince.set(elevator.id, snapshot.time);
  }
  const idleFor = snapshot.time - idleSince.get(elevator.id)!;
  if (idleFor >= snapshot.idleReturnThresholdMs && elevator.currentFloor !== HOME_FLOOR) {
    return { type: 'travel', elevatorId: elevator.id, direction: 'down' };
  }
  return { type: 'idle', elevatorId: elevator.id };
}

function decide(
  elevator: ElevatorSnapshot,
  assignments: Map<string, Assignment>,
  snapshot: DispatchSnapshot,
  idleSince: Map<string, number>,
): DispatchAction {
  if (elevator.carButtons.includes(elevator.currentFloor)) {
    idleSince.delete(elevator.id);
    return { type: 'stop', elevatorId: elevator.id };
  }

  const call = assignments.get(elevator.id)?.call;
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
    idleSince.delete(elevator.id);
    return { type: 'stop', elevatorId: elevator.id };
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    return decideHoming(elevator, snapshot, idleSince);
  }
  idleSince.delete(elevator.id);

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    return { type: 'idle', elevatorId: elevator.id };
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'zoning-fallback-homing',
  name: 'Zoning (With Fallback) (Returns to Lobby)',
  description:
    'The Zoning (With Fallback) strategy, plus one addition: an elevator that sits idle longer ' +
    'than the configured idle return threshold heads back to floor 0 on its own, instead of ' +
    'waiting wherever it last happened to stop.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    const idleSince = new Map<string, number>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) =>
        decide(elevator, assignments, snapshot, idleSince),
      );
    };
  },
};
