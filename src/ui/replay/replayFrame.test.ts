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
  const grouped = groupReplayLog(log, ['E1'], 1000);

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
  const grouped = groupReplayLog(log, ['E1'], 1000);

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

describe('computeReplayFrame: position -- Idle-then-recalled regression (a long unassigned gap DID occur between two arrivals)', () => {
  // Developer-reported: in the replay, an idle elevator parked at a floor could be seen "slowly
  // moving" well before it was actually dispatched again. Root cause: the original algorithm only
  // ever anchored travel-start to a door-dwell detected AT the earlier arrival's own timestamp --
  // it had no way to represent "stopped, dwelled, doors closed, and THEN sat idle/unassigned for
  // an arbitrary stretch before finally being recalled," so it treated the entire gap after
  // doorsClosed as one continuous interpolated move, visibly creeping the elevator toward the
  // next floor for the whole idle stretch, not just the real final floorTravelTimeMs of it.
  //
  // E1 arrives floor 10 at 32000 and stops (doorsOpened at the same timestamp), dwells until
  // doorsClosed at 36500 (dwellMs = 4500), then sits idle -- no assignment, no door event -- until
  // finally recalled and arriving floor 9 at 82500 (floorTravelTimeMs = 2000, so real travel only
  // started at 80500). This mirrors the exact scenario traced live: FCFS recalling the last idle
  // elevator only once every nearer one has taken its turn on a sustained backlog.
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 32000, elevatorId: 'E1', floor: 10 },
    { type: 'doorsOpened', time: 32000, elevatorId: 'E1', floor: 10 },
    { type: 'passengerAlighted', time: 32000, elevatorId: 'E1', floor: 10, passengerId: 'p1' },
    { type: 'doorsClosed', time: 36500, elevatorId: 'E1', floor: 10 },
    { type: 'elevatorArrived', time: 82500, elevatorId: 'E1', floor: 9 },
  ];
  const grouped = groupReplayLog(log, ['E1'], 2000);

  it('holds position fixed at floor 10 through the dwell AND the entire idle stretch after it', () => {
    expect(computeReplayFrame(grouped, 36500).elevators[0].position).toBe(10); // doors just closed
    // The key regression point: naively interpolating the full [36500, 82500] span would compute
    // fraction = (50000 - 36500) / (82500 - 36500) ≈ 0.293 -> position ≈ 9.7 here, visibly
    // creeping away from floor 10 tens of seconds before the elevator is actually dispatched.
    // The corrected algorithm must return exactly 10 -- a genuine regression test.
    expect(computeReplayFrame(grouped, 50000).elevators[0].position).toBe(10);
    expect(computeReplayFrame(grouped, 80499).elevators[0].position).toBe(10);
  });

  it('starts interpolating only in the real final floorTravelTimeMs window before the next arrival', () => {
    expect(computeReplayFrame(grouped, 80500).elevators[0].position).toBe(10); // fraction 0
    expect(computeReplayFrame(grouped, 81500).elevators[0].position).toBe(9.5); // fraction 0.5
    expect(computeReplayFrame(grouped, 82500).elevators[0].position).toBe(9); // arrived
  });
});

describe('computeReplayFrame: door state', () => {
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsClosed', time: 5000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 7000, elevatorId: 'E1', floor: 2 },
  ];
  const grouped = groupReplayLog(log, ['E1'], 1000);

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
  const grouped = groupReplayLog(log, ['E1'], 1000);

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

describe('computeReplayFrame: onboard count ramps across a dwell instead of jumping instantly', () => {
  // Developer-reported: 8 passengers boarding at once made the displayed count jump straight to
  // 8, even though the doors stayed open for the rest of an 800ms dwell. The simulation logs
  // every passenger's boarding at the SAME timestamp (door.ts's dwell formula only scales total
  // dwell duration by headcount, never stages individual boarding moments) -- so the ramp is a
  // display-only fix, not a change to the underlying event data.
  //
  // Stop 1 at floor 2: 8 passengers board at once (doorsOpened 2000, doorsClosed 2800 -- an
  // 800ms dwell). Stop 2 at floor 5: 3 of those 8 alight (doorsOpened 3800, doorsClosed 4200 --
  // a 400ms dwell), proving the ramp also works for a net DECREASE and that "before" is whatever
  // the count actually was, not hardcoded to 0.
  const boardIds = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const log: SimEventLogEntry[] = [
    { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
    { type: 'doorsOpened', time: 2000, elevatorId: 'E1', floor: 2 },
    ...boardIds.map((passengerId): SimEventLogEntry => ({
      type: 'passengerBoarded',
      time: 2000,
      elevatorId: 'E1',
      floor: 2,
      passengerId,
    })),
    { type: 'doorsClosed', time: 2800, elevatorId: 'E1', floor: 2 },
    { type: 'elevatorArrived', time: 3800, elevatorId: 'E1', floor: 5 },
    { type: 'doorsOpened', time: 3800, elevatorId: 'E1', floor: 5 },
    { type: 'passengerAlighted', time: 3800, elevatorId: 'E1', floor: 5, passengerId: 'p1' },
    { type: 'passengerAlighted', time: 3800, elevatorId: 'E1', floor: 5, passengerId: 'p2' },
    { type: 'passengerAlighted', time: 3800, elevatorId: 'E1', floor: 5, passengerId: 'p3' },
    { type: 'doorsClosed', time: 4200, elevatorId: 'E1', floor: 5 },
  ];
  const grouped = groupReplayLog(log, ['E1'], 1000);

  it('ramps up from 0 to 8 across the boarding dwell, reaching 8 only at doorsClosed', () => {
    expect(computeReplayFrame(grouped, 2000).elevators[0].onboardCount).toBe(0); // doors just opened
    expect(computeReplayFrame(grouped, 2200).elevators[0].onboardCount).toBe(2); // 25% through
    expect(computeReplayFrame(grouped, 2400).elevators[0].onboardCount).toBe(4); // 50% through
    expect(computeReplayFrame(grouped, 2600).elevators[0].onboardCount).toBe(6); // 75% through
    expect(computeReplayFrame(grouped, 2800).elevators[0].onboardCount).toBe(8); // doors closed
    expect(computeReplayFrame(grouped, 3000).elevators[0].onboardCount).toBe(8); // stays after
  });

  it('ramps down from 8 to 5 across the alighting dwell, starting from the real prior count (not 0)', () => {
    expect(computeReplayFrame(grouped, 3800).elevators[0].onboardCount).toBe(8); // doors just opened
    expect(computeReplayFrame(grouped, 3900).elevators[0].onboardCount).toBe(7); // 25% through
    expect(computeReplayFrame(grouped, 4100).elevators[0].onboardCount).toBe(6); // 75% through
    expect(computeReplayFrame(grouped, 4200).elevators[0].onboardCount).toBe(5); // doors closed
  });
});

describe('computeReplayFrame: active hall calls', () => {
  const log: SimEventLogEntry[] = [
    { type: 'hallCallRegistered', time: 1000, floor: 3, direction: 'up' },
    { type: 'hallCallRegistered', time: 1500, floor: 4, direction: 'down' },
    { type: 'hallCallCleared', time: 3000, floor: 3, direction: 'up' },
  ];
  const grouped = groupReplayLog(log, ['E1'], 1000);

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
