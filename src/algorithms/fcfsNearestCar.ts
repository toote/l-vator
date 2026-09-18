// FCFS / naive nearest-car dispatch algorithm. See dev_log/03_algorithms.md, "Algorithm 1".
//
// Assigns each active hall call to the nearest still-unassigned, capacity-available, COMPATIBLE
// elevator (see isCompatible below) — nearest-by-distance and lowest-id-on-a-tie are what remain
// "naive" here, not direction-blindness (see the "Direction compatibility" amendment in
// dev_log/03_algorithms_done.md for why an earlier, fully direction-blind version of this file
// was a real bug, not a simplification: developer-reported, an elevator carrying 8 passengers
// with 8 different destinations could get assigned a call behind it the moment it dropped
// someone off, before ever actually reversing to serve it — the fix below is what prevents that).
//
// (An even earlier version of this file restricted candidates to idle-only elevators, which was
// ALSO a bug, not a simplification — see the plan's original "Correction" note under Algorithm 1
// for why that silently defeated the whole point of contrasting this algorithm with
// nearestCarDirectional.ts. That history is why this file now duplicates nearestCarDirectional.ts's
// isCompatible logic almost exactly, rather than the two algorithms remaining structurally
// distinct in this respect — see isCompatible's own doc comment for the one deliberate difference
// that's left between them.)
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
 * Developer-reported bug fix: an elevator with onboard passengers (`carButtons` non-empty) is
 * only a compatible candidate for a NEW call if that call continues the elevator's current
 * direction and hasn't already been passed — the same rule nearestCarDirectional.ts's own
 * `isCompatible` enforces, and for the same reason: once a passenger has pressed a button, this
 * algorithm won't reverse course to answer a call outside that commitment.
 *
 * The one deliberate difference from nearestCarDirectional.ts's version: the escape hatch here is
 * `carButtons.length === 0` (genuinely nobody onboard), not `elevator.state === 'idle'`. An
 * elevator that's already `moving` toward an EARLIER assignment but has nobody onboard yet (e.g.
 * it just delivered its last passenger and immediately picked up a new pickup assignment) has no
 * actual passenger commitment to protect — redirecting it costs nothing. nearestCarDirectional.ts
 * is more conservative here (it respects even an empty car's in-progress trip); this is the one
 * remaining place this file's own "naive" character survives the fix, rather than becoming
 * byte-for-byte identical to directional matching in every case.
 */
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
 * `assignedAt` backs a second, independent release path (see refreshAssignments' "unvisited
 * timeout" note) — an assignment can also go stale WITHOUT ever being visited at all, if the
 * elevator picks up other obligations along the way that `decide()` always prioritizes over
 * actually traveling to this call floor.
 */
interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

/**
 * How many floor-crossings' worth of time an assignment may sit unvisited before it's released
 * back to the pool regardless of `hasVisited` — see refreshAssignments' "unvisited timeout" note.
 * Deliberately generous (allows a handful of unrelated drop-offs along the way) rather than tight,
 * since this is a last-resort safety net, not the primary defense (candidate selection already
 * prefers a genuinely idle elevator when one exists — see refreshAssignments' "prefer idle"
 * note). Scaled by `floorTravelTimeMs` rather than a fixed ms constant so it stays meaningful
 * across very different building configurations, and deliberately NOT scaled by `floorCount`
 * (not available on `DispatchSnapshot`) — a simple, bounded heuristic, not a precise one.
 */
const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Drops assignments whose call is no longer active, releases an assignment once its elevator has
 * visited the call's floor and since left while the call is STILL active (overflow — capacity ran
 * out before everyone waiting could board), then assigns each now-unassigned active call to the
 * nearest still-unassigned, available elevator — excluding, within this same pass, any elevator
 * already claimed for an earlier call in the loop (see dev_log/03_algorithms.md, "Multiple
 * simultaneous unassigned calls in one invocation").
 *
 * The release step is what lets a second elevator help with a call one elevator can't clear alone
 * (see dev_log/03_algorithms_done.md's amendment for the full "why" — without it, an assignment
 * was permanent for as long as the call stayed active, so an elevator that already left to deliver
 * its current load stayed "assigned" to a floor it had no way to help again anytime soon, while
 * every other elevator sat idle, structurally excluded from that same call).
 *
 * Unvisited timeout (developer-reported, real bug, second amendment): the release above only
 * fires once an elevator has ACTUALLY visited the call floor and since left. An elevator can also
 * be assigned to a call it never gets around to visiting at all — `decide()`'s target logic
 * (`nearestFloor(carButtons, ...) ?? call?.floor`) always prioritizes an existing onboard
 * passenger's drop-off over an assigned-but-not-yet-reached pickup, unconditionally. So an
 * elevator that picks up a NEW assignment while it still has other obligations can end up
 * wandering away from that assignment indefinitely, `hasVisited` staying false forever, holding
 * the call hostage while every other, genuinely idle elevator sits unused (confirmed live: an
 * elevator held a floor-0 pickup assignment for 30+ seconds while visibly delivering passengers
 * up through floors 2 through 8, never once returning to floor 0). Fixed two ways: candidate
 * selection below now prefers a genuinely idle elevator when one exists (closes the common case
 * for free), and any assignment still unvisited after `UNVISITED_RELEASE_FLOOR_MULTIPLIER *
 * floorTravelTimeMs` is released regardless of `hasVisited`, as a bounded worst-case safety net.
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
      // Visited, and has since left, but the call is still active: release it — this elevator
      // already got its chance here and is now busy elsewhere; let the next assignment pass
      // (below, same invocation) consider every elevator fresh, including this one if it's still
      // nearest, or another one if it isn't.
      assignments.delete(elevatorId);
    } else if (snapshot.time - assignment.assignedAt >= unvisitedTimeoutMs) {
      // Never visited at all, and it's been too long — see this function's "Unvisited timeout"
      // note above. Released the same way, for the same reason: this elevator isn't realistically
      // going to get to it soon, so let someone else try.
      assignments.delete(elevatorId);
    }
  }

  const assignedCallKeys = new Set(Array.from(assignments.values()).map((a) => callKey(a.call)));
  // Order = snapshot.activeHallCalls's own order — a guaranteed contract of the engine (see
  // src/engine/dispatch.ts) — which is what makes this "first come, first served".
  const unassignedCalls = snapshot.activeHallCalls.filter(
    (call) => !assignedCallKeys.has(callKey(call)),
  );

  for (const call of unassignedCalls) {
    // Compatible (see isCompatible above), unassigned, with spare capacity — NOT filtered by
    // engine `state` the way nearestCarDirectional.ts's candidate filter is (see isCompatible's
    // own doc comment for why: an empty-but-moving elevator here is still a candidate for
    // anything, since it has no onboard passenger commitment to protect).
    const compatibleCandidates = snapshot.elevators.filter(
      (elevator) =>
        !assignments.has(elevator.id) &&
        elevator.capacityRemaining > 0 &&
        isCompatible(elevator, call),
    );
    if (compatibleCandidates.length === 0) continue; // no compatible car this round; retried next decision point

    // Prefer idle candidates: see this function's "Unvisited timeout" note. Any elevator with
    // ZERO onboard passengers has nothing that would ever take priority over honoring this
    // assignment once it's made, so it's the safer pick whenever one is available — falling back
    // to any compatible candidate (a "naive" pick by distance alone) only when none are fully
    // idle. (Every fully-idle elevator is automatically compatible per isCompatible above, so this
    // is purely a preference among the already-compatible pool, not a second filter.)
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
    // `best` is now in `assignments`, so it's excluded from `candidates` on the next iteration
    // of this same loop pass.
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
  // Only stop for the assigned pickup while there's actually room — a full elevator has nothing
  // to gain by reopening its doors here again, and unconditionally doing so would strand it at
  // this floor forever (it would never issue 'travel' to go deliver what it's already carrying,
  // and refreshAssignments' release-on-departure above would then never get a chance to run,
  // since the elevator would never actually leave). See dev_log/03_algorithms_done.md's amendment.
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
  id: 'fcfs-nearest-car',
  name: 'FCFS / Nearest Car',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
