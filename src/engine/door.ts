// Pure door-dwell-time formula. See dev_log/02_engine.md, "Door-dwell formula".

/**
 * The first passenger (boarding or alighting, combined) costs `base`; each additional passenger
 * adds `perPassengerMultiplier * base`. With the documented default of a 50% multiplier and e.g.
 * a 3000ms base: 1 person -> 3000ms, 2 -> 4500ms, 5 -> 9000ms.
 *
 * Zero (or negative, treated the same) passengers still costs `base`, NOT zero: this function's
 * only caller (`handleStop` in simulation.ts) is only ever invoked once the doors have already
 * physically opened, and doors still take time to open and close even when nobody ends up
 * boarding or alighting there (e.g. a full elevator stopping at a floor with only a pickup call
 * it has no room for). Returning 0 for that case previously caused a real, repeatable infinite
 * loop: a zero-ms dwell re-fires the identical decision at the identical timestamp forever, with
 * no time advancement — found via Unit 04's fairness testing against real algorithms under
 * realistic passenger load; see dev_log/02_engine_done.md's amendment for this fix. (A
 * `doorDwellBaseMs` of exactly 0 in the building config would still reproduce a zero-ms dwell
 * here and remains a theoretical residual risk — worth validating against once a unit constructs
 * `BuildingConfig` from untrusted/UI input.)
 */
export function computeDoorDwellMs(
  totalBoardingAndAlighting: number,
  base: number,
  perPassengerMultiplier: number,
): number {
  const additional = Math.max(0, totalBoardingAndAlighting - 1);
  return base + perPassengerMultiplier * base * additional;
}
