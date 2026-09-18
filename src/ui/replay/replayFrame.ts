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

/**
 * What an elevator is doing at a given simulated time, for display purposes -- distinct from
 * `doorsOpen`/`position` alone, which don't by themselves distinguish "idle, nothing to do" from
 * "idle, dwelling with doors open" from "actively traveling toward a specific floor". Reconstructed
 * from the same arrival/door log data `positionAtTime` uses, not a new engine concept: the
 * simulation's event log has no explicit "elevator became idle" event (see `statusAtTime`'s doc
 * comment for how this is inferred).
 */
export type ElevatorStatus =
  { type: 'idle' } | { type: 'doorsOpen' } | { type: 'traveling'; targetFloor: FloorIndex };

export interface ElevatorReplayFrame {
  elevatorId: string;
  /** Interpolated floor position -- fractional while moving between two floors. */
  position: number;
  doorsOpen: boolean;
  onboardCount: number;
  status: ElevatorStatus;
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
  /** The building's configured per-floor travel duration -- see positionAtTime's "Idle-then-
   * recalled" amendment for why this (not door events) is what anchors travel-start time. */
  floorTravelTimeMs: number;
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
  floorTravelTimeMs: number,
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
    floorTravelTimeMs,
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

/** Same as countAtOrBefore, but strictly before `t` -- excludes an entry whose time equals `t`.
 * Used by onboardCountAtTime to find the count just BEFORE a stop's own boarding/alighting,
 * which all share the stop's start timestamp (see that function's doc comment). */
function countStrictlyBefore<T extends Timed>(items: readonly T[], t: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Corrected interpolation algorithm -- see dev_log/07_results.md's "Correction" note, and
 * dev_log/07_results_done.md's "Idle-then-recalled" amendment for a second correction on top of
 * it. Naively interpolating linearly across the WHOLE span between two elevatorArrived
 * entries is wrong whenever the elevator paused before b -- whether dwelling with doors open at
 * a stop, or sitting idle and unassigned for a stretch before finally being recalled to serve a
 * still-active call elsewhere. Either way, the elevator isn't moving, so it should render fixed
 * at `a.floor`, not creeping toward `b.floor`.
 *
 * Rather than detecting every possible reason for a pause (the original version only checked for
 * a door-dwell at T_A, missing the idle-then-recalled case entirely -- an unassigned elevator can
 * sit for an arbitrary stretch with no door event at all before it's finally dispatched), this
 * works backward from something always true regardless of *why* the elevator paused: a
 * floor-to-floor move always takes exactly `floorTravelTimeMs`, so motion toward `b` cannot have
 * started before `b.time - floorTravelTimeMs`. Everything before that instant -- dwelling, idle,
 * or both in sequence -- is fixed at `a.floor`.
 */
function positionAtTime(group: ElevatorLogGroups, time: number, floorTravelTimeMs: number): number {
  const { arrivals } = group;

  const arrivalIndex = countAtOrBefore(arrivals, time) - 1;
  if (arrivalIndex < 0) return 0; // before this elevator's first log entry -- starts at floor 0
  const a = arrivals[arrivalIndex];
  if (arrivalIndex === arrivals.length - 1) return a.floor; // after the last entry -- fixed

  const b = arrivals[arrivalIndex + 1];

  const travelStart = b.time - floorTravelTimeMs;
  if (time < travelStart) return a.floor; // still parked at A -- dwelling, idle, or both
  const fraction = (time - travelStart) / floorTravelTimeMs;
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

/**
 * Developer-reported: watching 8 passengers board at once, the onboard count jumped to 8
 * instantly even though the doors stayed open for a further several seconds of dwell. That's an
 * accurate reflection of the simulation data as logged -- every passenger who boards (or
 * alights) at a stop shares the exact same `passengerBoarded`/`passengerAlighted` timestamp (the
 * stop's start; see door.ts's aggregate-cost dwell formula, which scales total dwell time by
 * headcount but never stages individual boarding moments) -- but it looks wrong on screen. Fixed
 * here, in the display only: while a stop's doors are open, the displayed count ramps linearly
 * from the count just before this stop's boarding/alighting to the final post-stop count, reaching
 * the true value exactly at doorsClosed. This changes nothing about the underlying event log or
 * any metric derived from it (still computed from the exact, unramped counts) -- purely cosmetic.
 */
function onboardCountAtTime(group: ElevatorLogGroups, time: number): number {
  const { boarded, alighted, doorsOpened, doorsClosed } = group;
  const after = countAtOrBefore(boarded, time) - countAtOrBefore(alighted, time);

  const openIndex = countAtOrBefore(doorsOpened, time) - 1;
  if (openIndex < 0) return after; // never stopped yet -- nothing to ramp from
  const open = doorsOpened[openIndex];

  const closeIndex = countAtOrBefore(doorsClosed, open.time); // first doorsClosed after this open
  const close = closeIndex < doorsClosed.length ? doorsClosed[closeIndex] : undefined;
  if (!close || time >= close.time) return after; // not currently mid-dwell

  const before = countStrictlyBefore(boarded, open.time) - countStrictlyBefore(alighted, open.time);
  if (before === after) return after; // no net change at this stop -- nothing to ramp

  const span = close.time - open.time;
  if (span <= 0) return after; // degenerate timing guard -- not expected in practice
  const fraction = (time - open.time) / span;
  return Math.round(before + fraction * (after - before));
}

function hallCallActiveAtTime(group: HallCallLogGroup, time: number): boolean {
  return countAtOrBefore(group.registered, time) > countAtOrBefore(group.cleared, time);
}

/**
 * Developer-requested: show each elevator's status (idle / doors open / traveling to floor X)
 * above it in the replay. The simulation's event log has no explicit "elevator became idle" or
 * "elevator started traveling" event to read this off directly -- it's inferred from the same
 * arrival/door data `positionAtTime` and `doorsOpenAtTime` already reconstruct from, reusing
 * `positionAtTime`'s phase boundaries (see its doc comment): `[a.time or dwellClose, travelStart)`
 * is stationary (dwelling with doors open, or idle/unassigned -- doorsOpenAtTime distinguishes
 * which), `[travelStart, b.time)` is actively traveling. This applies even BEFORE the elevator's
 * very first `elevatorArrived` entry -- `positionAtTime` already treats "no arrival yet" as
 * implicitly parked at floor 0 (every elevator starts there), and an elevator dispatched
 * immediately at t=0 is genuinely traveling during `[0, firstArrival.time)`, not idle; a second
 * developer report ("destination should be the call floor, not the floor it is in") was exactly
 * this window incorrectly showing `idle` for the elevator's entire first leg, since there was no
 * prior arrival to derive `travelStart` from at all.
 *
 * While traveling, `targetFloor` is NOT simply `b.floor` (the next `elevatorArrived` entry) --
 * `elevatorArrived` fires for every floor passed through, stop or not, so `b` is only ever the
 * immediately adjacent floor, not where the elevator is actually headed (developer-reported: this
 * showed e.g. "-> Floor 4" while sweeping past floor 4 on the way to a real stop at floor 7,
 * changing every single floor rather than naming the actual destination). The real destination is
 * the floor of the NEXT `doorsOpened` event at or after `time` -- i.e. the next floor this
 * elevator will actually stop and open its doors at, however many pass-through floors away that
 * is -- falling back to `b.floor` only if no further stop is recorded at all (e.g. a homing
 * elevator's final approach to floor 0, which never "stops"/opens doors there, just arrives and
 * goes idle).
 */
function statusAtTime(
  group: ElevatorLogGroups,
  time: number,
  floorTravelTimeMs: number,
): ElevatorStatus {
  if (doorsOpenAtTime(group, time)) return { type: 'doorsOpen' };

  const { arrivals, doorsOpened } = group;
  const arrivalIndex = countAtOrBefore(arrivals, time) - 1;

  // `b`: the next arrival ahead of `time`, if any. Before the very first arrival, that's
  // `arrivals[0]` itself (mirroring positionAtTime's implicit "starts at floor 0" treatment) --
  // NOT automatically idle, since the elevator may already be traveling toward it.
  const b = arrivalIndex < 0 ? arrivals[0] : arrivals[arrivalIndex + 1];
  if (!b) return { type: 'idle' }; // nothing ahead -- either never moved, or done moving

  const travelStart = b.time - floorTravelTimeMs;
  if (time < travelStart) return { type: 'idle' }; // doors already closed here (or never opened),
  // not yet actually moving -- dwelling-with-doors-open was already handled above.

  const nextStopIndex = countStrictlyBefore(doorsOpened, time);
  const nextStop = nextStopIndex < doorsOpened.length ? doorsOpened[nextStopIndex] : undefined;
  return { type: 'traveling', targetFloor: nextStop ? nextStop.floor : b.floor };
}

/** Computes every elevator's and every hall call's displayed state at simulated time T. Pure --
 * the exact same function drives both normal playback (many small time steps) and scrubbing (one
 * large jump), so both are equally exact and drift-free. */
export function computeReplayFrame(grouped: GroupedLog, time: number): ReplayFrame {
  return {
    time,
    elevators: grouped.elevators.map((group) => ({
      elevatorId: group.elevatorId,
      position: positionAtTime(group, time, grouped.floorTravelTimeMs),
      doorsOpen: doorsOpenAtTime(group, time),
      onboardCount: onboardCountAtTime(group, time),
      status: statusAtTime(group, time, grouped.floorTravelTimeMs),
    })),
    activeHallCalls: grouped.hallCalls
      .filter((group) => hallCallActiveAtTime(group, time))
      .map((group) => ({ floor: group.floor, direction: group.direction })),
  };
}
