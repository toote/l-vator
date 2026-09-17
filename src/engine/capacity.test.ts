import { describe, expect, it, vi } from 'vitest';

import type { DispatchHook, DispatchSnapshot } from './dispatch';
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

  it('keeps activeHallCalls in arrival order, independent of other calls being cleared', () => {
    const config = buildBasicConfig({ floorCount: 5, capacity: 5, floorTravelTimeMs: 100 });
    const hook = vi.fn(createGreedyStopAndGoHook());

    // Call A (floor 2, up) registers first, call B (floor 4, up) second - both active together.
    // The elevator serves A first (it's on the way), clearing it independently of B. Later, call
    // C (floor 3, up) registers after A has already cleared. At every point, remaining calls must
    // stay in the order they first became active, regardless of what already cleared.
    const script = [
      passengerArrival('a', 2, 'up', 0, 0),
      passengerArrival('b', 4, 'up', 0, 0),
      passengerArrival('c', 3, 'up', 0, 250),
    ];

    runSimulation(config, script, hook, SAFETY_CUTOFF);

    const snapshotsWithBothAAndB = (hook.mock.calls as [DispatchSnapshot][])
      .map(([snapshot]) => snapshot)
      .filter((snapshot) => {
        const floors = snapshot.activeHallCalls.map((c) => c.floor);
        return floors.includes(2) && floors.includes(4);
      });
    expect(snapshotsWithBothAAndB.length).toBeGreaterThan(0);
    for (const snapshot of snapshotsWithBothAAndB) {
      const floors = snapshot.activeHallCalls.map((c) => c.floor);
      expect(floors.indexOf(2)).toBeLessThan(floors.indexOf(4)); // A before B
    }

    const snapshotsWithBothBAndC = (hook.mock.calls as [DispatchSnapshot][])
      .map(([snapshot]) => snapshot)
      .filter((snapshot) => {
        const floors = snapshot.activeHallCalls.map((c) => c.floor);
        return floors.includes(4) && floors.includes(3);
      });
    expect(snapshotsWithBothBAndC.length).toBeGreaterThan(0);
    for (const snapshot of snapshotsWithBothBAndC) {
      // A (floor 2) has cleared by now, but B (registered before C) must still precede C.
      const floors = snapshot.activeHallCalls.map((c) => c.floor);
      expect(floors.includes(2)).toBe(false);
      expect(floors.indexOf(4)).toBeLessThan(floors.indexOf(3)); // B before C
    }
  });
});

describe('boarding direction vs. arrival direction', () => {
  it('boards a passenger even when the elevator had to travel the opposite way to reach the call', () => {
    // A call registered "floor 4, down" can only be reached by a car below floor 4, which has to
    // travel UP to get there - a completely ordinary elevator scenario. Boarding must be driven
    // by the call's direction, not by which way the elevator happened to travel to arrive (a
    // real bug once: using arrival direction produced zero boarding candidates, zero dwell time,
    // and an infinite same-timestamp stop loop - caught via Unit 03's algorithm tests).
    const config = buildBasicConfig({
      floorCount: 5,
      floorTravelTimeMs: 100,
      doorDwellBaseMs: 50,
      doorDwellPerPassengerMultiplier: 0,
    });

    const hook: DispatchHook = (snapshot) => {
      const elevator = snapshot.elevators[0];
      if (!elevator) return [];
      // Deliberately checks for ANY active call here, regardless of direction — this test wants
      // to force a 'stop' attempt purely by floor match, to exercise the engine's own direction
      // resolution rather than a hook that pre-filters by direction the way a real algorithm would.
      const hasCallHere = snapshot.activeHallCalls.some((c) => c.floor === elevator.currentFloor);
      const hasButtonHere = elevator.carButtons.includes(elevator.currentFloor);
      if (hasCallHere || hasButtonHere) {
        return [{ type: 'stop', elevatorId: elevator.id }];
      }
      if (elevator.currentFloor < 4) {
        return [{ type: 'travel', elevatorId: elevator.id, direction: 'up' }];
      }
      return [{ type: 'idle', elevatorId: elevator.id }]; // nothing left to do at floor 4
    };

    const { log, finalState } = runSimulation(
      config,
      [passengerArrival('p1', 4, 'down', 0, 0)],
      hook,
      { maxTimeMs: 10_000 },
    );

    const boarded = log.filter((e) => e.type === 'passengerBoarded');
    expect(boarded).toHaveLength(1);
    expect(boarded[0]).toMatchObject({ passengerId: 'p1', floor: 4 });
    expect(finalState.waitingPassengers).toEqual([]);

    // The stop actually resolved (nonzero dwell, doors closed after opening) rather than looping.
    const opened = log.find((e) => e.type === 'doorsOpened');
    const closed = log.find((e) => e.type === 'doorsClosed');
    expect(opened).toBeDefined();
    expect(closed).toBeDefined();
    expect(closed!.time).toBeGreaterThan(opened!.time);
  });

  it('boards no one on a pure drop-off stop when no call is active here in either direction', () => {
    // Sanity check that the fix doesn't over-correct: a stop with a carButton but no active call
    // (in the arrival direction OR the opposite one) still boards nobody, unchanged from before.
    const config = buildBasicConfig({
      floorCount: 5,
      capacity: 4,
      floorTravelTimeMs: 100,
      doorDwellBaseMs: 50,
      doorDwellPerPassengerMultiplier: 0,
    });
    const hook = createGreedyStopAndGoHook();

    // Single passenger, boards at floor 0 (idle-issued stop), destination floor 3 - no one else
    // ever registers a call at floor 3, so the eventual drop-off stop there has nothing to board.
    const { log } = runSimulation(
      config,
      [passengerArrival('p1', 0, 'up', 3, 0)],
      hook,
      SAFETY_CUTOFF,
    );

    const dropoffBoardings = log.filter((e) => e.type === 'passengerBoarded' && e.floor === 3);
    expect(dropoffBoardings).toHaveLength(0);
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
