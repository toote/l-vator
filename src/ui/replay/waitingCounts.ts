// Pure per-(floor, direction) "how many are waiting at simulated time T" computation. See
// dev_log/09_waiting_counts.md, "Architecture: a sibling module mirroring replayFrame.ts's exact
// shape" -- this is a sibling to replayFrame.ts, not an extension of it: replayFrame.ts's
// functions depend on nothing but a trial's log, while this module needs one additional input
// (ScriptedInput, the regenerated arrivals for this trial) that replayFrame.ts's already-tested,
// already-shipped shapes don't carry. countAtOrBefore is imported from replayFrame.ts directly
// rather than duplicated -- same binary-search primitive, same guarantee (sorted-ascending array,
// count of entries with time <= t).

import type { Direction, FloorIndex, ScriptedInput, SimEventLogEntry } from '../../engine';
import { countAtOrBefore } from './replayFrame';

interface Timed {
  time: number;
}

export interface WaitingCountGroup {
  floor: FloorIndex;
  direction: Direction;
  /** Every arrival's arrivalTime for this (floor, direction) pair, ascending. */
  arrivals: Timed[];
  /** Same passengers' passengerBoarded times, ascending -- only entries for passengers who
   * eventually board at all (a never-boarding passenger has no entry here, by construction). */
  boarded: Timed[];
}

export interface GroupedWaitingCounts {
  /** One entry per (floor, direction) pair with at least one arrival in this trial. A pair
   * with zero arrivals simply has no entry -- callers default absent keys to a count of 0,
   * mirroring replayCrossSection.ts's existing activeHallCalls-lookup pattern. */
  groups: WaitingCountGroup[];
}

export interface WaitingCountFrame {
  floor: FloorIndex;
  direction: Direction;
  count: number;
}

function key(floor: FloorIndex, direction: Direction): string {
  return `${floor}:${direction}`;
}

/**
 * Groups one trial's regenerated arrivals (ScriptedInput for the selected trialIndex -- see
 * dev_log/09_waiting_counts.md, "Where the Scenario needed for generateTrialBatch comes from") by
 * (floor, direction), once, ahead of any per-frame lookups -- same "group once per selection
 * change" shape as replayFrame.ts's groupReplayLog.
 *
 * UNLIKE groupReplayLog: `arrivals` is authoring-order ScriptedInput, not the simulation's own
 * time-ordered log -- nothing guarantees it (or the matched passengerBoarded entries pulled from
 * `log`) is already sorted by time within a (floor, direction) bucket. Each group's `arrivals`/
 * `boarded` arrays are explicitly sorted ascending by time here, which groupReplayLog does not
 * need to do (its source log is already globally time-ordered by construction).
 */
export function groupWaitingCounts(
  arrivals: ScriptedInput,
  log: readonly SimEventLogEntry[],
): GroupedWaitingCounts {
  const boardedAt = new Map<string, number>();
  for (const entry of log) {
    if (entry.type === 'passengerBoarded') boardedAt.set(entry.passengerId, entry.time);
  }

  const groupMap = new Map<string, WaitingCountGroup>();
  for (const arrival of arrivals) {
    const k = key(arrival.originFloor, arrival.direction);
    let group = groupMap.get(k);
    if (!group) {
      group = {
        floor: arrival.originFloor,
        direction: arrival.direction,
        arrivals: [],
        boarded: [],
      };
      groupMap.set(k, group);
    }
    group.arrivals.push({ time: arrival.arrivalTime });
    const boardedTime = boardedAt.get(arrival.id);
    if (boardedTime !== undefined) group.boarded.push({ time: boardedTime });
  }

  const groups = Array.from(groupMap.values());
  for (const group of groups) {
    group.arrivals.sort((a, b) => a.time - b.time);
    group.boarded.sort((a, b) => a.time - b.time);
  }
  return { groups };
}

/** count(floor, direction, T) = arrivals with arrivalTime <= T, minus those already boarded by T.
 * Same binary-search shape as replayFrame.ts's hallCallActiveAtTime, counting instead of
 * booleans. */
export function computeWaitingCounts(
  grouped: GroupedWaitingCounts,
  time: number,
): WaitingCountFrame[] {
  return grouped.groups.map((group) => ({
    floor: group.floor,
    direction: group.direction,
    count: countAtOrBefore(group.arrivals, time) - countAtOrBefore(group.boarded, time),
  }));
}
