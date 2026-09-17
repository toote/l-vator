import { describe, expect, it } from 'vitest';
import type { ScriptedScenario } from '../generation';
import { buildScenario } from './buildScenario';
import type { ConfigDraft } from './types';

function randomDraft(overrides: Partial<ConfigDraft> = {}): ConfigDraft {
  return {
    mode: 'random',
    building: {
      floorCount: 5,
      elevatorCount: 2,
      capacity: 8,
      floorTravelTimeMs: 2000,
      doorDwellBaseMs: 3000,
      doorDwellPerPassengerMultiplier: 0.5,
    },
    arrivals: {
      baseRatePerMinute: 6,
      pattern: 'up-peak',
      floorRates: {},
    },
    durationMinutes: 5,
    seed: 42,
    trialCount: 10,
    scriptedScenario: null,
    ...overrides,
  };
}

const exampleScriptedScenario: ScriptedScenario = {
  type: 'scripted',
  building: {
    floorCount: 5,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 2000,
    doorDwellBaseMs: 3000,
    doorDwellPerPassengerMultiplier: 0.5,
  },
  trialCount: 1,
  script: [{ id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 }],
};

describe('buildScenario', () => {
  it('builds a RandomScenario from a random-mode draft, with no floorRates when none entered', () => {
    const draft = randomDraft();

    expect(buildScenario(draft)).toEqual({
      type: 'random',
      building: draft.building,
      arrivals: { baseRatePerMinute: 6, pattern: 'up-peak' },
      durationMs: 5 * 60000,
      trialCount: 10,
      seed: 42,
    });
  });

  it('drops an entered rate for a floor the pattern does not generate from (up-peak generates only floor 0)', () => {
    const draft = randomDraft({
      arrivals: { baseRatePerMinute: 6, pattern: 'up-peak', floorRates: { 0: 9, 3: 99 } },
    });

    const scenario = buildScenario(draft);
    expect(scenario.type).toBe('random');
    if (scenario.type === 'random') {
      expect(scenario.arrivals.floorRates).toEqual({ 0: 9 });
    }
  });

  it('keeps an entered rate for any floor under the random pattern (all floors generate)', () => {
    const draft = randomDraft({
      building: {
        floorCount: 3,
        elevatorCount: 2,
        capacity: 8,
        floorTravelTimeMs: 2000,
        doorDwellBaseMs: 3000,
        doorDwellPerPassengerMultiplier: 0.5,
      },
      arrivals: { baseRatePerMinute: 6, pattern: 'random', floorRates: { 2: 4 } },
    });

    const scenario = buildScenario(draft);
    expect(scenario.type).toBe('random');
    if (scenario.type === 'random') {
      expect(scenario.arrivals.floorRates).toEqual({ 2: 4 });
    }
  });

  it('drops every entered rate under down-peak for floor 0 (down-peak never generates from floor 0)', () => {
    const draft = randomDraft({
      arrivals: { baseRatePerMinute: 6, pattern: 'down-peak', floorRates: { 0: 9, 2: 4 } },
    });

    const scenario = buildScenario(draft);
    expect(scenario.type).toBe('random');
    if (scenario.type === 'random') {
      expect(scenario.arrivals.floorRates).toEqual({ 2: 4 });
    }
  });

  it('builds a ScriptedScenario from a scripted-mode draft, splicing in the UI trial count', () => {
    const draft = randomDraft({
      mode: 'scripted',
      scriptedScenario: exampleScriptedScenario,
      trialCount: 7,
    });

    expect(buildScenario(draft)).toEqual({ ...exampleScriptedScenario, trialCount: 7 });
  });

  it('leaves the stored scripted scenario building/script untouched', () => {
    const draft = randomDraft({
      mode: 'scripted',
      scriptedScenario: exampleScriptedScenario,
      trialCount: 7,
    });

    const scenario = buildScenario(draft);
    expect(scenario.type).toBe('scripted');
    if (scenario.type === 'scripted') {
      expect(scenario.building).toEqual(exampleScriptedScenario.building);
      expect(scenario.script).toBe(exampleScriptedScenario.script);
    }
  });

  it('throws a clear error when scripted mode has no scenario selected', () => {
    const draft = randomDraft({ mode: 'scripted', scriptedScenario: null });

    expect(() => buildScenario(draft)).toThrow(/no example scenario/i);
  });
});
