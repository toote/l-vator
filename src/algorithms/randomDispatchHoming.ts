// Random dispatch, with a "returns to the lobby after sitting idle too long" homing policy
// layered on top. See dev_log/10_homing_algorithms.md for the homing mechanism's full rationale
// and randomDispatch.ts for the random-selection model (including why it's a deterministic,
// seed-reproducible pseudo-random pick, never Math.random()).
//
// Everything except the idle fallback mirrors randomDispatch.ts (deliberately duplicated, not
// shared). The base randomDispatch.ts itself is completely untouched by this file.

import { createRng } from '../engine';
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

/** See randomDispatch.ts's identical function for the full rationale. */
function pseudoRandomIndex(time: number, call: HallCall, candidateCount: number): number {
  const seed =
    (Math.floor(time * 1000) ^ (call.floor * 2654435761) ^ (call.direction === 'up' ? 1 : 0)) >>> 0;
  return Math.floor(createRng(seed).next() * candidateCount);
}

interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/** Identical to randomDispatch.ts's refreshAssignments. See nearestCarDirectionalHoming.ts's
 * identical note for why homing needs no special-casing here either. */
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

    const index = pseudoRandomIndex(snapshot.time, call, candidates.length);
    const best = candidates[index]!;
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
  id: 'random-dispatch-homing',
  name: 'Random (Returns to Lobby)',
  description:
    'The Random strategy, plus one addition: an elevator that sits idle longer than the ' +
    'configured idle return threshold heads back to floor 0 on its own, instead of waiting ' +
    'wherever it last happened to stop.',
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
