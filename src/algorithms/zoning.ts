// Zone-restricted nearest-car dispatch. See dev_log/11_algorithm_expansion.md, "New algorithm 1:
// Zoning".
//
// Floors 1..floorCount are divided into elevatorCount contiguous, roughly-equal zones, one per
// elevator (by its position in snapshot.elevators). Floor 0 (the lobby) is unzoned -- every
// elevator is eligible for it, since virtually every arrival pattern in this project centers on
// floor 0 traffic, and a strict partition that excluded most elevators from the lobby would make
// zoning look artificially broken on the project's own default scenarios rather than showing its
// real, honest tradeoff. Deliberately ignores direction entirely (unlike
// nearestCarDirectional.ts) -- zoning isolates ONE new variable (spatial partitioning) for clean
// comparison, not combined with the direction question already covered elsewhere.
//
// This is the STRICT variant: if every zone-eligible candidate is full/assigned, the call simply
// stays unassigned (retried next decision point) even while an out-of-zone elevator sits idle --
// the real, honest tradeoff zoning exists to show. See zoningFallback.ts for the softened variant
// that falls back to any available elevator instead.
//
// Same assignment-map/hasVisited/unvisited-timeout structure as nearestCarDirectional.ts, reused
// for consistency (this project's established per-file-duplication convention, not a shared
// module). Drop-offs (carButtons) are always honored regardless of zone -- a boarded passenger's
// destination is unknown at pickup time (this project's presence-only call model), so an elevator
// may legitimately need to deliver outside its own zone; zoning only restricts which NEW pickups
// it will accept, never abandons a passenger already aboard.

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

/** A contiguous floor range, inclusive. `min > max` denotes an empty zone (more elevators than
 * floors to zone) -- valid, meaning that elevator is only ever eligible for floor 0. */
export interface Zone {
  min: FloorIndex;
  max: FloorIndex;
}

/**
 * Divides floors 1..floorCount into elevatorCount contiguous ranges, as evenly as possible: a
 * remainder floor count `r` means the first `r` zones get one extra floor, not a big remainder
 * dumped on the last zone. Pure and independent of any particular snapshot, so a fresh call per
 * decision (or per test) always agrees.
 */
export function zoneFor(elevatorIndex: number, elevatorCount: number, floorCount: number): Zone {
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
  if (call.floor === 0) return true; // lobby: unzoned, every elevator eligible
  return call.floor >= zone.min && call.floor <= zone.max;
}

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

/** See nearestCarDirectional.ts's identical shape for the full rationale. */
interface Assignment {
  call: HallCall;
  hasVisited: boolean;
  assignedAt: number;
}

/** See nearestCarDirectional.ts's identical constant for the full rationale. */
const UNVISITED_RELEASE_FLOOR_MULTIPLIER = 8;

/**
 * Identical structure to nearestCarDirectional.ts's refreshAssignments (including the unvisited-
 * timeout fix), with eligibility keyed by zone membership instead of direction compatibility. The
 * strict variant: an unassignable call (every zone-eligible candidate full or already claimed)
 * is simply skipped -- left unassigned for the next decision point, never falls back out of zone.
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
    const candidates = snapshot.elevators.filter(
      (elevator, index) =>
        !assignments.has(elevator.id) &&
        elevator.capacityRemaining > 0 &&
        isZoneEligible(zones[index]!, call),
    );
    if (candidates.length === 0) continue; // strict: no cross-zone fallback

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
  if (call && call.floor === elevator.currentFloor && elevator.capacityRemaining > 0) {
    return { type: 'stop', elevatorId: elevator.id }; // pickup
  }

  const target = nearestFloor(elevator.carButtons, elevator.currentFloor) ?? call?.floor;
  if (target === undefined) {
    return { type: 'idle', elevatorId: elevator.id }; // idle policy: stay put
  }

  const direction = directionFrom(elevator.currentFloor, target);
  if (direction === null) {
    return { type: 'idle', elevatorId: elevator.id }; // unreachable by construction
  }
  return { type: 'travel', elevatorId: elevator.id, direction };
}

export const algorithm: Algorithm = {
  id: 'zoning',
  name: 'Zoning',
  description:
    'Divides the building into one contiguous floor zone per elevator (the lobby is shared by ' +
    'all), and only assigns a new pickup to an elevator whose zone covers that floor. Ignores ' +
    'direction entirely. Strict: if every elevator eligible for a call is full, the call waits ' +
    'for its own zone, even if an elevator from another zone sits idle.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
