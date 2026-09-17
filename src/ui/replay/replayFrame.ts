// Pure per-elevator/hall-call "state at simulated time T" computation, reconstructed from a
// trial's SimEventLogEntry[] log rather than by replaying the simulation. See
// dev_log/07_results.md, "Replay animation mechanics: simulated-time clock with exact
// interpolation" -- in particular the "Correction" note, whose corrected pseudocode is the
// authoritative algorithm implemented by positionAtTime() below. No DOM.
//
// Performance (see dev_log/07_results.md, "Performance"): groupReplayLog() groups a trial's log
// by elevatorId / hall-call key ONCE per trial/algorithm selection change; computeReplayFrame()
// then does only O(log n) binary searches per elevator/hall-call per frame -- never a full scan
// of the log every frame.

import type { Direction, FloorIndex, SimEventLogEntry } from '../../engine';

export interface ElevatorReplayFrame {
  elevatorId: string;
  /** Interpolated floor position -- fractional while moving between two floors. */
  position: number;
  doorsOpen: boolean;
  onboardCount: number;
}

export interface HallCallReplayState {
  floor: FloorIndex;
  direction: Direction;
}

export interface ReplayFrame {
  time: number;
  elevators: ElevatorReplayFrame[];
  activeHallCalls: HallCallReplayState[];
}

interface TimedFloor {
  time: number;
  floor: FloorIndex;
}

interface Timed {
  time: number;
}

export interface ElevatorLogGroups {
  elevatorId: string;
  /** elevatorArrived entries, ascending by time (already time-ordered in the source log). */
  arrivals: TimedFloor[];
  doorsOpened: TimedFloor[];
  doorsClosed: TimedFloor[];
  boarded: Timed[];
  alighted: Timed[];
}

export interface HallCallLogGroup {
  floor: FloorIndex;
  direction: Direction;
  registered: Timed[];
  cleared: Timed[];
}

export interface GroupedLog {
  elevators: ElevatorLogGroups[];
  /** In order of each (floor, direction) pair's first appearance in the log -- mirrors the
   * engine's own activeHallCalls ordering guarantee (see engine/simulation.ts's
   * getActiveHallCalls), purely for stable, deterministic presentation. */
  hallCalls: HallCallLogGroup[];
}

function hallCallKey(floor: FloorIndex, direction: Direction): string {
  return `${floor}:${direction}`;
}

/**
 * Groups a trial's log by elevatorId (and by hall-call floor+direction), once, ahead of any
 * per-frame lookups. Each group's arrays stay in the source log's time order, since nothing here
 * reorders them -- required for countAtOrBefore's binary search to be valid.
 */
export function groupReplayLog(
  log: readonly SimEventLogEntry[],
  elevatorIds: readonly string[],
): GroupedLog {
  const elevatorMap = new Map<string, ElevatorLogGroups>();
  for (const id of elevatorIds) {
    elevatorMap.set(id, {
      elevatorId: id,
      arrivals: [],
      doorsOpened: [],
      doorsClosed: [],
      boarded: [],
      alighted: [],
    });
  }

  const hallCallMap = new Map<string, HallCallLogGroup>();
  const hallCallOrder: string[] = [];

  function hallCallGroup(floor: FloorIndex, direction: Direction): HallCallLogGroup {
    const key = hallCallKey(floor, direction);
    let group = hallCallMap.get(key);
    if (!group) {
      group = { floor, direction, registered: [], cleared: [] };
      hallCallMap.set(key, group);
      hallCallOrder.push(key);
    }
    return group;
  }

  for (const entry of log) {
    switch (entry.type) {
      case 'elevatorArrived':
        elevatorMap.get(entry.elevatorId)?.arrivals.push({ time: entry.time, floor: entry.floor });
        break;
      case 'doorsOpened':
        elevatorMap
          .get(entry.elevatorId)
          ?.doorsOpened.push({ time: entry.time, floor: entry.floor });
        break;
      case 'doorsClosed':
        elevatorMap
          .get(entry.elevatorId)
          ?.doorsClosed.push({ time: entry.time, floor: entry.floor });
        break;
      case 'passengerBoarded':
        elevatorMap.get(entry.elevatorId)?.boarded.push({ time: entry.time });
        break;
      case 'passengerAlighted':
        elevatorMap.get(entry.elevatorId)?.alighted.push({ time: entry.time });
        break;
      case 'hallCallRegistered':
        hallCallGroup(entry.floor, entry.direction).registered.push({ time: entry.time });
        break;
      case 'hallCallCleared':
        hallCallGroup(entry.floor, entry.direction).cleared.push({ time: entry.time });
        break;
    }
  }

  return {
    // Non-null: every id in elevatorIds was seeded into elevatorMap above.
    elevators: elevatorIds.map((id) => elevatorMap.get(id)!),
    hallCalls: hallCallOrder.map((key) => hallCallMap.get(key)!),
  };
}

