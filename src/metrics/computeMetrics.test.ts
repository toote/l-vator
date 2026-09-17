import { describe, expect, it } from 'vitest';
import type { DispatchAction, DispatchHook, DispatchSnapshot } from '../engine';
import {
  generateTrialBatch,
  runTrialBatch,
  type RandomScenario,
  type ScriptedScenario,
} from '../generation';
import { computeMetrics } from './computeMetrics';
import { computeTrialMetrics } from './trialMetrics';

// A small, deliberately simple "stop for anyone here, otherwise head toward the nearest known
// target" dispatch hook — hand-written for this test file rather than imported from
// src/algorithms (this unit does not depend on src/algorithms, and a fully hand-traceable
// end-to-end scenario needs fully predictable, hand-verifiable behavior; see dev_log/05_metrics.md
// and the style established by Units 02/03's own hand-written test hooks). NOT a real algorithm.
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

describe('computeMetrics: end-to-end hand-traceable scenario', () => {
  // See dev_log/05_metrics.md's "What gets unit-tested": a small hand-authored ScriptedScenario
  // run through runSimulation/runTrialBatch, with a deliberately tight maxTimeMs stranding some
  // passengers, then through computeMetrics — every one of the eight headline metrics plus
  // ServedCounts asserted against hand-computed exact values.
  //
  // The full event-by-event trace below was independently verified against the real engine
  // (runSimulation) before being hardcoded here — see the trace in this unit's implementation
  // notes. Summary of what happens (building: 2 floors above ground, 1 elevator, capacity 4,
  // floorTravelTimeMs 1000, doorDwellBaseMs 1000, multiplier 0.5):
  //
  //   t=0:    p1 arrives floor0/up (dest 2) -> boards immediately (elevator idle right there)
  //   t=1000: p2's arrival (also t=0, floor0/up, dest 1) is picked up on the immediate re-stop
  //           -> boards at t=1000
  //   t=3000: elevator arrives floor1 (hop 0->1, carrying p1+p2) -> p2 alights (dest 1)
  //   t=5000: elevator arrives floor2 (hop 1->2, carrying p1) -> p1 alights (dest 2) -> idle
  //   t=6200: p3 arrives floor0/up (dest 2) -> elevator travels down to fetch it (2 deadhead hops)
  //   t=8200: elevator arrives floor0 (hop, deadhead) -> p3 boards
  //   t=8300: p4 arrives floor2/down (dest 0) -> elevator still mid-dwell for p3, can't respond
  //   maxTimeMs=9000 cuts the run off before p3's doors-closed/next-decision event (t=9200) fires
  //
  // Final classification: p1 served (wait 0, travel 5000), p2 served (wait 1000, travel 2000),
  // p3 boardedOnly (wait 2000, still onboard), p4 neverBoarded (censoredWait 0, still waiting).
  const building = {
    floorCount: 2,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 1000,
    doorDwellBaseMs: 1000,
    doorDwellPerPassengerMultiplier: 0.5,
  };

  const scenario: ScriptedScenario = {
    type: 'scripted',
    building,
    trialCount: 2, // 2 identical trials (scripted scenarios reuse the same script every trial)
    script: [
      { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 0 },
      { id: 'p2', originFloor: 0, direction: 'up', destinationFloor: 1, arrivalTime: 0 },
      { id: 'p3', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 6200 },
      { id: 'p4', originFloor: 2, direction: 'down', destinationFloor: 0, arrivalTime: 8300 },
    ],
  };

  const algorithm = makeTestAlgorithm('test-algo');
  const trialResults = runTrialBatch(scenario, [algorithm], { maxTimeMs: 9000 });
  const [algorithmMetrics] = computeMetrics(trialResults, scenario);

  it('produces exactly one AlgorithmMetrics for the single algorithm, with both trials', () => {
    expect(computeMetrics(trialResults, scenario)).toHaveLength(1);
    expect(algorithmMetrics!.algorithmId).toBe('test-algo');
    expect(algorithmMetrics!.trialCount).toBe(2);
  });

  it('computes every per-trial headline metric exactly, for both (identical) trials', () => {
    for (const trial of algorithmMetrics!.perTrial) {
      expect(trial.simulatedDurationMs).toBe(8300);
      expect(trial.averageWaitTimeMs).toBe(1000); // mean(0, 1000, 2000) over p1,p2,p3
      expect(trial.maxWaitTimeMs).toBe(2000); // max(0, 1000, 2000, 0) over ALL 4 passengers
      expect(trial.averageTravelTimeMs).toBe(3500); // mean(5000, 2000) over p1,p2
      expect(trial.totalDistanceFloors).toBe(4); // 4 elevatorArrived hops
      expect(trial.throughputPerHour).toBeCloseTo((2 * 3_600_000) / 8300, 10); // 2 served / 8300ms
      expect(trial.averageOccupancyWhileMovingPct).toBe(18.75); // mean([2,1,0,0]/4) * 100
      expect(trial.deadheadTravelPct).toBe(50); // 2 of 4 hops empty
      expect(trial.unservedCount).toBe(2); // p3 (boardedOnly) + p4 (neverBoarded)
      expect(trial.unservedPct).toBe(50); // 2 / 4 * 100
      expect(trial.servedCounts).toEqual({ total: 4, served: 2, boardedOnly: 1, neverBoarded: 1 });
    }
  });

  it('aggregates all 8 headline metrics correctly across the 2 (identical) trials', () => {
    // Both trials are identical (same scripted arrivals, same deterministic hook), so pooling two
    // equal trials reproduces the same per-trial numbers for every ratio metric, and sums/means
    // scale predictably for the count-shaped ones.
    expect(algorithmMetrics!.averageWaitTimeMs).toBe(1000);
    expect(algorithmMetrics!.maxWaitTimeMs).toBe(2000);
    expect(algorithmMetrics!.meanOfPerTrialMaxWaitTimeMs).toBe(2000);
    expect(algorithmMetrics!.averageTravelTimeMs).toBe(3500);
    expect(algorithmMetrics!.totalDistanceFloors).toBe(4); // mean(4, 4)
    expect(algorithmMetrics!.throughputPerHour).toBeCloseTo((2 * 3_600_000) / 8300, 10);
    expect(algorithmMetrics!.averageOccupancyWhileMovingPct).toBe(18.75);
    expect(algorithmMetrics!.deadheadTravelPct).toBe(50);
    expect(algorithmMetrics!.unservedCount).toBe(4); // 2 + 2, summed
    expect(algorithmMetrics!.unservedPct).toBe(50); // 4 / 8 * 100
    expect(algorithmMetrics!.servedCounts).toEqual({
      total: 8,
      served: 4,
      boardedOnly: 2,
      neverBoarded: 2,
    });
  });
});

