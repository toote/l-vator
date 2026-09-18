import { describe, expect, it } from 'vitest';
import type { BuildingConfig } from '../engine';
import { generateTrialBatch } from './trialBatch';
import type { RandomScenario, ScriptedScenario } from './types';

const building: BuildingConfig = {
  floorCount: 5,
  elevatorCount: 2,
  capacity: 4,
  floorTravelTimeMs: 2000,
  doorDwellBaseMs: 3000,
  doorDwellPerPassengerMultiplier: 0.5,
  idleReturnThresholdMs: 30000,
};

describe('generateTrialBatch', () => {
  it('random scenario: the same scenario object produces deep-equal batches across repeated calls', () => {
    const scenario: RandomScenario = {
      type: 'random',
      building,
      arrivals: { baseRatePerMinute: 8, pattern: 'random' },
      durationMs: 120000,
      trialCount: 4,
      seed: 123,
    };
    expect(generateTrialBatch(scenario)).toEqual(generateTrialBatch(scenario));
  });

  it('random scenario with trialCount > 1: distinct trials are not identical to each other', () => {
    const scenario: RandomScenario = {
      type: 'random',
      building,
      arrivals: { baseRatePerMinute: 10, pattern: 'random' },
      durationMs: 120000,
      trialCount: 3,
      seed: 42,
    };
    const batch = generateTrialBatch(scenario);
    expect(batch.length).toBe(3);
    expect(batch[0]).not.toEqual(batch[1]);
    expect(batch[1]).not.toEqual(batch[2]);
    expect(batch[0]).not.toEqual(batch[2]);
  });

  it('scripted scenario: batch has exactly trialCount entries, every one deep-equal to scenario.script', () => {
    const scenario: ScriptedScenario = {
      type: 'scripted',
      building,
      trialCount: 3,
      script: [{ id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 }],
    };
    const batch = generateTrialBatch(scenario);
    expect(batch.length).toBe(3);
    for (const trial of batch) {
      expect(trial).toEqual(scenario.script);
    }
  });
});