/**
 * Binary-search primitive every other computation in this file reduces to: the count of `items`
 * (sorted ascending by `time`) with `time <= t` -- equivalently, the index of the first item with
 * `time > t`. O(log n).
 */
export function countAtOrBefore<T extends Timed>(items: readonly T[], t: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Corrected interpolation algorithm -- see dev_log/07_results.md's "Correction" note. Naively
 * interpolating linearly across the WHOLE span between two elevatorArrived entries is wrong
 * whenever the earlier one included a stop: doorsOpened is logged at the same timestamp as that
 * elevatorArrived, and the matching doorsClosed fires dwellMs later, so the true travel-start
 * time is doorsClosed's timestamp, not the earlier elevatorArrived's timestamp. Interpolating
 * across the full span (including the dwell) would show the elevator visibly creeping away from
 * the stop floor throughout the dwell, then creeping too slowly afterward.
 */
function positionAtTime(group: ElevatorLogGroups, time: number): number {
  const { arrivals, doorsOpened, doorsClosed } = group;

  const arrivalIndex = countAtOrBefore(arrivals, time) - 1;
  if (arrivalIndex < 0) return 0; // before this elevator's first log entry -- starts at floor 0
  const a = arrivals[arrivalIndex];
  if (arrivalIndex === arrivals.length - 1) return a.floor; // after the last entry -- fixed

  const b = arrivals[arrivalIndex + 1];

  // Did a stop happen exactly at T_A (this elevator's doorsOpened at the same timestamp)?
  const openIndex = countAtOrBefore(doorsOpened, a.time) - 1;
  const dwellOpen = openIndex >= 0 && doorsOpened[openIndex].time === a.time;

  let travelStart = a.time; // "passed straight through" default -- never stopped here
  if (dwellOpen) {
    const closeIndex = countAtOrBefore(doorsClosed, a.time); // first doorsClosed with time > T_A
    const dwellClose = closeIndex < doorsClosed.length ? doorsClosed[closeIndex] : undefined;
    if (dwellClose) {
      if (time < dwellClose.time) return a.floor; // still dwelling -- fixed, no interpolation
      travelStart = dwellClose.time; // motion resumes exactly here
    }
  }

  const span = b.time - travelStart;
  if (span <= 0) return a.floor; // degenerate timing guard -- not expected in practice
  const fraction = (time - travelStart) / span;
  return a.floor + fraction * (b.floor - a.floor);
}

function doorsOpenAtTime(group: ElevatorLogGroups, time: number): boolean {
  const openIndex = countAtOrBefore(group.doorsOpened, time) - 1;
  if (openIndex < 0) return false;
  const closeIndex = countAtOrBefore(group.doorsClosed, time) - 1;
  const openTime = group.doorsOpened[openIndex].time;
  const closeTime = closeIndex >= 0 ? group.doorsClosed[closeIndex].time : -Infinity;
  return openTime > closeTime;
}

function onboardCountAtTime(group: ElevatorLogGroups, time: number): number {
  return countAtOrBefore(group.boarded, time) - countAtOrBefore(group.alighted, time);
}

function hallCallActiveAtTime(group: HallCallLogGroup, time: number): boolean {
  return countAtOrBefore(group.registered, time) > countAtOrBefore(group.cleared, time);
}

/** Computes every elevator's and every hall call's displayed state at simulated time T. Pure --
 * the exact same function drives both normal playback (many small time steps) and scrubbing (one
 * large jump), so both are equally exact and drift-free. */
export function computeReplayFrame(grouped: GroupedLog, time: number): ReplayFrame {
  return {
    time,
    elevators: grouped.elevators.map((group) => ({
      elevatorId: group.elevatorId,
      position: positionAtTime(group, time),
      doorsOpen: doorsOpenAtTime(group, time),
      onboardCount: onboardCountAtTime(group, time),
    })),
    activeHallCalls: grouped.hallCalls
      .filter((group) => hallCallActiveAtTime(group, time))
      .map((group) => ({ floor: group.floor, direction: group.direction })),
  };
}
