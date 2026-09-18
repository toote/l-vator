// Hand-authored arrivals/log fixtures, mirroring replayFrame.test.ts's and
// passengerRecords.test.ts's style -- exact hand-computed expectations, not snapshot/approximate
// assertions. See dev_log/09_waiting_counts.md, "What gets tested".

import { describe, expect, it } from 'vitest';
import type {
  DispatchAction,
  DispatchHook,
  DispatchSnapshot,
  ScriptedInput,
  SimEventLogEntry,
} from '../../engine';
import { generateTrialBatch, runTrialBatch, type RandomScenario } from '../../generation';
import { countAtOrBefore } from './replayFrame';
import { computeWaitingCounts, groupWaitingCounts } from './waitingCounts';

describe('groupWaitingCounts / computeWaitingCounts: direction-aware', () => {
  it('two passengers at the same floor, opposite directions -- two independent counts, not one combined number', () => {
    const arrivals: ScriptedInput = [
      { id: 'p-up', originFloor: 2, direction: 'up', destinationFloor: 5, arrivalTime: 1000 },
      { id: 'p-down', originFloor: 2, direction: 'down', destinationFloor: 0, arrivalTime: 1000 },
    ];
    const log: SimEventLogEntry[] = [];

    const grouped = groupWaitingCounts(arrivals, log);
    expect(grouped.groups).toHaveLength(2);

    const frame = computeWaitingCounts(grouped, 2000);
    expect(frame).toEqual([
      { floor: 2, direction: 'up', count: 1 },
      { floor: 2, direction: 'down', count: 1 },
    ]);
  });
});

describe('groupWaitingCounts / computeWaitingCounts: never-boarded passenger', () => {
  it('is counted as waiting for every T >= arrivalTime through the end of the trial', () => {
    const arrivals: ScriptedInput = [
      { id: 'p1', originFloor: 1, direction: 'up', destinationFloor: 3, arrivalTime: 500 },
    ];
    const log: SimEventLogEntry[] = []; // no passengerBoarded entry at all -- never boards

    const grouped = groupWaitingCounts(arrivals, log);
    expect(computeWaitingCounts(grouped, 500)).toEqual([{ floor: 1, direction: 'up', count: 1 }]);
    expect(computeWaitingCounts(grouped, 50_000)).toEqual([
      { floor: 1, direction: 'up', count: 1 },
    ]);
    expect(computeWaitingCounts(grouped, 1_000_000)).toEqual([
      { floor: 1, direction: 'up', count: 1 },
    ]);
  });
});

