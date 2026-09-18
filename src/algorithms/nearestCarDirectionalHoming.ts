// Nearest-car dispatch with directional matching, with a "returns to the lobby after sitting idle
// too long" homing policy layered on top. See dev_log/10_homing_algorithms.md.
//
// Everything except the idle fallback mirrors nearestCarDirectional.ts (deliberately duplicated,
// not shared -- see dev_log/10_homing_algorithms.md's "Duplication vs. sharing"). The base
// nearestCarDirectional.ts itself is completely untouched by this unit.
//
// Homing mechanics are identical to fcfsNearestCarHoming.ts's -- see that file's header comment
// for the full rationale (per-elevator `idleSince` closure map, cleared on every real action,
// homing travel toward floor 0 once idle for `snapshot.idleReturnThresholdMs`, no special
// preemption logic needed for a real call to override it).

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

/** The entry of `floors` nearest to `from`; ties keep the first (stable array order). */
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

function isCompatible(elevator: ElevatorSnapshot, call: HallCall): boolean {
  if (elevator.state === 'idle') return true; // no committed direction to conflict with
  if (elevator.direction !== call.direction) return false;
  return call.direction === 'up'
    ? elevator.currentFloor <= call.floor
    : elevator.currentFloor >= call.floor;
}

/**
 * An assignment plus whether the assigned elevator has ever actually reached the call's floor.
 * `hasVisited` is what makes an overflow assignment releasable (see refreshAssignments) without
 * also releasing an elevator that's merely still travelling toward a call it hasn't reached yet.
 *
 * `assignedAt` backs a second, independent release path — see fcfsNearestCar.ts's identical fix
 * ("Unvisited timeout") for the full rationale.
 */
interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

/** See fcfsNearestCar.ts's identical constant for the full rationale. */
const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Identical to nearestCarDirectional.ts's refreshAssignments (including its "unvisited timeout"
 * fix — see fcfsNearestCar.ts's doc comment for the full rationale). Homing plays no role here: a
 * homing elevator (idle-but-drifting toward floor 0, `state === 'idle'` in engine terms until it
 * actually starts moving) is a completely ordinary compatible candidate, picked up by this same
 * logic exactly like any other idle elevator, and is in fact exactly the kind of "genuinely idle"
 * candidate the idle-preference fix below favors. Once actually moving toward home
 * (`direction: 'down'`), it remains compatible with any active 'down' call it hasn't yet passed —
 * again, no special-casing needed.
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
    if (!elevator) continue; // defensive: elevator id from a prior snapshot no longer present
    if (elevator.currentFloor === assignment.call.floor) {
      assignment.hasVisited = true;
    } else if (assignment.hasVisited) {
      assignments.delete(elevatorId);
    } else if (snapshot.time - assignment.assignedAt >= unvisitedTimeoutMs) {
      assignments.delete(elevatorId); // never visited at all, and it's been too long
    }
  }

  const assignedCallKeys = new Set(Array.from(assignments.values()).map((a) => callKey(a.call)));
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    const allCandidates = snapshot.elevators.filter(
      (elevator) =>
        !assignments.has(elevator.id) &&
        elevator.capacityRemaining > 0 &&
        isCompatible(elevator, call),
    );
    if (allCandidates.length === 0) continue;

    const idleCandidates = allCandidates.filter((elevator) => elevator.carButtons.length === 0);
    const candidates = idleCandidates.length > 0 ? idleCandidates : allCandidates;

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
    return { type: 'stop', elevatorId: elevator.id }; // drop-off takes priority over a new pickup
  }

  const call = assignments.get(elevator.id)?.call;
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
    idleSince.delete(elevator.id);
    return { type: 'stop', elevatorId: elevator.id }; // pickup
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    return decideHoming(elevator, snapshot, idleSince);
  }
  idleSince.delete(elevator.id);

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    // Unreachable by construction (target === currentFloor would already have matched one of
    // the stop checks above), kept only as a defensive, type-safe fallback.
    return { type: 'idle', elevatorId: elevator.id };
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'nearest-car-directional-homing',
  // Plan's naming table literally says "Nearest Car - Directional (Returns to Lobby)", but its own
  // stated rule right below the table ("matches each base algorithm's existing display name
  // exactly, with a parenthetical suffix") points to a different string -- the base algorithm's
  // actual `name` (nearestCarDirectional.ts) is "Nearest Car (Directional)", not "Nearest Car -
  // Directional". Followed the stated rule over the table's apparently-mistyped string; flagged in
  // dev_log/10_homing_algorithms.md's AI Interactions.
  name: 'Nearest Car (Directional) (Returns to Lobby)',
  description:
    'The Nearest Car (Directional) strategy, plus one addition: an elevator that sits idle ' +
    'longer than the configured idle return threshold heads back to floor 0 on its own, instead ' +
    'of waiting wherever it last happened to stop — keeps the fleet positioned closer to where ' +
    'demand usually originates, so a returning car does not have to be summoned from wherever ' +
    'its last drop-off left it.',
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
