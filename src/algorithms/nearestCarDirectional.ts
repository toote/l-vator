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
 * An assignment plus whether the assigned elevator has ever actually reached the call's floor.
 * `hasVisited` is what makes an overflow assignment releasable (see refreshAssignments) without
 * also releasing an elevator that's merely still travelling toward a call it hasn't reached yet.
 *
 * `assignedAt` backs a second, independent release path — see refreshAssignments' "unvisited
 * timeout" note, and fcfsNearestCar.ts's identical fix for the full rationale.
 */
interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

/** See fcfsNearestCar.ts's identical constant for the full rationale. */
const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Drops assignments whose call is no longer active, releases an assignment once its elevator has
 * visited the call's floor and since left while the call is STILL active (overflow — capacity ran
 * out before everyone waiting could board), then assigns each now-unassigned active call to the
 * nearest still-unassigned, compatible elevator — excluding, within this same pass, any elevator
 * already claimed for an earlier call in the loop (see dev_log/03_algorithms.md, "Multiple
 * simultaneous unassigned calls in one invocation").
 *
 * The release step is what lets a second elevator help with a call one elevator can't clear alone
 * (see dev_log/03_algorithms_done.md's amendment for the full "why").
 *
 * Unvisited timeout: see fcfsNearestCar.ts's identical fix and its "Unvisited timeout" doc
 * comment for the full rationale — an elevator assigned to a call it never actually visits (its
 * own onboard drop-offs always take priority in `decide()`) can hold that call hostage forever,
 * since `hasVisited` never flips without literally reaching the floor. Fixed the same way here:
 * candidate selection prefers a genuinely idle, compatible elevator when one exists, and any
 * assignment unvisited past the timeout is released regardless of `hasVisited`.
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
      // Visited, and has since left, but the call is still active: release it, so a compatible
      // elevator (possibly this one again, possibly another) is reconsidered fresh below.
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
    if (allCandidates.length === 0) continue; // no compatible car this round; retried next decision

    // Prefer idle candidates — see this function's "Unvisited timeout" note.
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

function decide(elevator: ElevatorSnapshot, assignments: Map<string, Assignment>): DispatchAction {
  if (elevator.carButtons.includes(elevator.currentFloor)) {
    return { type: 'stop', elevatorId: elevator.id }; // drop-off takes priority over a new pickup
  }

  const call = assignments.get(elevator.id)?.call;
  // Only stop for the assigned pickup while there's actually room — see fcfsNearestCar.ts's
  // identical comment and dev_log/03_algorithms_done.md's amendment for why this is required for
  // the release-on-departure logic above to ever get a chance to run.
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
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
  description:
    'Like FCFS/Nearest Car, but stricter about direction: any elevator that is not genuinely ' +
    'idle — including one that is empty but already committed to an earlier pickup — is only a ' +
    'candidate if it is heading toward the call and has not passed it yet. Avoids the wasted ' +
    'detours FCFS can make, sometimes at the cost of leaving a call waiting slightly longer for ' +
    'a compatible car to become available.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
