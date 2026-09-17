// The Poisson-process random arrival generator. See dev_log/04_generation.md, "Random arrival
// generation: randomArrivals.ts" — this is a direct implementation of that plan's pseudocode,
// including its exact two-pass structure and RNG draw ordering, which are pinned explicitly
// because they determine the byte-for-byte deterministic output for a given seed.
//
// Model: each configured GENERATING floor is an independent Poisson arrival process (exponential
// inter-arrival gaps), sampled up to `durationMs`. Which floors generate, and what a generated
// event's destination is, is determined by `pattern`:
//
//   pattern      generating floors        destination
//   up-peak      [0] only                 uniform random in 1..floorCount
//   down-peak    1..floorCount            always 0
//   random       0..floorCount (all)      uniform random over all floors except origin
//
// `direction` is always derived, never separately stored/drawn: destinationFloor > originFloor
// ? 'up' : 'down'.

import type { BuildingConfig, Direction, FloorIndex, PassengerArrival } from '../engine';
import { createRng, sampleExponentialGapMs, type Rng, type Seed } from './rng';
import type { ArrivalPattern, RandomArrivalParams } from './types';

interface TimedEvent {
  arrivalTime: number;
  originFloor: FloorIndex;
}

/** Which floors independently generate arrivals under a given pattern. Ascending order. */
function generatingFloors(pattern: ArrivalPattern, floorCount: number): FloorIndex[] {
  if (pattern === 'up-peak') return [0];
  if (pattern === 'down-peak') {
    return Array.from({ length: floorCount }, (_, index) => index + 1);
  }
  return Array.from({ length: floorCount + 1 }, (_, index) => index);
}

/** Uniform-random integer floor in [min, max] inclusive. Single rng.next() draw. */
function uniformFloor(rng: Rng, min: number, max: number): FloorIndex {
  const span = max - min + 1;
  return min + Math.floor(rng.next() * span);
}

/**
 * Uniform-random integer floor in [min, max] inclusive, excluding `exclude`. Single rng.next()
 * draw via standard index-mapping: draw from a span one slot narrower than the full range
 * (since `exclude` is removed), then shift draws at or past `exclude` up by one to skip it.
 */
function uniformFloorExcluding(
  rng: Rng,
  min: number,
  max: number,
  exclude: FloorIndex,
): FloorIndex {
  const span = max - min; // one fewer than the full [min, max] span, since exclude is removed
  const draw = min + Math.floor(rng.next() * span);
  return draw >= exclude ? draw + 1 : draw;
}

/** Validates rates up front, before any generation — a negative rate is a config bug, not a
 * value to silently clamp or propagate. See dev_log/04_generation.md's "Correction" note for why
 * propagating a negative rate into sampleExponentialGapMs would be independently unsafe (it
 * would yield a negative inter-arrival gap, decreasing `t`).
 */
function validateRates(params: RandomArrivalParams): void {
  if (params.baseRatePerMinute < 0) {
    throw new Error(`baseRatePerMinute must be >= 0, got ${params.baseRatePerMinute}`);
  }
  for (const [floor, rate] of Object.entries(params.floorRates ?? {})) {
    if (rate !== undefined && rate < 0) {
      throw new Error(`floorRates[${floor}] must be >= 0, got ${rate}`);
    }
  }
}

export function generateRandomArrivals(
  building: BuildingConfig,
  params: RandomArrivalParams,
  durationMs: number,
  seed: Seed,
): PassengerArrival[] {
  validateRates(params);

  const rng = createRng(seed);
  const floors = generatingFloors(params.pattern, building.floorCount);

  // Pass 1: sample arrival TIMES per generating floor, independently, in fixed ascending
  // floor-index order.
  const events: TimedEvent[] = [];
  for (const floor of floors) {
    const ratePerMinute = params.floorRates?.[floor] ?? params.baseRatePerMinute;
    // Zero (or negative — already rejected above, so effectively just zero here) effective rate
    // means "this floor generates zero arrivals" — a legitimate way to model no demand — and is
    // skipped entirely rather than ever calling the exponential sampler with a zero rate. See
    // rng.ts's sampleExponentialGapMs doc comment for why calling it with rate 0 would risk an
    // infinite loop via NaN propagation.
    if (ratePerMinute <= 0) continue;

    const ratePerMs = ratePerMinute / 60000;
    let t = 0;
    for (;;) {
      t += sampleExponentialGapMs(rng, ratePerMs);
      if (t > durationMs) break;
      events.push({ arrivalTime: t, originFloor: floor });
    }
  }

  // Stable sort by arrival time ascending — ties are vanishingly unlikely with continuous gaps,
  // but a stable sort keeps floor-ascending order as the deterministic tie-break if it ever
  // happens. (Array.prototype.sort is specified as stable.)
  events.sort((a, b) => a.arrivalTime - b.arrivalTime);

  // Pass 2: assign destinations, iterating in FINAL sorted-by-time order (not generation order)
  // — pinned explicitly because it determines exactly which rng.next() call produces which
  // destination, which affects the exact byte-for-byte output for a given seed.
  return events.map((event, index) => {
    const destinationFloor =
      params.pattern === 'down-peak'
        ? 0
        : params.pattern === 'up-peak'
          ? uniformFloor(rng, 1, building.floorCount)
          : uniformFloorExcluding(rng, 0, building.floorCount, event.originFloor);
    const direction: Direction = destinationFloor > event.originFloor ? 'up' : 'down';
    return {
      id: `arrival-${index}`,
      originFloor: event.originFloor,
      destinationFloor,
      direction,
      arrivalTime: event.arrivalTime,
    };
    // PassengerArrival — origin AND destination decided together, up front, per Unit 02's
    // "Passenger destinations and reproducibility" fix. No separate destination hook exists or
    // is needed here.
  });
}
