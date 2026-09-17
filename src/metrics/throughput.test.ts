import { describe, expect, it } from 'vitest';
import { computeThroughputPerHour } from './throughput';

describe('computeThroughputPerHour', () => {
  it('computes an exact hand-checked division', () => {
    // 10 served in 30 simulated minutes (1,800,000ms) -> 20 per simulated hour.
    expect(computeThroughputPerHour(10, 1_800_000)).toBe(20);
  });

  it('handles a non-round division exactly', () => {
    // 3 served in 45 simulated minutes (2,700,000ms) -> 4/hour.
    expect(computeThroughputPerHour(3, 2_700_000)).toBe(4);
  });

  it('returns 0 (not null) when nobody was served but time elapsed', () => {
    expect(computeThroughputPerHour(0, 1_000_000)).toBe(0);
  });

  it('returns null (not NaN/Infinity) when finalTimeMs === 0', () => {
    expect(computeThroughputPerHour(0, 0)).toBeNull();
    expect(computeThroughputPerHour(5, 0)).toBeNull();
  });
});
