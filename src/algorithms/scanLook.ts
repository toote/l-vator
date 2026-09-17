// SCAN/LOOK dispatch algorithm. See dev_log/03_algorithms.md, "Algorithm 2".
//
// No assignment map, no cross-elevator coordination: each car independently sweeps in its own
// committed direction and services whatever's in its path. Stateless — createHook() returns a
// plain function with no closure state, since elevator.direction (tracked by the engine itself)
// already serves as the implicit "which way am I sweeping" signal.
//
// Idle policy: stay put. This is this algorithm's own independent choice, made separately from
// the other two algorithms even though it lands on the same behavior (see the plan's "Open
// questions" resolution #1) — not factored out into shared code.

import type {
  DispatchAction,
  DispatchHook,
  DispatchSnapshot,
  Direction,
  ElevatorSnapshot,
  FloorIndex,
} from '../engine';
import { directionFrom, distance } from './shared';
import type { Algorithm } from './types';

function opposite(direction: Direction): Direction {
  return direction === 'up' ? 'down' : 'up';
}

/** The entry of `floors` nearest to `from`; ties keep the first (stable iteration order). */
function closestFloor(floors: ReadonlySet<FloorIndex>, from: FloorIndex): FloorIndex | undefined {
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

function decide(snapshot: DispatchSnapshot, elevator: ElevatorSnapshot): DispatchAction {
  const currentFloor = elevator.currentFloor;
  // A full elevator has nothing to gain by pursuing a PICKUP: it would board nobody, produce a
  // zero-transaction dwell, and re-issue the identical decision forever, since nothing about its
  // state (still full, call still active because nobody could board it) ever changes to break the
  // cycle. A DROP-OFF is always worth pursuing regardless of capacity -- it's what frees capacity.
  // So `pending` below only ever includes active-call floors when there's room to spare; car
  // buttons (drop-offs) are included unconditionally. This must happen at `pending`'s construction,
  // not just as an extra check on the final 'stop' decision -- excluding a call floor here also
  // correctly keeps it out of the nearest/ahead/behind routing searches, so a full elevator
  // doesn't get stuck treating an unreachable pickup as its nearest/only target instead of routing
  // toward an actual drop-off elsewhere. See dev_log/00_main.md's amendment history for the full
  // story (same bug class already fixed in fcfsNearestCar.ts/nearestCarDirectional.ts).
  const hasCapacity = elevator.capacityRemaining > 0;

  if (elevator.direction === null) {
    // Was idle: pick a direction toward the nearest pending floor (any car button, or an active
    // call if there's room — direction of the call itself doesn't matter yet, nothing committed).
    const pending = new Set<FloorIndex>(elevator.carButtons);
    if (hasCapacity) {
      for (const call of snapshot.activeHallCalls) pending.add(call.floor);
    }

    if (pending.has(currentFloor)) {
      return { type: 'stop', elevatorId: elevator.id };
    }
    const nearest = closestFloor(pending, currentFloor);
    if (nearest === undefined) {
      return { type: 'idle', elevatorId: elevator.id }; // idle policy: stay put
    }
    const direction = directionFrom(currentFloor, nearest);
    if (direction === null) {
      // Unreachable by construction (nearest === currentFloor would already have matched the
      // check above), kept only as a defensive, type-safe fallback.
      return { type: 'idle', elevatorId: elevator.id };
    }
    return { type: 'travel', elevatorId: elevator.id, direction };
  }

  // Committed direction: only calls matching it count as "in path" for stop/continue purposes —
  // opposite-direction calls are served on the return sweep, not now (this IS the LOOK behavior).
  const direction = elevator.direction;
  const pending = new Set<FloorIndex>(elevator.carButtons);
  if (hasCapacity) {
    for (const call of snapshot.activeHallCalls) {
      if (call.direction === direction) pending.add(call.floor);
    }
  }

  if (pending.has(currentFloor)) {
    return { type: 'stop', elevatorId: elevator.id };
  }

  const isAhead = (floor: FloorIndex): boolean =>
    direction === 'up' ? floor > currentFloor : floor < currentFloor;
  const isBehind = (floor: FloorIndex): boolean =>
    direction === 'up' ? floor < currentFloor : floor > currentFloor;

  if (Array.from(pending).some(isAhead)) {
    return { type: 'travel', elevatorId: elevator.id, direction }; // keep sweeping this way
  }

  if (Array.from(pending).some(isBehind)) {
    // Nothing further ahead, something behind: reverse. `elevator.direction` flips at the
    // engine level before the next decision point, so the following invocation recomputes
    // `pending` using the new direction automatically — no extra state needed here.
    return { type: 'travel', elevatorId: elevator.id, direction: opposite(direction) };
  }

  return { type: 'idle', elevatorId: elevator.id }; // idle policy: stay put
}

export const algorithm: Algorithm = {
  id: 'scan-look',
  name: 'SCAN / LOOK',
  createHook: (): DispatchHook => {
    return (snapshot: DispatchSnapshot): DispatchAction[] =>
      snapshot.elevators.map((elevator) => decide(snapshot, elevator));
  },
};
