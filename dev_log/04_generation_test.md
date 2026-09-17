# Unit 04: Generation - Test Instructions

## Test Objectives

Verify that the call-generation layer under `src/generation/` correctly implements the approved plan (`04_generation.md`):

- **`rng.ts`**: a deterministic, seedable PRNG (mulberry32) and its two derived helpers (`sampleExponentialGapMs`, `deriveTrialSeeds`) — determinism and seed-derivation are the foundation everything else in this unit depends on.
- **`randomArrivals.ts`**: the two-pass Poisson-process arrival generator — per-pattern generating floors and destination rules (`up-peak`/`down-peak`/`random`), the exact RNG draw ordering pinned by the plan, rate validation (throw on negative, skip on zero), and specifically the **rate-of-exactly-0 regression** (the pre-implementation infinite-loop/NaN bug fixed in the plan before coding started).
- **`scriptedScenario.ts`**: pure passthrough of a hand-authored script, plus floor-bounds/origin≠destination validation.
- **`trialBatch.ts`**: fixes a scenario's arrivals for a whole N-trial batch, once, independent of any algorithm — the mechanism the fairness guarantee is built on.
- **`trialRunner.ts`**: runs the same batch against every algorithm under comparison, calling `algorithm.createHook()` exactly once per `(algorithm, trial)` pair.
- **`fairness.test.ts`**: the critical end-to-end regression — two different real algorithms from `src/algorithms`, run through the real engine on the same generated batch, must see byte-for-byte identical `hallCallRegistered` facts for a given trial.
- **`src/scenarios/`**: the scenario discovery mechanism (`import.meta.glob`, mirroring `src/algorithms/index.ts`) and the minimal example scripted scenario, `upPeakDemo.ts`.

## Manual Tests

None. Like Units 02 and 03, this unit is headless data/orchestration logic with no UI (Unit 06 will eventually wire scenario config to real controls) — there is nothing to click through. All verification is automated.

## Automated Tests

Run via `npm run test` (Vitest). **80 tests across 15 files, all passing** — 48 pre-existing from Units 02/03 (24 engine + 23 algorithms + 1 scaffolding placeholder), **31 new for this unit**, plus **1 more added to `capacity.test.ts` during the Unit 02 door-dwell amendment triggered by this unit's findings (see below)**, completing in well under a second (no hangs — see the "Latent bug found" note below for why that's a meaningful signal here, not just a formality).

- **`src/generation/rng.test.ts`** (6 tests)
  - `createRng(seed).next()` produces the same sequence for the same seed across repeated instantiations, and a different sequence for a different seed; all draws fall in `[0, 1)`.
  - `deriveTrialSeeds(baseSeed, n)` is deterministic (same inputs -> same array across repeated calls), produces pairwise-distinct seeds for a representative count (50), and a different sequence for a different base seed.

- **`src/generation/randomArrivals.test.ts`** (12 tests)
  - Determinism: same `(building, params, durationMs, seed)` -> deep-equal output across repeated calls.
  - `up-peak`: every arrival originates at floor 0, has a non-zero destination, direction `up`.
  - `down-peak`: every arrival has destination floor 0, non-zero origin, direction `down`.
  - `random`: direction always correctly derived from origin/destination comparison; `originFloor !== destinationFloor` always; origins/destinations spread across more than one floor over a long run.
  - Rate/duration correctness: average generated count over 40 seeds tracks `rate * duration` within a ±20% statistical tolerance band.
  - Per-floor custom rate: a floor with a materially higher override rate produces more than double the arrivals of a base-rate floor, averaged over 30 seeds.
  - All `arrivalTime`s fall within `[0, durationMs]`, and the returned array is sorted ascending.
  - **REGRESSION**: a rate of exactly `0` (`baseRatePerMinute`) terminates in well under a second and produces zero arrivals — a bounded, timed assertion guarding the exact pre-implementation NaN/infinite-loop bug described in the approved plan's "Correction" note.
  - **REGRESSION**: a `floorRates` override of exactly `0` on one floor skips only that floor (other generating floors still produce arrivals) without hanging.
  - A negative `baseRatePerMinute` throws a descriptive error identifying the field.
  - A negative `floorRates` entry throws a descriptive error identifying the offending floor.
  - A `floorRates` override on a floor the current pattern doesn't generate from (`up-peak`, override on floor 3) is a silent no-op — no error, zero arrivals from that floor.

