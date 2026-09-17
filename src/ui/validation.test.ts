import { describe, expect, it } from 'vitest';
import type { ScriptedScenario } from '../generation';
import type { AppState, ConfigDraft } from './types';
import { validate } from './validation';

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
    arrivals: { baseRatePerMinute: 6, pattern: 'up-peak', floorRates: {} },
    durationMinutes: 5,
    seed: 42,
    trialCount: 10,
    scriptedScenario: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    config: randomDraft(),
    selectedAlgorithmIds: ['fcfs-nearest-car'],
    run: { status: 'idle' },
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
  script: [],
};

describe('validate', () => {
  it('passes for a well-formed random-mode draft', () => {
    expect(validate(makeState())).toBeNull();
  });

  it('fails when no algorithm is selected', () => {
    expect(validate(makeState({ selectedAlgorithmIds: [] }))).toMatch(/algorithm/i);
  });

  it('fails when a numeric building field is NaN (blank input)', () => {
    const config = randomDraft();
    config.building.elevatorCount = NaN;
    expect(validate(makeState({ config }))).toMatch(/elevator/i);
  });

  it('fails when the arrival rate is NaN', () => {
    const config = randomDraft();
    config.arrivals.baseRatePerMinute = NaN;
    expect(validate(makeState({ config }))).toMatch(/arrival rate/i);
  });

  it('fails when seed is NaN', () => {
    const config = randomDraft();
    config.seed = NaN;
    expect(validate(makeState({ config }))).toMatch(/seed/i);
  });

  it('fails when floorCount is 0 -- the Correction note minimum-1 guard', () => {
    const config = randomDraft();
    config.building.floorCount = 0;
    expect(validate(makeState({ config }))).toMatch(/at least 1/i);
  });

  it('fails when floorCount is negative', () => {
    const config = randomDraft();
    config.building.floorCount = -3;
    expect(validate(makeState({ config }))).toMatch(/at least 1/i);
  });

  it('passes for a well-formed scripted-mode draft', () => {
    const config = randomDraft({ mode: 'scripted', scriptedScenario: exampleScriptedScenario });
    expect(validate(makeState({ config }))).toBeNull();
  });

  it('fails in scripted mode when no scenario is selected', () => {
    const config = randomDraft({ mode: 'scripted', scriptedScenario: null });
    expect(validate(makeState({ config }))).toMatch(/scenario/i);
  });

  it('does not apply the random-mode floorCount check in scripted mode', () => {
    // Scripted mode's own building.floorCount could technically be anything the example author
    // wrote -- validate() should not reject a scripted draft over the RANDOM-mode config's
    // (unused, still-default) floorCount.
    const config = randomDraft({ mode: 'scripted', scriptedScenario: exampleScriptedScenario });
    config.building.floorCount = 0;
    expect(validate(makeState({ config }))).toBeNull();
  });
});
