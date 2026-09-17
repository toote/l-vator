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

  if (elevator.direction === null) {
    // Was idle: pick a direction toward the nearest pending floor (any car button or active
    // call — direction of the call itself doesn't matter yet, since nothing is committed).
    const pending = new Set<FloorIndex>(elevator.carButtons);
    for (const call of snapshot.activeHallCalls) pending.add(call.floor);

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
  for (const call of snapshot.activeHallCalls) {
    if (call.direction === direction) pending.add(call.floor);
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
