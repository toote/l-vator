// FCFS / naive nearest-car, with a "returns to the lobby after sitting idle too long" homing
// policy layered on top. See dev_log/10_homing_algorithms.md.
//
// Everything except the idle fallback is byte-for-byte identical in intent to fcfsNearestCar.ts
// (deliberately duplicated, not shared — see dev_log/10_homing_algorithms.md's "Duplication vs.
// sharing", consistent with this project's existing precedent of fcfsNearestCar.ts and
// nearestCarDirectional.ts already duplicating their near-identical decide()/refreshAssignments
// rather than share them). The base fcfsNearestCar.ts itself is completely untouched by this unit.
//
// Homing: a per-elevator `idleSince` map, held in this hook's own closure (NOT on
// ElevatorSnapshot or anywhere else per-elevator — see the plan). Whenever decide() would
// otherwise fall through to the idle policy (no assignment, no onboard destination), it stamps
// the first tick it noticed the elevator idle, and once idle for
// `snapshot.idleReturnThresholdMs` and not already at floor 0 (hardcoded home floor — see the
// plan's resolved open questions), returns `{ type: 'travel', direction: 'down' }` instead of
// `idle`. Every OTHER branch of decide() (both real stops, and the real travel-toward-a-target
// branch) clears `idleSince` — it's no longer idle, the clock resets. No special preemption logic
// is needed for a homing elevator to pick up a real call: from refreshAssignments'/decide's own
// perspective it's just another idle-but-available elevator, so the very next invocation where a
// real call needs an elevator assigns it normally, overriding the homing travel the same way any
// other redirect already works today.

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

/** See fcfsNearestCar.ts's identical function for the full rationale (developer-reported: an
 * elevator carrying passengers shouldn't be assigned a call outside its committed direction). */
function isCompatible(elevator: ElevatorSnapshot, call: HallCall): boolean {
  if (elevator.carButtons.length === 0) return true;
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
 * Identical to fcfsNearestCar.ts's refreshAssignments (including its "unvisited timeout" and
 * "direction compatibility" fixes — see that file's doc comments for the full rationale of both).
 * Homing plays no role here: a homing elevator (idle-but-drifting toward floor 0) is still a
 * completely ordinary candidate — no assignment, spare capacity, zero car buttons — so it's
 * picked up by this same logic exactly like any other idle elevator would be, and is in fact
 * exactly the kind of "genuinely idle, therefore always compatible" candidate isCompatible and
 * the idle-preference step below both favor.
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
    const compatibleCandidates = snapshot.elevators.filter(
      (elevator) =>
        !assignments.has(elevator.id) &&
        elevator.capacityRemaining > 0 &&
        isCompatible(elevator, call),
    );
    if (compatibleCandidates.length === 0) continue;

    const idleCandidates = compatibleCandidates.filter(
      (elevator) => elevator.carButtons.length === 0,
    );
    const candidates = idleCandidates.length > 0 ? idleCandidates : compatibleCandidates;

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

/**
 * The idle-vs-home decision, shared by both idle fallback points below. Returns `undefined` when
 * the caller should still be treated as "idle, no travel" (either below threshold, or already at
 * the home floor) -- the caller distinguishes those two ONLY to decide what DispatchAction to
 * emit; idleSince bookkeeping is identical either way.
 */
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
    idleSince.delete(elevator.id); // real action: no longer idle, clock resets
    return { type: 'stop', elevatorId: elevator.id }; // drop-off takes priority over a new pickup
  }

  const call = assignments.get(elevator.id)?.call;
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
    idleSince.delete(elevator.id); // real action: no longer idle, clock resets
    return { type: 'stop', elevatorId: elevator.id }; // pickup
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    // No real target: idle policy, with homing layered on top (see decideHoming above). idleSince
    // is deliberately NOT touched here beyond what decideHoming itself does -- a homing elevator
    // issuing 'travel' toward floor 0 is, from this algorithm's own perspective, indistinguishable
    // from any other idle-but-available elevator (see this file's header comment).
    return decideHoming(elevator, snapshot, idleSince);
  }
  idleSince.delete(elevator.id); // a real target was found: no longer idle, clock resets

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    // Unreachable by construction (target === currentFloor would already have matched one of
    // the stop checks above), kept only as a defensive, type-safe fallback.
    return { type: 'idle', elevatorId: elevator.id };
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'fcfs-nearest-car-homing',
  name: 'FCFS / Nearest Car (Returns to Lobby)',
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