describe('groupWaitingCounts / computeWaitingCounts: boarding transition, exact-timestamp edge case', () => {
  it('decrements exactly AT the boarding time, not after -- mirrors replayFrame.test.ts’s "T on an event boundary" precedent', () => {
    const arrivals: ScriptedInput = [
      { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    ];
    const log: SimEventLogEntry[] = [
      { type: 'passengerBoarded', time: 5000, elevatorId: 'E1', floor: 0, passengerId: 'p1' },
    ];

    const grouped = groupWaitingCounts(arrivals, log);
    expect(computeWaitingCounts(grouped, 4999)).toEqual([{ floor: 0, direction: 'up', count: 1 }]);
    expect(computeWaitingCounts(grouped, 5000)).toEqual([{ floor: 0, direction: 'up', count: 0 }]);
  });
});

describe('groupWaitingCounts: all-zero / absent group', () => {
  it('a (floor, direction) pair with zero arrivals in the whole trial is absent from GroupedWaitingCounts.groups entirely', () => {
    const arrivals: ScriptedInput = [
      { id: 'p1', originFloor: 1, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    ];
    const grouped = groupWaitingCounts(arrivals, []);

    expect(grouped.groups).toHaveLength(1);
    expect(
      grouped.groups.find((group) => group.floor === 2 && group.direction === 'down'),
    ).toBeUndefined();

    // Consumers (replayCrossSection.ts) default an absent key to a count of 0 -- confirmed here
    // that computeWaitingCounts simply omits the pair rather than emitting an explicit 0 entry,
    // same convention replayCrossSection.ts already uses for activeHallCalls.
    const frame = computeWaitingCounts(grouped, 100);
    expect(frame).toEqual([{ floor: 1, direction: 'up', count: 1 }]);
    expect(frame.find((entry) => entry.floor === 2 && entry.direction === 'down')).toBeUndefined();
  });
});

describe('groupWaitingCounts: unsorted-input regression', () => {
  it('produces correctly time-sorted groups (and correct binary-search results) even though arrivals is not chronological', () => {
    // Unlike groupReplayLog's log-derived input (already globally time-ordered by construction),
    // ScriptedInput's authoring order is not guaranteed chronological -- deliberately reversed
    // here.
    const arrivals: ScriptedInput = [
      { id: 'late', originFloor: 3, direction: 'up', destinationFloor: 5, arrivalTime: 5000 },
      { id: 'early', originFloor: 3, direction: 'up', destinationFloor: 5, arrivalTime: 0 },
    ];
    const grouped = groupWaitingCounts(arrivals, []);
    const group = grouped.groups.find((g) => g.floor === 3 && g.direction === 'up');
    expect(group).toBeDefined();
    // Sorted ascending by groupWaitingCounts, NOT left in authoring order.
    expect(group!.arrivals.map((a) => a.time)).toEqual([0, 5000]);

    // At T = 2000, only "early" (arrivalTime 0) has arrived -- the correct count is 1.
    expect(computeWaitingCounts(grouped, 2000)).toEqual([{ floor: 3, direction: 'up', count: 1 }]);

    // Regression check, proving the sort is load-bearing, not decorative: binary-searching the
    // SAME data left in its original (unsorted) authoring order would silently produce the wrong
    // answer (2, not 1) at T = 2000, since countAtOrBefore's binary search assumes ascending
    // order. groupWaitingCounts's explicit sort is what prevents this from happening.
    const unsortedTimed = arrivals.map((a) => ({ time: a.arrivalTime }));
    expect(countAtOrBefore(unsortedTimed, 2000)).toBe(2);
  });
});

describe('groupWaitingCounts / computeWaitingCounts: trial-index-scoping regression', () => {
  // Mirrors computeMetrics.test.ts's dedicated regression test from Unit 05 exactly (see
  // dev_log/05_metrics.md's "computeMetrics.ts's trialIndex-scoping" note and
  // dev_log/09_waiting_counts.md's "What gets tested"): a real RandomScenario, confirmed to
  // produce colliding ids (e.g. "arrival-0") across different trial indices, since
  // generateRandomArrivals names ids fresh per trial. Waiting counts computed for trial 0 using
  // trial 0's own regenerated arrivals must differ from (and be correct, unlike) counts computed
  // by accidentally using trial 1's arrivals against trial 0's log -- this is the single sharpest
  // correctness risk this unit's design carries, per Unit 05's own precedent, and
  // replayView.ts's actual wiring (`batch[replay.trialIndex]`, matched strictly to the trial
  // currently being replayed) is what this test guards.

  // Simple hand-written test hook (not a real src/algorithms module), same style as
  // computeMetrics.test.ts's makeTestAlgorithm: stop for anyone here, otherwise head toward the
  // nearest known target.
  function makeTestAlgorithm(id: string): {
    id: string;
    name: string;
    createHook: () => DispatchHook;
  } {
    return {
      id,
      name: id,
      createHook: (): DispatchHook => {
        const hook: DispatchHook = (snapshot: DispatchSnapshot): DispatchAction[] => {
          const elevator = snapshot.elevators[0];
          if (!elevator) return [];

          const hasMatchingCallHere =
            elevator.capacityRemaining > 0 &&
            snapshot.activeHallCalls.some((call) => call.floor === elevator.currentFloor);
          const hasButtonHere = elevator.carButtons.includes(elevator.currentFloor);
          if (hasMatchingCallHere || hasButtonHere) {
            return [{ type: 'stop', elevatorId: elevator.id }];
          }

          const target = elevator.carButtons[0];
          if (target !== undefined) {
            return [
              {
                type: 'travel',
                elevatorId: elevator.id,
                direction: target > elevator.currentFloor ? 'up' : 'down',
              },
            ];
          }

          const call = snapshot.activeHallCalls[0];
          if (call !== undefined && call.floor !== elevator.currentFloor) {
            return [
              {
                type: 'travel',
                elevatorId: elevator.id,
                direction: call.floor > elevator.currentFloor ? 'up' : 'down',
              },
            ];
          }

          return [];
        };
        return hook;
      },
    };
  }

  function totalArrivals(grouped: ReturnType<typeof groupWaitingCounts>): number {
    return grouped.groups.reduce((sum, group) => sum + group.arrivals.length, 0);
  }

  it('scoping trial 0 to trial 1’s regenerated arrivals produces a different (and wrong) population than trial 0’s own arrivals', () => {
    const scenario: RandomScenario = {
      type: 'random',
      building: {
        floorCount: 3,
        elevatorCount: 1,
        capacity: 4,
        floorTravelTimeMs: 500,
        doorDwellBaseMs: 500,
        doorDwellPerPassengerMultiplier: 0.5,
        idleReturnThresholdMs: 30000,
      },
      arrivals: { baseRatePerMinute: 60, pattern: 'random' },
      durationMs: 4000,
      trialCount: 2,
      seed: 12345,
    };

    const batch = generateTrialBatch(scenario);
    // Sanity checks on the fixture itself, mirroring computeMetrics.test.ts's own: both trials
    // produce nonempty, differently-sized arrivals arrays for this seed, and ids DO collide
    // across trials (arrival-0 exists in every trial).
    expect(batch[0].length).toBeGreaterThan(0);
    expect(batch[1].length).toBeGreaterThan(0);
    expect(batch[0].length).not.toBe(batch[1].length);
    expect(batch[0][0]!.id).toBe('arrival-0');
    expect(batch[1][0]!.id).toBe('arrival-0');

    const algorithm = makeTestAlgorithm('test-algo');
    const trialResults = runTrialBatch(scenario, [algorithm]);
    const trial0Result = trialResults.find((r) => r.trialIndex === 0)!;

    const correct = groupWaitingCounts(batch[0], trial0Result.result.log);
    // Deliberately WRONG scoping: trial 0's own log, matched against trial 1's arrivals.
    const wrongTrialIndex = groupWaitingCounts(batch[1], trial0Result.result.log);

    // Each grouping's total arrival count always equals the arrivals array's own length (one
    // record per arrival) -- so if scoping were wrong, trial 0's reported waiting population
    // would silently become trial 1's population instead of its own.
    expect(totalArrivals(correct)).toBe(batch[0].length);
    expect(totalArrivals(wrongTrialIndex)).toBe(batch[1].length);
    expect(totalArrivals(correct)).not.toBe(totalArrivals(wrongTrialIndex));
    expect(correct).not.toEqual(wrongTrialIndex);
  });
});
