// SCAN/LOOK, with a "returns to the lobby after sitting idle too long" homing policy layered on
// top. See dev_log/10_homing_algorithms.md.
//
// Mirrors scanLook.ts's sweep logic exactly (deliberately duplicated, not shared -- see
// dev_log/10_homing_algorithms.md's "Duplication vs. sharing"). The base scanLook.ts itself is
// completely untouched by this unit.
//
// Unlike the other two homing variants, this hook is no longer stateless: it needs the same
// per-elevator `idleSince` closure map (see fcfsNearestCarHoming.ts's header comment for the full
// homing rationale). scanLook.ts has TWO idle fallback points -- the idle-direction branch (no
// pending floor at all) and the committed-direction branch's final fallback (nothing ahead or
// behind) -- both wired to the SAME idleSince map, keyed by elevator id, so the clock survives a
// reversal or a direction-branch switch mid-idle-stretch.
//
// One structural wrinkle worth calling out (not a bug -- confirmed correct, see
// dev_log/10_homing_algorithms.md's AI Interactions): once a homing 'travel' action is issued,
// the ENGINE sets elevator.direction to 'down' before the next decision point (handleTravel in
// simulation.ts) -- so, unlike fcfsNearestCar/nearestCarDirectional (which never branch on
// elevator.direction at all), the very next invocation here lands in the COMMITTED-direction
// branch, not the idle-direction branch. That's fine: pending is rebuilt for direction 'down',
// and if nothing new matches, the committed branch's own idle fallback re-fires the same homing
// check via the same idleSince entry, continuing the descent one floor at a time. It also means a
// homing elevator naturally picks up any real 'down' call in its path exactly like an ordinary
// committed sweep would -- no special preemption logic needed, per the plan.

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

const HOME_FLOOR: FloorIndex = 0;

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

/** See fcfsNearestCarHoming.ts's identical helper for the full rationale. Shared by both of this
 * file's idle fallback points, keyed by the same idleSince map. */
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
  snapshot: DispatchSnapshot,
  elevator: ElevatorSnapshot,
  idleSince: Map<string, number>,
): DispatchAction {
  const currentFloor = elevator.currentFloor;
  const hasCapacity = elevator.capacityRemaining > 0;

  if (elevator.direction === null) {
    const pending = new Set<FloorIndex>(elevator.carButtons);
    if (hasCapacity) {
      for (const call of snapshot.activeHallCalls) pending.add(call.floor);
    }

    if (pending.has(currentFloor)) {
      idleSince.delete(elevator.id); // real action: no longer idle, clock resets
      return { type: 'stop', elevatorId: elevator.id };
    }
    const nearest = closestFloor(pending, currentFloor);
    if (nearest === undefined) {
      // Idle fallback #1: nothing pending anywhere. Homing check (see decideHoming above);
      // idleSince is otherwise left untouched -- a homing 'travel' issued from here is, from this
      // algorithm's own perspective, indistinguishable from any other idle-but-available elevator.
      return decideHoming(elevator, snapshot, idleSince);
    }
    const direction = directionFrom(currentFloor, nearest);
    if (direction === null) {
      // Unreachable by construction (nearest === currentFloor would already have matched the
      // check above), kept only as a defensive, type-safe fallback.
      return { type: 'idle', elevatorId: elevator.id };
    }
    idleSince.delete(elevator.id); // a real target was found: no longer idle, clock resets
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
    idleSince.delete(elevator.id);
    return { type: 'stop', elevatorId: elevator.id };
  }

  const isAhead = (floor: FloorIndex): boolean =>
    direction === 'up' ? floor > currentFloor : floor < currentFloor;
  const isBehind = (floor: FloorIndex): boolean =>
    direction === 'up' ? floor < currentFloor : floor > currentFloor;

  if (Array.from(pending).some(isAhead)) {
    idleSince.delete(elevator.id);
    return { type: 'travel', elevatorId: elevator.id, direction }; // keep sweeping this way
  }

  if (Array.from(pending).some(isBehind)) {
    idleSince.delete(elevator.id);
    // Nothing further ahead, something behind: reverse. `elevator.direction` flips at the
    // engine level before the next decision point, so the following invocation recomputes
    // `pending` using the new direction automatically — no extra state needed here.
    return { type: 'travel', elevatorId: elevator.id, direction: opposite(direction) };
  }

  // Idle fallback #2: nothing ahead or behind in the committed direction. Same idleSince map as
  // fallback #1 above -- a reversal or a direction-branch switch mid-idle-stretch does not reset
  // the clock, since neither branch ever touches idleSince except via decideHoming/the real-action
  // clears above.
  return decideHoming(elevator, snapshot, idleSince);
}

export const algorithm: Algorithm = {
  id: 'scan-look-homing',
  name: 'SCAN / LOOK (Returns to Lobby)',
  description:
    'The SCAN / LOOK strategy, plus one addition: an elevator that sits idle longer than the ' +
    'configured idle return threshold heads back to floor 0 on its own, instead of waiting ' +
    'wherever its sweep last ended — keeps the fleet positioned closer to where demand usually ' +
    'originates, so a returning car does not have to be summoned from wherever it last stopped.',
  createHook: (): DispatchHook => {
    const idleSince = new Map<string, number>();
    return (snapshot: DispatchSnapshot): DispatchAction[] =>
      snapshot.elevators.map((elevator) => decide(snapshot, elevator, idleSince));
  },
};
