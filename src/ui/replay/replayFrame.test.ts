// Hand-authored log fixtures, mirroring src/engine/testFixtures.ts's style (Unit 02) -- exact
// hand-computed expectations, not snapshot/approximate assertions. See dev_log/07_results.md,
// "What gets tested".

import { describe, expect, it } from 'vitest';
import type { SimEventLogEntry } from '../../engine';
import { computeReplayFrame, countAtOrBefore, groupReplayLog } from './replayFrame';

describe('countAtOrBefore', () => {
  it('returns 0 for an empty array', () => {
    expect(countAtOrBefore([], 100)).toBe(0);
  });

  it('returns 0 when T is before the first entry', () => {
    expect(countAtOrBefore([{ time: 10 }, { time: 20 }], 5)).toBe(0);
  });

  it('returns the full length when T is after the last entry', () => {
    expect(countAtOrBefore([{ time: 10 }, { time: 20 }], 999)).toBe(2);
  });

  it('counts an entry whose time exactly equals T as "at or before"', () => {
    expect(countAtOrBefore([{ time: 10 }, { time: 20 }, { time: 30 }], 20)).toBe(2);
  });
});

describe('computeReplayFrame: position -- straight pass-through (no stop)', () => {
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 1000, elevatorId: 'E1', floor: 1 },
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
  ];
  const grouped = groupReplayLog(log, ['E1']);

  it('is floor 0 before the elevator’s first log entry', () => {
    expect(computeReplayFrame(grouped, 0).elevators[0].position).toBe(0);
    expect(computeReplayFrame(grouped, 500).elevators[0].position).toBe(0);
  });

  it('interpolates linearly across the full span when nothing stopped at the earlier arrival', () => {
    expect(computeReplayFrame(grouped, 1000).elevators[0].position).toBe(1);
    expect(computeReplayFrame(grouped, 1500).elevators[0].position).toBe(1.5);
    expect(computeReplayFrame(grouped, 1750).elevators[0].position).toBe(1.75);
  });

  it('is fixed at the last known floor after the last log entry', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].position).toBe(2);
    expect(computeReplayFrame(grouped, 9999).elevators[0].position).toBe(2);
  });
});

describe('computeReplayFrame: position -- Correction regression (a stop DID occur at the earlier arrival)', () => {
  // E1 arrives floor 1 at 1000 (pass-through), arrives floor 2 at 2000 and stops (doorsOpened at
  // the SAME timestamp as elevatorArrived, per simulation.ts's handleStop being called
  // synchronously from handleElevatorArrived), dwells until doorsClosed at 5000 (dwellMs = 3000),
  // then travels on, arriving floor 3 at 6000 (floorTravelTimeMs = 1000). This mirrors exactly
  // the timing relationship the plan's Correction note describes: T_B - T_A = dwellMs +
  // floorTravelTimeMs (6000 - 2000 = 3000 + 1000), not just floorTravelTimeMs.
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 1000, elevatorId: 'E1', floor: 1 },
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'passengerBoarded', time: 2000, elevatorId: 'E1', floor: 2, passengerId: 'p1' },
    { type: 'doorsClosed', time: 5000, elevatorId: 'E1', floor: 2 },
    { type: 'elevatorArrived', time: 6000, elevatorId: 'E1', floor: 3 },
  ];
  const grouped = groupReplayLog(log, ['E1']);

  it('holds position fixed at floor 2 for the ENTIRE dwell window [2000, 5000)', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].position).toBe(2);
    expect(computeReplayFrame(grouped, 3000).elevators[0].position).toBe(2);
    // The key regression point: at T = 4000, the ORIGINAL (uncorrected) draft interpolated
    // linearly across the WHOLE [2000, 6000] span regardless of the dwell, which would compute
    // fraction = (4000 - 2000) / (6000 - 2000) = 0.5 -> position 2.5 (visibly creeping away from
    // floor 2 mid-dwell). The corrected algorithm must return exactly 2 here -- this assertion
    // would FAIL (2.5 !== 2) against that naive algorithm, so it's a genuine regression test, not
    // one that happens to pass either way.
    expect(computeReplayFrame(grouped, 4000).elevators[0].position).toBe(2);
    expect(computeReplayFrame(grouped, 4999).elevators[0].position).toBe(2);
  });

  it('resumes interpolating from doorsClosed’s timestamp (5000), NOT the earlier elevatorArrived’s timestamp (2000)', () => {
    // At T = 5500 (halfway between doorsClosed at 5000 and the next arrival at 6000), the
    // corrected travel-start-anchored formula gives fraction = (5500 - 5000) / (6000 - 5000) =
    // 0.5 -> position 2.5. The ORIGINAL (uncorrected) algorithm, anchored to T_A = 2000 instead,
    // would compute fraction = (5500 - 2000) / (6000 - 2000) = 0.875 -> position 2.875 -- a
    // different, wrong value. This assertion distinguishes the two: it passes only under the
    // corrected algorithm.
    expect(computeReplayFrame(grouped, 5500).elevators[0].position).toBe(2.5);
  });

  it('is fixed at floor 2 exactly at the doorsOpened timestamp (start of the dwell)', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].position).toBe(2);
  });

  it('is fixed at the final floor after the last arrival', () => {
    expect(computeReplayFrame(grouped, 6000).elevators[0].position).toBe(3);
    expect(computeReplayFrame(grouped, 99999).elevators[0].position).toBe(3);
  });
});

