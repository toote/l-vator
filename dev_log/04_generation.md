# Unit 04: Generation

## Objective

Deliver the call-generation layer named in `00_main.md`'s Planned Units list: a seeded, reproducible random passenger-arrival process (configurable by arrival rate, origin/destination pattern, and per-floor rate variation) and a scripted-scenario loader for hand-authored, fixed teaching scenarios — plus the shared multi-trial batch mechanism that guarantees the *same* seed sequence (and therefore byte-for-byte identical passenger arrivals) is reused across every algorithm under comparison, per `00_main.md`'s "Fairness/reproducibility" requirement.

This unit produces `ScriptedInput` (`PassengerArrival[]`) — the exact shape `runSimulation` already consumes (`src/engine/simulation.ts`) — via either random generation or scripted loading. It does **not** change the engine (Unit 02) or the algorithms (Unit 03); `Algorithm.createHook()` (Unit 03's factory contract) is consumed here exactly as specified, called once per `runSimulation` call and never reused across trials.

Scope is deliberately data/orchestration only: no metrics computation (Unit 05 aggregates across the N trial results this unit produces), no UI (Unit 06 will wire scenario config to real controls — this unit's `Scenario` config objects are what that UI will eventually construct and hand off).

## Implementation

### Directory/file layout

```
src/generation/
├── types.ts              # Scenario discriminated union (RandomScenario | ScriptedScenario),
│                           # RandomArrivalParams, ArrivalPattern, Seed
├── rng.ts                 # seedable PRNG (mulberry32), exponential-gap sampling, seed derivation
├── randomArrivals.ts      # the Poisson-process arrival generator
├── scriptedScenario.ts    # loads/validates a ScriptedScenario's fixed script (pure passthrough)
├── trialBatch.ts          # generateTrialBatch(scenario): Scenario -> ScriptedInput[] (N trials)
├── trialRunner.ts         # runTrialBatch(scenario, algorithms): runs the SAME batch against
│                           # every algorithm, calling algorithm.createHook() once per run
├── index.ts                # barrel export
├── rng.test.ts
├── randomArrivals.test.ts
├── scriptedScenario.test.ts
├── trialBatch.test.ts
├── trialRunner.test.ts
└── fairness.test.ts        # regression test: same seed sequence -> identical arrivals
                             # across two different real algorithms, end-to-end

src/scenarios/
├── upPeakDemo.ts           # minimal example scripted scenario (plain data)
└── index.ts                 # discovers scenario files via import.meta.glob (mirrors
                             # src/algorithms/index.ts's mechanism for consistency)
```

All files are plain data + pure functions, no classes — consistent with `src/engine` and `src/algorithms`'s established style. `src/generation/*` imports only from `src/engine` (types + `runSimulation`) and `src/algorithms` (`Algorithm` type, for `trialRunner.ts`).

### RNG: `rng.ts`

`Math.random()` cannot be seeded, so a small seedable PRNG is required. Proposed: **mulberry32** — a single `uint32` of state, ~5 lines, no dependency, good enough statistical quality for a teaching/toy simulation (explicitly not cryptographic, which isn't a requirement here).

```ts
export type Seed = number; // treated as an unsigned 32-bit integer

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

export function createRng(seed: Seed): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Inverse-CDF exponential sample: the standard way to draw a Poisson-process inter-arrival
 * gap (ms) given a rate expressed in events per ms. */
export function sampleExponentialGapMs(rng: Rng, ratePerMs: number): number {
  return -Math.log(1 - rng.next()) / ratePerMs;
}

/**
 * Deterministically expands one base seed into `count` child seeds. This is the mechanism that
 * makes "N seeded trials, same seed sequence across every algorithm" tractable with a single
 * number: a scenario only needs ONE seed (`Scenario.seed`) to reproduce an entire N-trial batch,
 * because the batch's own generation (trialBatch.ts) always re-derives the same N child seeds
 * from it, in the same order, regardless of which algorithm(s) later consume the resulting
 * arrivals.
 */
export function deriveTrialSeeds(baseSeed: Seed, count: number): Seed[] {
  const rng = createRng(baseSeed);
  return Array.from({ length: count }, () => Math.floor(rng.next() * 0xffffffff) >>> 0);
}
```

### Scenario shape: `types.ts`

A discriminated union on `type`, matching the project's existing style of small plain-data interfaces:

```ts
import type { BuildingConfig, FloorIndex, ScriptedInput } from '../engine';

export type ArrivalPattern = 'up-peak' | 'down-peak' | 'random';
// up-peak   = fixed-from-floor-0 ("morning rush"): everyone originates at the ground floor.
// down-peak = fixed-to-floor-0 ("evening rush"): everyone's destination is the ground floor.
// random    = origin AND destination both drawn at random (see randomArrivals.ts).

export interface RandomArrivalParams {
  /** Average arrivals per MINUTE, applied uniformly unless overridden by floorRates. */
  baseRatePerMinute: number;
  pattern: ArrivalPattern;
  /**
   * Optional per-floor override (arrivals/minute), keyed by FloorIndex. A floor not present
   * falls back to baseRatePerMinute. Only meaningful for floors the chosen pattern actually
   * generates arrivals from — see randomArrivals.ts's "generating floors" doc comment; an
   * override on a non-generating floor is a silent no-op (flagged as an open question below).
   */
  floorRates?: Partial<Record<FloorIndex, number>>;
}

export interface RandomScenario {
  type: 'random';
  building: BuildingConfig;
  arrivals: RandomArrivalParams;
  /** Simulated time window (ms) over which arrivals are generated. */
  durationMs: number;
  /** Number of seeded trials in the batch. */
  trialCount: number;
  /** The ONE seed needed to reproduce the entire N-trial batch — see deriveTrialSeeds. */
  seed: number;
}

export interface ScriptedScenario {
  type: 'scripted';
  building: BuildingConfig;
  /** Fixed, hand-authored — identical for every trial by construction (no randomness to vary). */
  script: ScriptedInput;
  trialCount: number;
}

export type Scenario = RandomScenario | ScriptedScenario;
```

### Random arrival generation: `randomArrivals.ts`

Model: each configured **generating floor** is an independent Poisson arrival process (exponential inter-arrival gaps), sampled up to `durationMs`. Which floors generate, and what a generated event's destination is, is determined by `pattern`:

| pattern      | generating floors        | destination                                  |
|--------------|---------------------------|-----------------------------------------------|
| `up-peak`    | `[0]` only                 | uniform random in `1..floorCount`             |
| `down-peak`  | `1..floorCount`            | always `0`                                    |
| `random`     | `0..floorCount` (all)       | uniform random over all floors except origin |

`direction` is always derived, never separately stored/drawn: `destinationFloor > originFloor ? 'up' : 'down'`.

```
generateRandomArrivals(building, params, durationMs, seed):
  # Validate up front, before any generation: a negative rate is a config bug, not a value to
  # silently clamp or propagate (see "Correction" note below for why either would be unsafe).
  if params.baseRatePerMinute < 0: throw Error("baseRatePerMinute must be >= 0")
  for floor, rate in params.floorRates ?? {}:
    if rate < 0: throw Error(`floorRates[${floor}] must be >= 0`)

  rng = createRng(seed)
  generatingFloors = pattern === 'up-peak'   ? [0]
                    : pattern === 'down-peak' ? [1 .. building.floorCount]
                    : /* random */              [0 .. building.floorCount]

  # Pass 1: sample arrival TIMES per generating floor, independently.
  events = []
  for floor in generatingFloors:                     # fixed iteration order: ascending floor index
    ratePerMinute = params.floorRates?.[floor] ?? params.baseRatePerMinute
    if ratePerMinute <= 0: continue    # zero/negative rate = no arrivals from this floor — see
                                         # "Correction" note below for why this guard is required,
                                         # not just an optimization
    ratePerMs = ratePerMinute / 60000
    t = 0
    while true:
      t += sampleExponentialGapMs(rng, ratePerMs)
      if t > durationMs: break
      events.push({ arrivalTime: t, originFloor: floor })

  events.sort by arrivalTime ascending (stable — ties are vanishingly unlikely with continuous
                                          gaps, but a stable sort keeps floor-ascending order as
                                          the deterministic tie-break if it ever happens)

  # Pass 2: assign destinations, iterating in FINAL sorted-by-time order (not generation order) —
  # pinned explicitly because it determines exactly which rng.next() call produces which
  # destination, which affects the exact byte-for-byte output for a given seed.
  return events.map((e, index) => {
    destinationFloor =
      pattern === 'down-peak' ? 0
      : pattern === 'up-peak'   ? uniformFloor(rng, 1, building.floorCount)
      : /* random */              uniformFloorExcluding(rng, 0, building.floorCount, e.originFloor)
    return {
      id: `arrival-${index}`,
      originFloor: e.originFloor,
      destinationFloor,
      direction: destinationFloor > e.originFloor ? 'up' : 'down',
      arrivalTime: e.arrivalTime,
    }  # PassengerArrival — origin AND destination decided together, up front, per Unit 02's
       # "Passenger destinations and reproducibility" fix. No separate destination hook exists
       # or is needed here.
  })
```

`uniformFloor(rng, min, max)` and `uniformFloorExcluding(rng, min, max, exclude)` are small pure helpers in the same file (single `rng.next()` draw each, standard index-mapping to skip the excluded value).

Rate unit is **arrivals per minute** (config-facing), converted internally to per-ms for the exponential formula — proposed because it reads naturally as a UI label ("6 arrivals/minute") and matches how elevator traffic is normally described; flagged below since `00_main.md` doesn't pin a unit and Unit 06's UI will need to display it.

**Correction (developer review, before implementation): a rate of exactly 0 would have caused an infinite loop.** `sampleExponentialGapMs(rng, ratePerMs)` computes `-Math.log(1 - rng.next()) / ratePerMs`. With `ratePerMs = 0` (a floor's effective rate, whether from `baseRatePerMinute` or a `floorRates` override, being exactly `0`), the result is `Infinity` for almost all `rng.next()` outputs — which correctly breaks the `while` loop via `t > durationMs` — **except** on the rare draw where `rng.next()` returns exactly `0`: then `1 - 0 = 1`, `Math.log(1) = 0`, and `-0 / 0 = NaN`. `t += NaN` makes `t` permanently `NaN`, and `NaN > durationMs` is always `false` — the loop never terminates. This is the same class of bug (a degenerate parameter value producing a zero/NaN step that a termination check can't catch) that already caused two real infinite-loop crashes during Units 02 and 03 (see `02_engine_done.md`'s and `03_algorithms_done.md`'s amendment notes) — worth guarding against explicitly here rather than discovering it the same way a third time. Fixed in the pseudocode above: a floor with `ratePerMinute === 0` is skipped entirely (treated as "this floor generates zero arrivals," a legitimate way to model a floor with no demand) rather than ever calling the exponential sampler with a zero rate. **Resolved by developer: a negative rate throws.** `generateRandomArrivals` validates `baseRatePerMinute` and every `floorRates` value are `>= 0` up front (before any generation), throwing a descriptive error identifying the offending value if not — a negative rate is almost certainly a config bug, and this fails loudly at the source rather than silently producing zero arrivals or (worse) propagating into the exponential formula as a negative rate (which would make `sampleExponentialGapMs` return a *negative* gap, decreasing `t` — a second, independent way this same function could have hung or produced nonsensical output).

### Scripted scenario loading: `scriptedScenario.ts`

Trivial by design — scripted scenarios are already in the exact `ScriptedInput` shape the engine consumes:

```ts
export function loadScriptedScenario(scenario: ScriptedScenario): ScriptedInput {
  validateScript(scenario.building, scenario.script); // floor bounds only, see below
  return scenario.script;
}
```

Minimal validation added (not in the original scope, but cheap and catches authoring mistakes at the source): every `originFloor`/`destinationFloor` in `scenario.script` must be within `0..scenario.building.floorCount`, and `originFloor !== destinationFloor`. Throws with a descriptive message identifying the offending record's `id` — fail fast on a bad hand-authored fixture rather than letting the engine hit an out-of-bounds `handleTravel` error deep into a run.

### Scripted scenario data: `src/scenarios/`

Plain data files, one scenario per file, each exporting `scenario: ScriptedScenario` under a uniform name — mirroring `src/algorithms`'s `export const algorithm` convention so `src/scenarios/index.ts` can discover them the same way (`import.meta.glob`), for the same reason Unit 03 adopted it: adding a scenario is "drop a file," no manual registry edit.

Minimal example, `src/scenarios/upPeakDemo.ts`:

```ts
import type { ScriptedScenario } from '../generation/types';

export const scenario: ScriptedScenario = {
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
  script: [
    { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    { id: 'p2', originFloor: 0, direction: 'up', destinationFloor: 5, arrivalTime: 1000 },
    { id: 'p3', originFloor: 3, direction: 'down', destinationFloor: 0, arrivalTime: 8000 },
  ],
};
```

### Trial batch generation: `trialBatch.ts`

```ts
export function generateTrialBatch(scenario: Scenario): ScriptedInput[] {
  if (scenario.type === 'scripted') {
    const script = loadScriptedScenario(scenario);
    return Array.from({ length: scenario.trialCount }, () => script);
    // Same array reference reused N times, deliberately: PassengerArrival records are treated
    // as immutable data throughout the engine (runSimulation never mutates the input script —
    // it copies each arrival's fields into a fresh Passenger), so aliasing is safe and avoids
    // pointless defensive copies.
  }

  const trialSeeds = deriveTrialSeeds(scenario.seed, scenario.trialCount);
  return trialSeeds.map((seed) =>
    generateRandomArrivals(scenario.building, scenario.arrivals, scenario.durationMs, seed),
  );
}
```

This is the single function that fixes the batch's arrivals once, up front, independent of any algorithm — the fairness guarantee falls directly out of calling this exactly once per batch and reusing its result across every algorithm, which `trialRunner.ts` below does.

### Trial runner: `trialRunner.ts`

```ts
import type { Algorithm } from '../algorithms/types';
import { runSimulation, type RunSimulationResult } from '../engine';
import type { Scenario } from './types';
import { generateTrialBatch } from './trialBatch';

export interface TrialRunResult {
  algorithmId: string;
  trialIndex: number;
  result: RunSimulationResult;
}

export function runTrialBatch(
  scenario: Scenario,
  algorithms: Algorithm[],
  options?: { maxTimeMs?: number },
): TrialRunResult[] {
  const batch = generateTrialBatch(scenario); // computed ONCE — shared across every algorithm
  const results: TrialRunResult[] = [];
  for (const algorithm of algorithms) {
    for (let trialIndex = 0; trialIndex < batch.length; trialIndex++) {
      const hook = algorithm.createHook(); // fresh per runSimulation call — per Unit 03's contract
      const result = runSimulation(scenario.building, batch[trialIndex], hook, options);
      results.push({ algorithmId: algorithm.id, trialIndex, result });
    }
  }
  return results;
}
```

`batch` is built once, before the algorithm loop, so `batch[trialIndex]` is the literal same array/object handed to every algorithm for that trial index — this is the concrete mechanism that makes "byte-for-byte identical arrivals no matter which algorithm consumes them" true by construction rather than by convention. See `fairness.test.ts` below for the regression test proving this holds end-to-end.

`options.maxTimeMs`, when not given by the caller, defaults inside `runTrialBatch` to a generous multiple of `scenario.durationMs` (or, for a scripted scenario, of the script's last `arrivalTime`) — large enough that a normally-quiescing run is never cut short, but still bounded so a pathological non-terminating hook fails fast rather than hanging the whole batch (same rationale Unit 02 used for `runSimulation`'s own cutoff).

**Note on scope**: this file's inclusion in Unit 04 (rather than deferring "run N trials against M algorithms" to Unit 05/06) is itself flagged as an open question below — see open question (a).

### What gets unit-tested (Vitest)

- **`rng.test.ts`**: `createRng(seed).next()` produces the same sequence for the same seed across repeated instantiations (determinism); different seeds produce different sequences; `deriveTrialSeeds(baseSeed, n)` is deterministic (same inputs -> same array, called twice) and produces pairwise-distinct seeds for a representative `n`.
- **`randomArrivals.test.ts`**:
  - Determinism: same `(building, params, durationMs, seed)` -> deep-equal `PassengerArrival[]` across repeated calls.
  - `up-peak`: every arrival has `originFloor === 0`, `destinationFloor !== 0`, `direction === 'up'`.
  - `down-peak`: every arrival has `destinationFloor === 0`, `originFloor !== 0`, `direction === 'down'`.
  - `random`: `direction` is correctly derived from origin vs. destination comparison on every record; origins and destinations are not all identical across a long-duration run (structural spread check); `originFloor !== destinationFloor` always.
  - Rate/duration correctness: for a long `durationMs`, the generated count for a given floor's process is within a statistical tolerance band of `rate * durationMs` (e.g. averaged over many seeds, since a single seed's count is itself a random variable) — a structural sanity check, not a proof of Poisson-ness.
  - Per-floor custom rate: a floor configured with a materially higher rate than `baseRatePerMinute` produces materially more arrivals from that floor than a base-rate floor, averaged over many seeds.
  - All `arrivalTime`s fall within `[0, durationMs]` and the returned array is sorted ascending by `arrivalTime`.
  - **Regression**: a rate of exactly `0` (via `baseRatePerMinute` or a `floorRates` override) terminates promptly and produces zero arrivals from that floor, run with a bounded/timed test assertion (e.g. `expect(...).resolves` under a short timeout, or a wall-clock duration assertion) so a future regression of the guard fails as a clear test failure rather than hanging the whole suite the way the pre-fix version would have.
  - A negative `baseRatePerMinute` or a negative `floorRates` entry throws a descriptive error and generates nothing.
  - A `floorRates` override on a floor the current pattern doesn't generate from (e.g. floor 3 under `up-peak`) is silently ignored — no error, and that floor still produces zero arrivals.
- **`scriptedScenario.test.ts`**: loading returns the authored script unchanged (deep equality, no mutation); an out-of-bounds floor or `originFloor === destinationFloor` in a hand-authored script throws with a message identifying the offending record.
- **`trialBatch.test.ts`**:
  - Random scenario: `generateTrialBatch(scenario)` called twice on the same scenario object produces deep-equal batches (batch-level determinism, not just per-generator).
  - Random scenario with `trialCount > 1`: distinct trials in the batch are not identical to each other (different derived seeds actually produce different arrivals).
  - Scripted scenario: batch has exactly `trialCount` entries, every one deep-equal to `scenario.script`.
- **`trialRunner.test.ts`**: `algorithm.createHook()` is called exactly once per `(algorithm, trial)` pair, never reused — asserted via a spy-wrapped `Algorithm` whose `createHook` is a `vi.fn`; `results.length === algorithms.length * scenario.trialCount`; each result's `algorithmId`/`trialIndex` matches its position.
- **`fairness.test.ts`** (the critical regression test, proving the single most fairness-critical mechanism in this unit end-to-end, not just at the unit-function level): build a `RandomScenario` with `trialCount >= 2`; call `runTrialBatch(scenario, [algorithmA, algorithmB])` using two *different* real algorithms from `src/algorithms`; for a chosen trial index K, extract the `hallCallRegistered` entries (floor, direction, time) from algorithm A's log and from algorithm B's log for that trial and assert they are identical in content and order between the two — this is the observable proof that the actual passenger arrival facts consumed for trial K were the same regardless of which algorithm ran it, even though the two algorithms' *subsequent* dispatch decisions (and therefore their full logs) are free to diverge from that point on.

### Open questions for the developer

1. ~~**Scope: trial runner ownership**~~ — **Resolved: Unit 04 owns it.** `trialRunner.ts` stays in this unit, as planned above.
2. ~~**Arrival-time stochastic model**~~ — **Accepted as proposed (no objection raised):** Poisson process / exponential inter-arrival times.
3. ~~**RNG choice**~~ — **Accepted as proposed:** mulberry32.
4. ~~**Seed-derivation scheme**~~ — **Accepted as proposed:** one `mulberry32` instance seeded with the scenario's base seed, drawing N successive outputs as child seeds.
5. ~~**Rate unit**~~ — **Accepted as proposed:** arrivals-per-minute.
6. ~~**Per-floor rate overrides on a pattern's non-generating floors**~~ — **Resolved: silent, documented no-op.** A `floorRates` entry for a floor the current pattern never generates from (e.g. floor 3 under `up-peak`) is simply ignored, not an error.
7. ~~**Destination selection for the `random` pattern**~~ — **Accepted as proposed:** uniform-random over all floors except the origin, no OD matrix.
8. ~~**Arrival horizon model**~~ — **Resolved: duration-based only.** `durationMs` (variable resulting passenger count) is the only mode; a fixed-count mode is deferred until a concrete need arises.
9. ~~**`trialCount > 1` on a `ScriptedScenario`**~~ — **Accepted as proposed:** stays legal (N identical trials), not forced to 1 or rejected.
10. ~~**Scenario/scripted-file validation scope**~~ — **Accepted as proposed:** minimal floor-bounds + origin≠destination validation only.
11. ~~**Scenario discovery mechanism**~~ — **Accepted as proposed:** `src/scenarios/index.ts` mirrors `src/algorithms/index.ts`'s `import.meta.glob` pattern.

## AI Interactions

Implemented the full unit exactly as specified: `src/generation/types.ts`, `rng.ts`, `randomArrivals.ts`, `scriptedScenario.ts`, `trialBatch.ts`, `trialRunner.ts`, `index.ts`, plus `src/scenarios/upPeakDemo.ts` and `src/scenarios/index.ts`, and six test files (`rng.test.ts`, `randomArrivals.test.ts`, `scriptedScenario.test.ts`, `trialBatch.test.ts`, `trialRunner.test.ts`, `fairness.test.ts` — 31 new tests). No classes anywhere. The mulberry32 RNG, the two-pass `generateRandomArrivals` algorithm (including its exact pinned RNG draw ordering — Pass 1 samples all arrival times per generating floor in ascending floor order, including the one "overshoot" draw per floor that pushes past `durationMs`; Pass 2 assigns destinations by iterating the final time-sorted event list, one `rng.next()` draw per event), the rate validation/zero-skip rules, and the trial-batch/runner mechanics are all implemented verbatim from the plan's pseudocode. `while (true)` in the plan's pseudocode was written as `for (;;)` in the actual code — purely to satisfy ESLint's `no-constant-condition` rule, not a behavioral change. `npm run lint`, `npm run format`/`format:check`, `npm run test` (80/80 passing — 48 pre-existing + 31 new + 1 added during the Unit 02 door-dwell amendment (see below) — in well under half a second), and `npm run build` (`tsc -b`, including a forced cache-cleared full recheck, + `vite build`) all pass cleanly under strict TypeScript, no `any`, no non-null assertions.

**`src/scenarios/index.ts`'s exclusion list is intentionally shorter than `src/algorithms/index.ts`'s.** The plan says it "mirrors `src/algorithms/index.ts`'s mechanism," and the mechanism (eager `import.meta.glob`, filter to the expected exported shape) is copied exactly — but `src/algorithms/index.ts` additionally excludes `types.ts` and `shared.ts`, which are that directory's own shared helper files. `src/scenarios/` has no equivalent files (its shared types live in `src/generation/types.ts`, outside this directory entirely), so the exclusion list here only needs `!./index.ts` and `!./*.test.ts`. This is a direct, faithful application of "mirror the mechanism," not a deviation from it — the pattern is identical, just applied to what's actually in the directory.

### A significant, pre-existing bug found while building `fairness.test.ts` — RESOLVED

**Resolved by developer, as a Unit 02 amendment, immediately after this unit's implementation was reviewed** — see `dev_log/02_engine_done.md`'s "Amendment (during Unit 04 review)" section for the fix (`computeDoorDwellMs` now always costs at least `base`, closing the whole zero-transaction-stop bug class at its source, not just the capacity-exhaustion case). `fairness.test.ts`'s conservative scenario parameters (chosen below to avoid the bug) were left as-is rather than loosened, since they remain a perfectly reasonable scenario regardless. The original finding is preserved below for the record.

Driving the real `fcfsNearestCar` and `scanLook` algorithms (from Unit 03) through the real `runSimulation` (from Unit 02) with a moderately busy `RandomScenario` reproduced a genuine infinite loop — the Vitest worker OOM-crashed (`FATAL ERROR: ... JavaScript heap out of memory`, worker exited via `SIGABRT`), the exact same failure signature `03_algorithms_done.md` documents for the boarding-direction bug found during that unit. Root-caused via an instrumented reproduction outside the normal test suite (deleted before finalizing this unit, per the instruction not to leave stray debug files): a **fully-loaded elevator** (`capacityRemaining === 0`) commanded to `'stop'` at a floor whose only active hall call is a *pickup* (none of that elevator's onboard passengers has that floor as a destination) boards nobody (capacity exhausted) and alights nobody (no matching drop-off). `computeDoorDwellMs` returns `0` for a zero-total stop, so the engine reschedules the next decision at the **identical** simulated timestamp; since nothing about the elevator's state changed, the algorithm issues the identical `'stop'` decision again, forever, with time never advancing — the exact "degenerate parameter producing a zero/NaN step a termination check can't catch" pattern the task briefing flagged to watch for, except here it's a pre-existing gap in Units 02/03's code rather than something introduced in this unit's own generator.

Confirmed via a seed sweep (hundreds of seeds) against the real algorithms: this reproduces with `fcfsNearestCar` and `scanLook` (and, less frequently, `nearestCarDirectional`) whenever building capacity/elevator count are undersized relative to arrival volume — not a rare edge case; at moderate load (`capacity: 6`, `elevatorCount: 2`, a few dozen passengers per trial) it hit roughly 20% of random seeds, and at higher load it hit **100%** of seeds tried. This is a real gap in the existing engine+algorithm code, not something this unit introduced, and **per this unit's explicit scope boundary, `src/engine/` and `src/algorithms/` were not touched.** Instead, `fairness.test.ts`'s own scenario parameters were deliberately chosen (`elevatorCount: 3`, `capacity: 16` against a modest, short-duration arrival rate) and verified safe by sweeping hundreds of seeds before locking in the two used seeds. Full detail is in `fairness.test.ts`'s own header comment and in `04_generation_test.md`'s "Latent bug found" section. **Resolved — see the note above.**

### A second, related scenario-design subtlety found while building `fairness.test.ts` (design clarification, not a bug)

`SimEventLogEntry`'s `hallCallRegistered` entry (built in `simulation.ts`'s `handlePassengerArrival`) is only logged when a `(floor, direction)` call transitions from *inactive* to *active* — a second passenger arriving at an already-active call produces no second log entry, by design (that's what "presence, not count" means for a hall call). Since exactly *when* a call clears (and can next re-activate) depends on how fast a given algorithm dispatches an elevator to it, two different algorithms can legitimately produce different `hallCallRegistered` counts/timings for the **identical** underlying `PassengerArrival` script whenever two arrivals share a `(floor, direction)` pair while the first is still waiting. This is not a violation of the fairness guarantee — `trialBatch.test.ts` already verifies directly that the actual input script handed to every algorithm is byte-for-byte identical — but it does mean `hallCallRegistered` facts are not automatically a valid "same arrival facts" signal for an arbitrary busy scenario, which is what the plan's own pseudocode for `fairness.test.ts` implicitly assumed. Resolved by construction rather than by working around it: `fairness.test.ts`'s two scenarios were chosen so their generated batches have **zero** `(floor, direction)` collisions (verified directly against the real generator for the exact seeds shipped, not just probabilistically likely), which makes every arrival's call transition inactive→active by construction and therefore makes `hallCallRegistered` a deterministic, algorithm-independent 1:1 reflection of the input — restoring exactly the observable proof the plan intended, on scenario parameters chosen to make that provable rather than merely probable.

Both of the above were discovered and root-caused specifically because this unit's fairness test drives the real engine and real algorithms end-to-end with real random-generated volume — precisely the kind of integration surface the previous two units' own bugs were also found on (Unit 03's comparative test surfaced Unit 02's boarding-direction bug the same way). No other deviations from the approved plan; every open question was already resolved before implementation per the plan's own text, and none needed revisiting during coding.

## Files Modified

Created:
- `src/generation/types.ts`
- `src/generation/rng.ts`
- `src/generation/randomArrivals.ts`
- `src/generation/scriptedScenario.ts`
- `src/generation/trialBatch.ts`
- `src/generation/trialRunner.ts`
- `src/generation/index.ts`
- `src/generation/rng.test.ts`
- `src/generation/randomArrivals.test.ts`
- `src/generation/scriptedScenario.test.ts`
- `src/generation/trialBatch.test.ts`
- `src/generation/trialRunner.test.ts`
- `src/generation/fairness.test.ts`
- `src/scenarios/upPeakDemo.ts`
- `src/scenarios/index.ts`
- `dev_log/04_generation_test.md`

Modified:
- `dev_log/04_generation.md` (this file — AI Interactions, Files Modified, Status)

Not modified, per this unit's explicit scope boundary, despite a real bug being found in them (see "AI Interactions" above): `src/engine/*`, `src/algorithms/*`.

## Status: Complete
