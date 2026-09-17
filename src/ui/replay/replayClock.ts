// Pure simTime advance/clamp math for replay playback. See dev_log/07_results.md, "Replay
// animation mechanics" and "Playback controls". No DOM -- consistent with this project's
// established split between pure logic and DOM-touching files.

/** Speed options offered by the playback speed selector. */
export const SPEED_OPTIONS: readonly number[] = [1, 5, 10, 20];

/** 5x default -- at 1x, this project's default 5-minute scenario would take 5 real minutes to
 * watch in full, too slow for actually validating algorithm behavior (see 07_results.md,
 * "Playback controls"). */
export const DEFAULT_SPEED = 5;

/** Clamps a simulated-time value to [0, maxMs]. */
export function clampSimTime(ms: number, maxMs: number): number {
  return Math.min(Math.max(ms, 0), maxMs);
}

/**
 * Advances simTimeMs by `elapsedRealMs` of real time at `speed`x, clamped to [0, maxMs]. Used by
 * replayControls.ts's own requestAnimationFrame loop every frame while playing.
 */
export function advanceSimTime(
  currentMs: number,
  elapsedRealMs: number,
  speed: number,
  maxMs: number,
): number {
  return clampSimTime(currentMs + elapsedRealMs * speed, maxMs);
}
