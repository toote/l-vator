import { describe, expect, it } from 'vitest';

import { computeDoorDwellMs } from './door';

describe('computeDoorDwellMs', () => {
  const base = 3000;
  const defaultMultiplier = 0.5;

  it('returns just the base for zero passengers (doors still open and close)', () => {
    expect(computeDoorDwellMs(0, base, defaultMultiplier)).toBe(3000);
  });

  it('returns just the base for a single passenger', () => {
    expect(computeDoorDwellMs(1, base, defaultMultiplier)).toBe(3000);
  });

  it('adds one multiplier increment for two passengers', () => {
    expect(computeDoorDwellMs(2, base, defaultMultiplier)).toBe(4500);
  });

  it('adds four multiplier increments for five passengers', () => {
    expect(computeDoorDwellMs(5, base, defaultMultiplier)).toBe(9000);
  });

  it('honors a non-default multiplier (not just the documented default)', () => {
    // 25% multiplier, base 4000: 1 -> 4000, 3 -> 4000 + 2*0.25*4000 = 6000
    expect(computeDoorDwellMs(1, 4000, 0.25)).toBe(4000);
    expect(computeDoorDwellMs(3, 4000, 0.25)).toBe(6000);
  });

  it('treats negative counts the same as zero (defensive)', () => {
    expect(computeDoorDwellMs(-1, base, defaultMultiplier)).toBe(3000);
  });
});
