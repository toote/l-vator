// Pure door-dwell-time formula. See dev_log/02_engine.md, "Door-dwell formula".

/**
 * The first passenger (boarding or alighting, combined) costs `base`; each additional passenger
 * adds `perPassengerMultiplier * base`. With the documented default of a 50% multiplier and e.g.
 * a 3000ms base: 1 person -> 3000ms, 2 -> 4500ms, 5 -> 9000ms.
 */
export function computeDoorDwellMs(
  totalBoardingAndAlighting: number,
  base: number,
  perPassengerMultiplier: number,
): number {
  if (totalBoardingAndAlighting <= 0) return 0;
  return base + perPassengerMultiplier * base * (totalBoardingAndAlighting - 1);
}
