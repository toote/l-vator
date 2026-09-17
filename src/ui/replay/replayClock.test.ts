import { describe, expect, it } from 'vitest';
import { advanceSimTime, clampSimTime } from './replayClock';

describe('clampSimTime', () => {
  it('passes through a value already within range', () => {
    expect(clampSimTime(500, 1000)).toBe(500);
  });

  it('clamps to 0 for a negative value', () => {
    expect(clampSimTime(-50, 1000)).toBe(0);
  });

  it('clamps to maxMs for a value above range', () => {
    expect(clampSimTime(1500, 1000)).toBe(1000);
  });

  it('clamps to the boundary values exactly', () => {
    expect(clampSimTime(0, 1000)).toBe(0);
    expect(clampSimTime(1000, 1000)).toBe(1000);
  });
});

describe('advanceSimTime', () => {
  it('scales elapsed real time by speed', () => {
    expect(advanceSimTime(0, 100, 5, 100000)).toBe(500);
    expect(advanceSimTime(0, 100, 1, 100000)).toBe(100);
    expect(advanceSimTime(0, 100, 20, 100000)).toBe(2000);
  });

  it('adds onto the current simTime rather than replacing it', () => {
    expect(advanceSimTime(1000, 100, 5, 100000)).toBe(1500);
  });

  it('clamps at 0 (defensive -- elapsed/speed are never negative in practice)', () => {
    expect(advanceSimTime(0, -100, 5, 100000)).toBe(0);
  });

  it('clamps at the scenario’s final time rather than overshooting', () => {
    expect(advanceSimTime(9900, 1000, 5, 10000)).toBe(10000);
  });
});