- **`src/generation/scriptedScenario.test.ts`** (5 tests)
  - Returns the authored script unchanged — deep-equal AND reference-equal (pure passthrough, no defensive copy).
  - Throws on an out-of-bounds `originFloor` / `destinationFloor`, and on `originFloor === destinationFloor`, each identifying the offending record's `id`.
  - Accepts floor indices at the exact bounds `[0, floorCount]`.

- **`src/generation/trialBatch.test.ts`** (3 tests)
  - Random scenario: the same scenario object produces deep-equal batches across repeated calls (batch-level determinism).
  - Random scenario with `trialCount > 1`: distinct trials are pairwise not identical to each other.
  - Scripted scenario: batch has exactly `trialCount` entries, every one deep-equal to `scenario.script`.

- **`src/generation/trialRunner.test.ts`** (3 tests)
  - `algorithm.createHook()` is called exactly once per `(algorithm, trial)` pair, never reused — asserted via two spy-wrapped `Algorithm`s whose `createHook` is a `vi.fn`.
  - `results.length === algorithms.length * scenario.trialCount`, and each result's `algorithmId`/`trialIndex` matches its position.
  - Falls back to a generous default `maxTimeMs` when `options` are omitted, without hanging.

- **`src/generation/fairness.test.ts`** (2 tests) — the critical regression test:
  - Two different real algorithms (`fcfsNearestCar`, `scanLook`) run via `runTrialBatch` on the same `RandomScenario`; for a chosen trial index, their `hallCallRegistered` log facts (floor, direction, time) are byte-for-byte identical, while their full logs differ (proof the equality isn't trivial — the two algorithms genuinely behave differently downstream).
  - The same equality holds across **every** trial index in a second, differently-seeded batch, not just one.

Full verification commands and results at implementation time:

| Command | Result |
|---|---|
| `npm run lint` | Pass, no warnings/errors |
| `npm run format` / `npm run format:check` | Pass (new files were auto-formatted once on first `format` pass, `format:check` clean afterward) |
| `npm run test` | Pass — 15 files, 80 tests (48 pre-existing + 31 new + 1 amendment regression test), **~0.2-0.4s wall time** |
| `npm run build` | Pass (`tsc -b` — including a forced, cache-cleared full recheck — type-checks clean under strict mode with no `any`; `vite build` succeeds) |

The test-suite wall time is called out explicitly because it's itself evidence: this unit's own plan already had one infinite-loop bug (rate-of-exactly-0 → NaN) caught and fixed *before* implementation, and a second, unrelated infinite-loop bug was found *during* implementation (see below) — a fast, clean run across the whole suite is a meaningful signal that neither class of bug slipped through into the shipped test suite.

## Integration Checks

- **`src/generation/*` imports only from `src/engine` and `src/algorithms`**, per the plan's scope — verified by inspection of every file's imports (no reaching into engine/algorithm internals like `testFixtures.ts` or per-algorithm files beyond their public exports).
- **`trialBatch.ts` is the single point where a batch's arrivals are fixed**, and `trialRunner.ts` calls it exactly once and reuses the result across every algorithm in the loop — this is the concrete mechanism `fairness.test.ts` proves end-to-end.
- **`src/scenarios/index.ts` mirrors `src/algorithms/index.ts`'s `import.meta.glob` discovery mechanism** exactly (eager import, glob exclusions for `index.ts`/test files, filter to the expected shape) — verified by direct comparison of the two files; `upPeakDemo.ts` exports `scenario: ScriptedScenario` under the uniform name the discovery mechanism expects.
- **`algorithm.createHook()` is called fresh per `(algorithm, trial)` pair**, never reused across trials — required for Unit 03's stated seeded-fairness contract; verified directly by `trialRunner.test.ts`'s spy-based test.

### Latent bug found in the existing engine/algorithms (Units 02/03) — RESOLVED

**Resolved as a Unit 02 amendment immediately after this unit's review** — see `dev_log/02_engine_done.md`. Preserved below for the record; the "flagged for developer decision" language reflects the state at implementation time, not the current state.

While developing `fairness.test.ts`, driving the real `fcfsNearestCar`/`scanLook` algorithms through `runSimulation` with a moderately busy random scenario reproduced a genuine infinite loop (OOM-crashed the Vitest worker — the same failure signature documented in `02_engine_done.md`'s and `03_algorithms_done.md`'s prior amendments): a fully-loaded elevator (`capacityRemaining === 0`) commanded to `stop` at a floor whose only active call is a pickup (nothing of the elevator's own onboard passengers has that floor as a destination) boards nobody and alights nobody. `computeDoorDwellMs` returns `0` for a zero-total stop, which re-schedules the very next decision at the *identical* simulated timestamp; since nothing about the elevator's state changed (still full, still at that floor, the call still active because nobody could board to clear it), the algorithm issues the identical `'stop'` decision again — forever, with no time advancement. Reproduced with both `fcfsNearestCar` and `scanLook` (and, less frequently, `nearestCarDirectional`) via a seed sweep (hundreds of seeds, both algorithms) once building capacity/elevator count were undersized relative to arrival volume.

This is a real gap in the existing engine+algorithm code (Units 02/03), not something introduced by this unit, and per this unit's explicit scope boundary those files were **not** touched. Instead, `fairness.test.ts`'s scenario parameters (`elevatorCount: 3`, `capacity: 16` against a modest arrival rate/duration) were chosen specifically to avoid it, verified by sweeping hundreds of seeds against the real algorithms before locking in the two seeds actually used (`7` and `35`) — see the extensive comment at the top of `fairness.test.ts` for the full writeup. **Flagged here prominently for developer awareness**: any future unit (05 metrics, 06 UI) that lets a user configure a busy/undersized scenario (high rate, low capacity, long duration, few elevators) against `fcfsNearestCar`, `scanLook`, or `nearestCarDirectional` can hit this hang. A proper fix belongs in the engine or algorithms (e.g., the engine could refuse/no-op a `'stop'` that would produce a zero-total dwell with the call still unresolvable, or each algorithm could avoid commanding `'stop'` for a pickup-only call when `capacityRemaining === 0`) — recommended as a follow-up amendment to Unit 02 or 03, analogous to the boarding-direction fix already recorded in `02_engine_done.md`.

A second, more subtle scenario-design point (not a bug, but worth knowing before reusing this pattern elsewhere): `hallCallRegistered` log entries are only emitted when a `(floor, direction)` call transitions from inactive to active — a second arrival at an already-active call produces no second log entry. Because exactly *when* a call clears depends on algorithm dispatch speed, two algorithms can legitimately produce different `hallCallRegistered` timelines for the identical underlying `PassengerArrival` script whenever two arrivals share a `(floor, direction)` while the first is still waiting — this is not a fairness violation (the input script fed to `runSimulation` is still byte-for-byte identical, as `trialBatch.test.ts` verifies directly), but it does mean `hallCallRegistered` isn't automatically a valid "same facts" signal for an arbitrary busy scenario. `fairness.test.ts`'s two scenarios were chosen (and verified against the real generator) to have zero such collisions in the batches they exercise, which is what makes the byte-for-byte equality assertion valid by construction rather than by luck.

## Success Criteria

- All 80 automated tests pass under `npm run test`, completing quickly with no hangs.
- `npm run lint`, `npm run format:check`, and `npm run build` all pass with no errors or warnings.
- The developer has reviewed `src/generation/` and `src/scenarios/` against the approved plan in `04_generation.md` (two-pass random-arrival algorithm and its exact RNG draw ordering, rate validation/skip rules, scripted-scenario validation, trial-batch/runner mechanics, scenario discovery) and confirms it matches.
- The developer confirms `fairness.test.ts` is convincing, end-to-end evidence that the seeded multi-trial fairness guarantee (`00_main.md`) holds through the real engine, not just at the generator-unit level.
- ~~The developer has reviewed the "Latent bug found" note above and decided whether/when to schedule the corresponding Unit 02/03 amendment.~~ **Done — see `02_engine_done.md`'s "Amendment (during Unit 04 review)" section.**
