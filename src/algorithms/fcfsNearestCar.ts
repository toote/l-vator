// FCFS / naive nearest-car dispatch algorithm. See dev_log/03_algorithms.md, "Algorithm 1".
//
// Assigns each active hall call to the nearest still-unassigned elevator with spare capacity,
// in ANY movement state — idle or already moving, regardless of direction. That's what makes it
// "naive": it will happily send a car that's already heading away from the call if that car
// happens to be geometrically closest right now. (An earlier version of this file restricted
// candidates to idle-only elevators, which was a bug, not a simplification — see the plan's
// "Correction" note under Algorithm 1 for why that silently defeated the whole point of
// contrasting this algorithm with nearestCarDirectional.ts.)
//
// Remembered across invocations via an assignments map held in the hook's closure —
// DispatchSnapshot itself carries no "already assigned" field (see the plan's "structural
// constraint from the engine" section for why that memory has to live here).
//
// Idle policy: stay put. This is this algorithm's own independent choice (see the plan's
// "Open questions" resolution #1) — not shared engine logic, and not factored out anywhere,
// since each algorithm in this unit makes the same choice separately.

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

/**
 * Drops assignments whose call is no longer active, then assigns each still-unassigned active
 * call to the nearest still-unassigned, available elevator — excluding, within this same pass,
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
  // Order = snapshot.activeHallCalls's own order — a guaranteed contract of the engine (see
  // src/engine/dispatch.ts) — which is what makes this "first come, first served".
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    // Deliberately NOT filtered by state or direction — "naive" means any elevator without an
    // existing assignment and with spare capacity is a candidate, even one already moving away
    // from this call's floor.
    const candidates = snapshot.elevators.filter(
      (elevator) => !assignments.has(elevator.id) && elevator.capacityRemaining > 0,
    );
    if (candidates.length === 0) continue; // no car free this round; retried next decision point

    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (distance(candidate.currentFloor, call.floor) < distance(best.currentFloor, call.floor)) {
        best = candidate;
      }
    }
    // `best` is now in `assignments`, so it's excluded from `candidates` on the next iteration
    // of this same loop pass.
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
  id: 'fcfs-nearest-car',
  name: 'FCFS / Nearest Car',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, HallCall>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
