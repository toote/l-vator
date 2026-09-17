// Small, genuinely repeated pure helpers shared by 2+ algorithms — not a home for algorithm
// logic itself. See dev_log/03_algorithms.md, "Shared helpers (shared.ts)".

import type { Direction, FloorIndex } from '../engine';

/** The direction of travel from `from` to `to`, or `null` if they're the same floor. */
export function directionFrom(from: FloorIndex, to: FloorIndex): Direction | null {
  if (to === from) return null;
  return to > from ? 'up' : 'down';
}

/** Absolute floor distance between two floors. */
export function distance(a: FloorIndex, b: FloorIndex): number {
  return Math.abs(a - b);
}