describe('regenerated-batch correctness', () => {
  it("boardedAt derived from the log always lands at/after the passenger's own scripted arrivalTime, and the regenerated arrivalTime matches the script literally", () => {
    const building = {
      floorCount: 2,
      elevatorCount: 1,
      capacity: 4,
      floorTravelTimeMs: 1000,
      doorDwellBaseMs: 1000,
      doorDwellPerPassengerMultiplier: 0.5,
    };
    const scenario: ScriptedScenario = {
      type: 'scripted',
      building,
      trialCount: 1,
      script: [
        { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 0 },
        { id: 'p2', originFloor: 0, direction: 'up', destinationFloor: 1, arrivalTime: 0 },
        { id: 'p3', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 6200 },
      ],
    };

    const batch = generateTrialBatch(scenario);
    // Scripted scenarios regenerate to exactly the literal script, id-for-id, time-for-time.
    expect(batch[0]).toEqual(scenario.script);

    const algorithm = makeTestAlgorithm('test-algo');
    const [trialResult] = runTrialBatch(scenario, [algorithm], { maxTimeMs: 60_000 });
    const arrivalTimeById = new Map(batch[0]!.map((a) => [a.id, a.arrivalTime]));

    for (const entry of trialResult!.result.log) {
      if (entry.type !== 'passengerBoarded') continue;
      const arrivalTime = arrivalTimeById.get(entry.passengerId);
      expect(arrivalTime).toBeDefined();
      expect(entry.time).toBeGreaterThanOrEqual(arrivalTime!);
    }
  });

  it("matches each TrialRunResult against ONLY its own trialIndex's regenerated arrivals, never a different trial's — even when passenger ids repeat across trialIndex values (RandomScenario)", () => {
    // Under a RandomScenario, `generateTrialBatch` names ids "arrival-0", "arrival-1", ... fresh
    // per trial (see randomArrivals.ts), so the SAME id string exists in every trial's own
    // arrivals array, generally with a DIFFERENT arrivalTime/origin/destination each time. This is
    // exactly the risk flagged in dev_log/05_metrics.md: computeMetrics must match each
    // TrialRunResult against `batch[trialResult.trialIndex]` specifically, never flatten/merge
    // ids across trials.
    const scenario: RandomScenario = {
      type: 'random',
      building: {
        floorCount: 3,
        elevatorCount: 1,
        capacity: 4,
        floorTravelTimeMs: 500,
        doorDwellBaseMs: 500,
        doorDwellPerPassengerMultiplier: 0.5,
      },
      arrivals: { baseRatePerMinute: 60, pattern: 'random' },
      durationMs: 4000,
      trialCount: 2,
      seed: 12345,
    };

    const batch = generateTrialBatch(scenario);
    // Sanity check on the fixture itself: both trials must actually produce a nonempty, and
    // differently-sized, arrivals array for this test to mean anything (confirmed for this seed).
    expect(batch[0]!.length).toBeGreaterThan(0);
    expect(batch[1]!.length).toBeGreaterThan(0);
    expect(batch[0]!.length).not.toBe(batch[1]!.length);
    // And ids DO repeat across trials, by construction (arrival-0 exists in every trial).
    expect(batch[0]![0]!.id).toBe('arrival-0');
    expect(batch[1]![0]!.id).toBe('arrival-0');

    const algorithm = makeTestAlgorithm('test-algo');
    const trialResults = runTrialBatch(scenario, [algorithm]);
    const trial0Result = trialResults.find((r) => r.trialIndex === 0)!;

    const correct = computeTrialMetrics(trial0Result, batch[0]!, scenario.building);
    // Deliberately WRONG scoping: trial 0's own log/result, matched against trial 1's arrivals.
    const wrongTrialIndex = computeTrialMetrics(trial0Result, batch[1]!, scenario.building);

    // servedCounts.total always equals the arrivals array's own length (one record per arrival) —
    // so if scoping were wrong, this trial's reported population would silently become trial 1's
    // population instead of its own.
    expect(correct.servedCounts.total).toBe(batch[0]!.length);
    expect(wrongTrialIndex.servedCounts.total).toBe(batch[1]!.length);
    expect(correct.servedCounts.total).not.toBe(wrongTrialIndex.servedCounts.total);

    // computeMetrics's own internal scoping must match the CORRECT (same-trialIndex) computation.
    const [algorithmMetrics] = computeMetrics(trialResults, scenario);
    const computedTrial0 = algorithmMetrics!.perTrial.find((t) => t.trialIndex === 0)!;
    expect(computedTrial0).toEqual(correct);
    expect(computedTrial0).not.toEqual(wrongTrialIndex);
  });
});
