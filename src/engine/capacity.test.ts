import { describe, expect, it, vi } from 'vitest';

import type { DispatchSnapshot } from './dispatch';
import { runSimulation } from './simulation';
import { buildBasicConfig, createGreedyStopAndGoHook, passengerArrival } from './testFixtures';
import type { HallCall } from './types';

const SAFETY_CUTOFF = { maxTimeMs: 60_000 };

describe('capacity and overflow', () => {
  it('boards exactly capacityRemaining passengers, leaves the rest waiting, and keeps the hall call active until they are eventually served', () => {
    const config = buildBasicConfig({
      floorCount: 2,
      capacity: 2,
      floorTravelTimeMs: 500,
      doorDwellBaseMs: 1000,
      doorDwellPerPassengerMultiplier: 0.5,
    });

    const hook = createGreedyStopAndGoHook();

    // All three register at floor 1 while the elevator is still idle at floor 0 (and all before
    // it arrives, since travel takes 500ms) - so all three are genuinely waiting together when
    // the elevator gets there.
    const script = [
      passengerArrival('p1', 1, 'up', 0, 0),
      passengerArrival('p2', 1, 'up', 0, 0),
      passengerArrival('p3', 1, 'up', 0, 0),
    ];

    const { log, finalState } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    const boardings = log.filter((e) => e.type === 'passengerBoarded');
    // First stop at floor 1 (t=500): only p1 and p2 board (capacity 2); p3 is left behind.
    const firstStopBoardings = boardings.filter(
      (e) => e.type === 'passengerBoarded' && e.time === 500,
    );
    expect(
      firstStopBoardings.map((e) => (e.type === 'passengerBoarded' ? e.passengerId : undefined)),
    ).toEqual(['p1', 'p2']);

    // The hall call at floor 1 must NOT clear on the first stop - p3 is still waiting there.
    const clearedAtFirstStop = log.some(
      (e) => e.type === 'hallCallCleared' && e.floor === 1 && e.time === 500,
    );
    expect(clearedAtFirstStop).toBe(false);

    // p3 is eventually served on a later pass (the greedy hook comes back for them once capacity
    // frees up), and only then does the hall call clear.
    const p3Boarding = boardings.find(
      (e) => e.type === 'passengerBoarded' && e.passengerId === 'p3',
    );
    expect(p3Boarding).toBeDefined();
    expect(p3Boarding!.time).toBeGreaterThan(500);

    const clearedEntries = log.filter((e) => e.type === 'hallCallCleared' && e.floor === 1);
    expect(clearedEntries).toHaveLength(1);
    expect(clearedEntries[0]!.time).toBe(p3Boarding!.time);

    // Everyone is served by the end of the run.
    expect(finalState.waitingPassengers).toEqual([]);
  });

  it('boards nobody past remaining capacity even when the stop is capacity-exact (zero overflow edge case)', () => {
    const config = buildBasicConfig({ floorCount: 1, capacity: 2, floorTravelTimeMs: 100 });
    const hook = createGreedyStopAndGoHook();

    const script = [passengerArrival('p1', 1, 'up', 0, 0), passengerArrival('p2', 1, 'up', 0, 0)];

    const { log } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    const boardings = log.filter((e) => e.type === 'passengerBoarded');
    expect(boardings).toHaveLength(2);
    const cleared = log.filter((e) => e.type === 'hallCallCleared' && e.floor === 1);
    expect(cleared).toHaveLength(1);
    // Cleared on the very same stop that served both - no overflow at all in this case.
    expect(cleared[0]!.time).toBe(boardings[0]!.time);
  });
});

describe('presence-only hall calls', () => {
  it('DispatchSnapshot.activeHallCalls exposes only {floor, direction} - no count or identity - even with several real passengers waiting', () => {
    const config = buildBasicConfig({ floorCount: 1, capacity: 5, floorTravelTimeMs: 200 });
    const hook = vi.fn(createGreedyStopAndGoHook());

    // Three real waiting passengers at the same floor/direction - internally three distinct
    // Passenger records, but the hall call they share is presence-only.
    const script = [
      passengerArrival('p1', 1, 'up', 0, 0),
      passengerArrival('p2', 1, 'up', 0, 0),
      passengerArrival('p3', 1, 'up', 0, 0),
    ];

    runSimulation(config, script, hook, SAFETY_CUTOFF);

    expect(hook).toHaveBeenCalled();

    // Every activeHallCalls entry across every decision point in the run has exactly the two
    // presence-only fields - never a count, never a passenger id.
    for (const [snapshot] of hook.mock.calls as [DispatchSnapshot][]) {
      for (const call of snapshot.activeHallCalls) {
        expect(Object.keys(call).sort()).toEqual(['direction', 'floor']);
      }
    }

    // Specifically: the decision made once the elevator has reached floor 1 (with all three
    // passengers already waiting there) still shows exactly ONE hall call entry for that
    // floor/direction, not three.
    const arrivalSnapshot = (hook.mock.calls as [DispatchSnapshot][])
      .map(([snapshot]) => snapshot)
      .find(
        (snapshot) =>
          snapshot.elevators[0]?.currentFloor === 1 && snapshot.elevators[0]?.state === 'moving',
      );
    expect(arrivalSnapshot).toBeDefined();
    const matchingCalls = arrivalSnapshot!.activeHallCalls.filter(
      (call) => call.floor === 1 && call.direction === 'up',
    );
    expect(matchingCalls).toHaveLength(1);
  });

  it('rejects a passenger-identifying field on HallCall at the type level (enforced by npm run build)', () => {
    // @ts-expect-error - HallCall (and DispatchSnapshot.activeHallCalls entries) is presence-only:
    // floor + direction, nothing else. This is a compile-time guarantee, checked by `tsc -b` as
    // part of `npm run build`; esbuild (what Vitest itself uses to run this file) strips types
    // and does not enforce it, so the runtime assertion below is just a sanity check, not the
    // real test.
    const attempted: HallCall = { floor: 1, direction: 'up', passengerId: 'p1' };
    expect(attempted.floor).toBe(1);
  });
});
