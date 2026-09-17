import { describe, expect, it } from 'vitest';
import type { BuildingConfig, ScriptedInput } from '../engine';
import { loadScriptedScenario } from './scriptedScenario';
import type { ScriptedScenario } from './types';

const building: BuildingConfig = {
  floorCount: 5,
  elevatorCount: 1,
  capacity: 4,
  floorTravelTimeMs: 2000,
  doorDwellBaseMs: 3000,
  doorDwellPerPassengerMultiplier: 0.5,
};

function makeScenario(script: ScriptedInput): ScriptedScenario {
  return { type: 'scripted', building, trialCount: 1, script };
}

describe('loadScriptedScenario', () => {
  it('returns the authored script unchanged (deep equality, no mutation, no copy)', () => {
    const script: ScriptedInput = [
      { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    ];
    const loaded = loadScriptedScenario(makeScenario(script));
    expect(loaded).toEqual(script);
    expect(loaded).toBe(script); // pure passthrough, not a defensive copy
  });

  it('throws on an out-of-bounds originFloor, identifying the offending record', () => {
    const script: ScriptedInput = [
      { id: 'bad-origin', originFloor: 9, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    ];
    expect(() => loadScriptedScenario(makeScenario(script))).toThrow(/bad-origin/);
  });

  it('throws on an out-of-bounds destinationFloor, identifying the offending record', () => {
    const script: ScriptedInput = [
      {
        id: 'bad-destination',
        originFloor: 0,
        direction: 'up',
        destinationFloor: 9,
        arrivalTime: 0,
      },
    ];
    expect(() => loadScriptedScenario(makeScenario(script))).toThrow(/bad-destination/);
  });

  it('throws when originFloor === destinationFloor, identifying the offending record', () => {
    const script: ScriptedInput = [
      { id: 'same-floor', originFloor: 2, direction: 'up', destinationFloor: 2, arrivalTime: 0 },
    ];
    expect(() => loadScriptedScenario(makeScenario(script))).toThrow(/same-floor/);
  });

  it('accepts floor indices at the exact bounds [0, floorCount]', () => {
    const script: ScriptedInput = [
      { id: 'edge', originFloor: 0, direction: 'up', destinationFloor: 5, arrivalTime: 0 },
    ];
    expect(() => loadScriptedScenario(makeScenario(script))).not.toThrow();
  });
});
