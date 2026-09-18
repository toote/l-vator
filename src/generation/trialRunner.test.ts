import { describe, expect, it, vi } from 'vitest';
import type { Algorithm } from '../algorithms/types';
import type { BuildingConfig, DispatchAction, DispatchHook, DispatchSnapshot } from '../engine';
import { runTrialBatch } from './trialRunner';
import type { ScriptedScenario } from './types';

const building: BuildingConfig = {
  floorCount: 3,
  elevatorCount: 1,
  capacity: 4,
  floorTravelTimeMs: 500,
  doorDwellBaseMs: 500,
  doorDwellPerPassengerMultiplier: 0.5,
  idleReturnThresholdMs: 30000,
};

function makeNoOpHook(): DispatchHook {
  return (snapshot: DispatchSnapshot): DispatchAction[] =>
    snapshot.elevators.map((elevator) => ({ type: 'idle', elevatorId: elevator.id }));
}

interface SpyAlgorithm {
  algorithm: Algorithm;
  createHookSpy: ReturnType<typeof vi.fn>;
}

function makeSpyAlgorithm(id: string): SpyAlgorithm {
  const createHookSpy = vi.fn(() => makeNoOpHook());
  return {
    algorithm: { id, name: id, createHook: createHookSpy },
    createHookSpy,
  };
}

function makeScenario(trialCount: number): ScriptedScenario {
  return {
    type: 'scripted',
    building,
    trialCount,
    script: [{ id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 0 }],
  };
}

describe('runTrialBatch', () => {
  it('calls algorithm.createHook() exactly once per (algorithm, trial) pair, never reused', () => {
    const scenario = makeScenario(3);
    const a = makeSpyAlgorithm('algo-a');
    const b = makeSpyAlgorithm('algo-b');

    runTrialBatch(scenario, [a.algorithm, b.algorithm], { maxTimeMs: 60000 });

    expect(a.createHookSpy).toHaveBeenCalledTimes(3);
    expect(b.createHookSpy).toHaveBeenCalledTimes(3);
  });

  it('results.length === algorithms.length * scenario.trialCount, and each result matches its position', () => {
    const scenario = makeScenario(2);
    const a = makeSpyAlgorithm('algo-a');
    const b = makeSpyAlgorithm('algo-b');

    const results = runTrialBatch(scenario, [a.algorithm, b.algorithm], { maxTimeMs: 60000 });

    expect(results.length).toBe(4);
    expect(results[0]).toMatchObject({ algorithmId: 'algo-a', trialIndex: 0 });
    expect(results[1]).toMatchObject({ algorithmId: 'algo-a', trialIndex: 1 });
    expect(results[2]).toMatchObject({ algorithmId: 'algo-b', trialIndex: 0 });
    expect(results[3]).toMatchObject({ algorithmId: 'algo-b', trialIndex: 1 });
  });

  it('falls back to a generous default maxTimeMs when options are omitted, without hanging', () => {
    const scenario = makeScenario(1);
    const a = makeSpyAlgorithm('algo-a');
    const results = runTrialBatch(scenario, [a.algorithm]);
    expect(results.length).toBe(1);
  });
});