describe('computeReplayFrame: door state', () => {
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsClosed', time: 5000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 7000, elevatorId: 'E1', floor: 2 },
  ];
  const grouped = groupReplayLog(log, ['E1']);

  it('is closed before any doorsOpened event', () => {
    expect(computeReplayFrame(grouped, 0).elevators[0].doorsOpen).toBe(false);
    expect(computeReplayFrame(grouped, 1999).elevators[0].doorsOpen).toBe(false);
  });

  it('is open from doorsOpened (inclusive) up to doorsClosed (exclusive)', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].doorsOpen).toBe(true);
    expect(computeReplayFrame(grouped, 3500).elevators[0].doorsOpen).toBe(true);
    expect(computeReplayFrame(grouped, 4999).elevators[0].doorsOpen).toBe(true);
  });

  it('is closed from doorsClosed (inclusive) until the next doorsOpened', () => {
    expect(computeReplayFrame(grouped, 5000).elevators[0].doorsOpen).toBe(false);
    expect(computeReplayFrame(grouped, 6999).elevators[0].doorsOpen).toBe(false);
  });

  it('reopens at the second doorsOpened event', () => {
    expect(computeReplayFrame(grouped, 7000).elevators[0].doorsOpen).toBe(true);
    expect(computeReplayFrame(grouped, 9000).elevators[0].doorsOpen).toBe(true);
  });
});

describe('computeReplayFrame: onboard count (boarding then alighting)', () => {
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 1000, elevatorId: 'E1', floor: 1 },
    { type: 'passengerBoarded', time: 1000, elevatorId: 'E1', floor: 1, passengerId: 'p1' },
    { type: 'passengerBoarded', time: 1000, elevatorId: 'E1', floor: 1, passengerId: 'p2' },
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'passengerAlighted', time: 2000, elevatorId: 'E1', floor: 2, passengerId: 'p1' },
  ];
  const grouped = groupReplayLog(log, ['E1']);

  it('starts at 0 before anyone boards', () => {
    expect(computeReplayFrame(grouped, 500).elevators[0].onboardCount).toBe(0);
  });

  it('counts both boardings at their timestamp (inclusive)', () => {
    expect(computeReplayFrame(grouped, 1000).elevators[0].onboardCount).toBe(2);
    expect(computeReplayFrame(grouped, 1500).elevators[0].onboardCount).toBe(2);
  });

  it('nets out an alighting at its timestamp (inclusive)', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].onboardCount).toBe(1);
    expect(computeReplayFrame(grouped, 5000).elevators[0].onboardCount).toBe(1);
  });
});

describe('computeReplayFrame: active hall calls', () => {
  const log: SimEventLogEntry[] = [
    { type: 'hallCallRegistered', time: 1000, floor: 3, direction: 'up' },
    { type: 'hallCallRegistered', time: 1500, floor: 4, direction: 'down' },
    { type: 'hallCallCleared', time: 3000, floor: 3, direction: 'up' },
  ];
  const grouped = groupReplayLog(log, ['E1']);

  it('is empty before any call registers', () => {
    expect(computeReplayFrame(grouped, 500).activeHallCalls).toEqual([]);
  });

  it('includes a call from its registration timestamp (inclusive)', () => {
    expect(computeReplayFrame(grouped, 1000).activeHallCalls).toEqual([
      { floor: 3, direction: 'up' },
    ]);
  });

  it('accumulates multiple independently active calls', () => {
    expect(computeReplayFrame(grouped, 2000).activeHallCalls).toEqual([
      { floor: 3, direction: 'up' },
      { floor: 4, direction: 'down' },
    ]);
  });

  it('drops a call exactly at its clear timestamp (inclusive) -- edge case: T on an event boundary', () => {
    const frame = computeReplayFrame(grouped, 3000);
    expect(frame.activeHallCalls).toEqual([{ floor: 4, direction: 'down' }]);
  });
});
