// Random dispatch: a deliberately "dumbest possible" baseline. See
// dev_log/11_algorithm_expansion.md, "New algorithm 3: Random dispatch".
//
// Among capacity-available, unassigned candidates for a call -- no direction/zone/ETA filter at
// all -- picks uniformly at random. The point is to show whether FCFS-style naivety (ignoring
// direction entirely) was actually the worst available choice, or whether it beat something even
// simpler.
//
// "Random" here is a fully deterministic, reproducible pseudo-random choice derived from data
// already on the snapshot -- NOT Math.random(). Every other algorithm is either deterministic-by-
// construction (distance/ETA comparisons) or stateless, so this project's seeded-reproducibility
// guarantee (00_main.md: "same seed sequence reused across every algorithm... so metric
// differences reflect the algorithm, not random variance") was never at risk before. A real
// Math.random() here would silently break that guarantee for this one algorithm -- two runs of
// the same seed would disagree, and comparisons against this algorithm specifically would stop
// being apples-to-apples. `createRng` lives in src/engine/rng.ts (relocated there in this same
// unit specifically so this file can use it without a circular module dependency -- see
// dev_log/11_algorithm_expansion.md's "Random dispatch" section).
//
// Same assignment-map/hasVisited/unvisited-timeout structure as nearestCarDirectional.ts, reused
// for consistency (this project's established per-file-duplication convention, not a shared
// module) -- still avoids thrashing/reassignment loops even though the initial pick is random.

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

/**
 * A deterministic index in `[0, candidateCount)`, derived from the snapshot's own time plus the
 * call's own floor/direction. `time` alone would repeat the same pick for multiple simultaneous
 * calls at the same tick; XOR-ing in the call's floor/direction disambiguates them. Reproducible
 * because `snapshot.time` is itself fully determined by the seeded event log -- same input seed,
 * same sequence of `snapshot.time` values, same "random" picks, every run.
 */
export function pseudoRandomIndex(time: number, call: HallCall, candidateCount: number): number {
  const seed =
    (Math.floor(time * 1000) ^ (call.floor * 2654435761) ^ (call.direction === 'up' ? 1 : 0)) >>> 0;
  return Math.floor(createRng(seed).next() * candidateCount);
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
 * Identical structure to nearestCarDirectional.ts's refreshAssignments, except candidate
 * selection has no compatibility filter (every capacity-available, unclaimed elevator is
 * eligible) and picks uniformly at random via pseudoRandomIndex instead of by distance/ETA.
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
  id: 'random-dispatch',
  name: 'Random',
  description:
    'Among every capacity-available elevator, picks one uniformly at random to answer each ' +
    'call -- no direction, distance, or zone preference at all. A deterministic, seed-' +
    'reproducible "random" (not Math.random()), so it stays fair to compare against every other ' +
    'algorithm on the same seed. Exists as the deliberately dumbest possible baseline.',
  createHook: (): DispatchHook => {
    const assignments = new Map<string, Assignment>();
    return (snapshot: DispatchSnapshot): DispatchAction[] => {
      refreshAssignments(snapshot, assignments);
      return snapshot.elevators.map((elevator) => decide(elevator, assignments));
    };
  },
};
