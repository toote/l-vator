// Nearest-car dispatch with directional matching. See dev_log/03_algorithms.md, "Algorithm 3".
//
// Same assignment-map structure as fcfsNearestCar.ts, with one change to candidate eligibility:
// a moving elevator is only a valid candidate for a call if it's already heading that call's
// direction and hasn't yet passed the call's floor (an idle elevator is always eligible — no
// committed direction to conflict with). This fixes FCFS's most obvious flaw — it can send the
// geometrically nearest car even when that car is already moving away from the call — while
// staying directly comparable to it on identical scenarios, since both algorithms otherwise
// draw from the same "any state, no existing assignment, spare capacity" candidate pool. See
// algorithms.test.ts.
//
// Idle policy: stay put. This is this algorithm's own independent choice, made separately from
// the other two algorithms even though it lands on the same behavior (see the plan's "Open
// questions" resolution #1) — not factored out into shared code.

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
  // Already heading the right way, and hasn't already passed the call's floor.
  return call.direction === 'up'
    ? elevator.currentFloor <= call.floor
    : elevator.currentFloor >= call.floor;
}

/**
 * Drops assignments whose call is no longer active, then assigns each still-unassigned active
 * call to the nearest still-unassigned, compatible elevator — excluding, within this same pass,
 * any elevator already claimed for an earlier call in the loop (see dev_log/03_algorithms.md,
 * "Multiple simultaneous unassigned calls in one invocation").
 */
function refreshAssignments(snapshot: DispatchSnapshot, assignments: Map<string, HallCall>): void {
  const activeKeys = new Set(snapshot.activeHallCalls.map(callKey));
  for (const [elevatorId, call] of assignments) {
    if (!activeKeys.has(callKey(call))) {
      assignments.delete(elevatorId);
    }
  }

  const assignedCallKeys = new Set(Array.from(assignments.values()).map(callKey));
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    const candidates = snapshot.elevators.filter(
      (elevator) =>
        !assignments.has(elevator.id) &&
        elevator.capacityRemaining > 0 &&
        isCompatible(elevator, call),
    );
    if (candidates.length === 0) continue; // no compatible car this round; retried next decision

    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (distance(candidate.currentFloor, call.floor) < distance(best.currentFloor, call.floor)) {
        best = candidate;
      }
    }
    assignments.set(best.id, call);
  }
}

function decide(elevator: ElevatorSnapshot, assignments: Map<string, HallCall>): DispatchAction {
  if (elevator.carButtons.includes(elevator.currentFloor)) {
    return { type: 'stop', elevatorId: elevator.id }; // drop-off takes priority over a new pickup
  }

  const call = assignments.get(elevator.id);
  if (call && call.floor === elevator.currentFloor) {
    return { type: 'stop', elevatorId: elevator.id }; // pickup
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    return { type: 'idle', elevatorId: elevator.id }; // idle policy: stay put
  }

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    // Unreachable by construction (target === currentFloor would already have matched one of
    // the stop checks above), kept only as a defensive, type-safe fallback.
    return { type: 'idle', elevatorId: elevator.id };
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'nearest-car-directional',
  name: 'Nearest Car (Directional)',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, HallCall>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
