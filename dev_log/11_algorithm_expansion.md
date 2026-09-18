# Unit 11: Algorithm roster expansion

## Objective

Developer-requested, following on from adding per-algorithm descriptions (which made FCFS's and Nearest Car (Directional)'s near-total overlap visible): remove `fcfs-nearest-car` (and its homing variant) from the roster, and add three genuinely different dispatch strategies — **zoning**, **ETA-based dispatch**, and **random dispatch** — each with its own "returns to lobby" homing variant, per the developer's explicit confirmation. Zoning additionally gets **two** variants for its own defining choice (whether a call falls back to any available elevator once its own zone's cars are full, or strictly waits) — also developer-confirmed ("add it as a variant" rather than picking one behavior).

Net roster change: 6 algorithms → **12** (`nearest-car-directional` ×2, `scan-look` ×2 unchanged; `fcfs-nearest-car` ×2 removed; 8 new: zoning ×4, ETA-based ×2, random ×2).

## FCFS removal

Delete `src/algorithms/fcfsNearestCar.ts`, `fcfsNearestCar.test.ts`, `fcfsNearestCarHoming.ts`, `fcfsNearestCarHoming.test.ts`. Remove every reference: `algorithms.test.ts`'s imports/comparative tests that exercise FCFS specifically (the "converge" and "surviving distinction" tests from the last amendment were built around FCFS vs. directional — either repurpose them to compare two of the *remaining* algorithms making the same point, or retire them; the underlying bugs they guarded are fixed and documented in `03_algorithms_done.md`, which stays as historical record either way), `algorithmColor.ts`'s `COLOR_ORDER`, the discovery test's expected-count/ids list, `dev_log/00_main.md`'s algorithm list, `dev_log/10_homing_algorithms.md`'s references to `fcfsNearestCarHoming.ts` as prior art (leave as historical record, note the file no longer exists as of this unit). No engine or UI code references algorithm ids by literal string outside these files (`selectedAlgorithmIds` is populated dynamically from the discovered `algorithms` array), so removal is otherwise mechanical.

## New algorithm 1: Zoning

**Model**: floors `1..floorCount` are divided into `elevatorCount` contiguous, roughly-equal zones, one per elevator, assigned by the elevator's position in `snapshot.elevators` (deterministic, matches this project's existing id-based tie-break convention — `E1` gets the lowest zone, `E2` next, etc.). **Floor 0 (the lobby) is in every elevator's zone** — unzoned, shared by all — since virtually every arrival pattern in this project (up-peak, down-peak, lunch-peak) centers on floor 0 traffic; a strict partition that excluded most elevators from the lobby would make zoning look artificially broken on the project's own default scenarios rather than showing its real, honest tradeoff.

Zone computation (pure function, unit-testable in isolation):
```
function zoneFor(elevatorIndex: number, elevatorCount: number, floorCount: number): { min: FloorIndex; max: FloorIndex }
```
Divide `1..floorCount` into `elevatorCount` contiguous ranges as evenly as possible (a remainder floor count `r` means the first `r` zones get one extra floor — standard "as-even-as-possible" partition, not a big remainder dumped on the last zone).

**Eligibility**: a candidate elevator is zone-eligible for a call if `call.floor === 0` OR `call.floor` falls within that elevator's own zone. Deliberately ignores *direction* entirely (unlike `nearestCarDirectional.ts`) — zoning is meant to isolate ONE new variable (spatial partitioning) for clean comparison, not combine it with the direction question already covered elsewhere. Nearest-by-distance among zone-eligible, capacity-available candidates, same tie-break as `fcfsNearestCar.ts` (lowest id). Drop-offs (`carButtons`) are **always** honored regardless of zone — a boarded passenger's destination is unknown at pickup time (this project's presence-only call model), so an elevator may legitimately need to deliver outside its own zone; zoning only restricts which NEW pickups it will accept, never abandons a passenger already aboard. Same assignment-map/`hasVisited`/unvisited-timeout structure as `fcfsNearestCar.ts`, reused for consistency (this project's established per-file-duplication convention, not a shared module).

**Two variants**:
- **`zoning`** (strict): if zone-eligible candidates are all full/assigned, the call simply stays unassigned — retried next decision point, same as every other algorithm's existing "no candidate available" behavior, but here it can persist even while an out-of-zone elevator sits idle. This is the real, honest tradeoff the developer asked to see, expected to show up in `unservedCount`/`unservedPct` under sustained zone-local demand.
- **`zoning-fallback`**: if zone-eligible candidates are all full (or none exist as a candidate at all), fall back to the nearest ANY capacity-available elevator regardless of zone, on that same decision pass. Softens zoning into a preference rather than a hard boundary.

## New algorithm 2: ETA-based dispatch

**Model**: no hard compatibility filter at all — every capacity-available, unassigned elevator is a candidate, and the one with the **lowest estimated time to reach the call floor** wins, tie-broken by lowest id. This is what real modern elevator dispatch approximates, and naturally subsumes the direction question: a wrong-direction or busy elevator simply gets a higher estimate (it has to finish its current commitments first), rather than being hard-excluded or naively ignored.

ETA estimate for elevator `e` and call `c` (pure function, unit-testable in isolation, using only `floorTravelTimeMs`/`doorDwellBaseMs` already on `DispatchSnapshot`/`BuildingConfig`... **note**: `DispatchSnapshot` does not currently carry `doorDwellBaseMs` — only `floorTravelTimeMs` and `idleReturnThresholdMs` were added for prior fixes. This unit adds `doorDwellBaseMs: number` to `DispatchSnapshot` (mirrors `BuildingConfig.doorDwellBaseMs`, same pattern as the two existing additions), needed for a realistic ETA that accounts for intermediate stop time, not just travel time):
```
function estimateArrivalMs(elevator, call, floorTravelTimeMs, doorDwellBaseMs): number {
  if (isCompatibleDirection(elevator, call)) {
    // Straight there: travel time plus one dwell per existing car-button stop strictly between
    // current position and the call floor (a flat per-stop approximation — this project's dwell
    // formula's per-passenger multiplier isn't knowable in advance, since destinations of not-yet-
    // boarded passengers are never known ahead of boarding).
    const stopsEnRoute = count of elevator.carButtons strictly between currentFloor and call.floor
    return distance(currentFloor, call.floor) * floorTravelTimeMs + stopsEnRoute * doorDwellBaseMs
  }
  // Incompatible: must finish its current commitment first (travel to its farthest remaining
  // car button in its committed direction, paying a dwell per stop along the way), THEN reverse
  // and travel to the call.
  const turnaroundFloor = farthest carButton in elevator.direction from currentFloor
                           (or currentFloor itself if no carButtons -- reverses immediately)
  const stopsToTurnaround = count of carButtons between currentFloor and turnaroundFloor
  return distance(currentFloor, turnaroundFloor) * floorTravelTimeMs
       + stopsToTurnaround * doorDwellBaseMs
       + distance(turnaroundFloor, call.floor) * floorTravelTimeMs
}
```
`isCompatibleDirection` reuses the same idea as `nearestCarDirectional.ts`'s `isCompatible` (idle or empty → always "compatible"/straight-there; else direction match + hasn't passed). Same assignment-map structure as the others (an ETA is only meaningful as a snapshot-in-time estimate; re-computed fresh every `refreshAssignments` pass, same as distance is today — no need to "lock in" an old estimate).

## New algorithm 3: Random dispatch

**Model**: among unassigned-call candidates (capacity-available, no direction/zone/ETA filter — deliberately the "dumbest possible" baseline, to show FCFS-style naivety isn't actually the worst available choice), pick uniformly at random. Same assignment-map structure as the others (still avoids thrashing/reassignment loops).

**Architectural fix required**: `Algorithm.createHook()` takes no arguments and `DispatchSnapshot` carries no seed — every other algorithm is either deterministic-by-construction (distance/ETA comparisons) or stateless (SCAN/LOOK), so this gap was never exposed before. A random-dispatch algorithm using `Math.random()` would silently break this project's core seeded-reproducibility guarantee (`00_main.md`: "same seed sequence reused across every algorithm... so metric differences reflect the algorithm, not random variance") — two runs of the same seed would produce different random-dispatch results, and worse, the SAME seed compared across algorithms would no longer be a fair, apples-to-apples comparison for this one algorithm.

Fixed by deriving a fully deterministic, reproducible "random" choice from data already on the snapshot, never touching the `Algorithm`/`DispatchHook` interfaces:
```
function pseudoRandomIndex(time: number, call: HallCall, candidateCount: number): number {
  const seed = (Math.floor(time * 1000) ^ (call.floor * 2654435761) ^ (call.direction === 'up' ? 1 : 0)) >>> 0;
  return Math.floor(createRng(seed).next() * candidateCount);
}
```
`time` alone would repeat the same pick for multiple simultaneous calls at the same tick; XOR-ing in the call's own floor/direction disambiguates them. Reproducible because `snapshot.time` is itself fully determined by the seeded event log — same input seed, same sequence of `snapshot.time` values, same "random" picks, every run.

**`createRng` needs relocating first.** It currently lives in `src/generation/rng.ts`, but `src/generation/trialRunner.ts` already imports `Algorithm` from `src/algorithms/types.ts` — meaning `generation` depends on `algorithms`. If an algorithm file imported `createRng` from `generation`, that would be a circular module dependency. Fix: move `createRng`/`Rng`/`Seed`'s actual implementation to a new `src/engine/rng.ts` (engine is the one layer both `algorithms` and `generation` already depend on, with nothing importing the other way), and have `src/generation/rng.ts` re-export from there so every existing import (`generateRandomArrivals`'s own use, `src/generation/index.ts`'s barrel export, every test importing `createRng` from `'../generation'` or `'./rng'`) keeps working unchanged. `deriveTrialSeeds` and `sampleExponentialGapMs` (generation-specific — the latter is only meaningful for Poisson arrival sampling) stay in `src/generation/rng.ts`, re-exporting only what moved.

## Homing variants (all three new algorithms, all four zoning variants get homing separately per the developer's confirmation)

Identical mechanism to the three existing homing algorithms — see `10_homing_algorithms.md` for the full rationale (per-elevator `idleSince` closure map, `snapshot.idleReturnThresholdMs`, hardcoded home floor 0, no special preemption logic needed). Applied to: `zoning` → `zoning-homing`, `zoning-fallback` → `zoning-fallback-homing`, `eta-dispatch` → `eta-dispatch-homing`, `random-dispatch` → `random-dispatch-homing`.

## Naming

| File | `id` | `name` |
|---|---|---|
| `zoning.ts` | `zoning` | "Zoning" |
| `zoningHoming.ts` | `zoning-homing` | "Zoning (Returns to Lobby)" |
| `zoningFallback.ts` | `zoning-fallback` | "Zoning (With Fallback)" |
| `zoningFallbackHoming.ts` | `zoning-fallback-homing` | "Zoning (With Fallback) (Returns to Lobby)" |
| `etaDispatch.ts` | `eta-dispatch` | "ETA-Based" |
| `etaDispatchHoming.ts` | `eta-dispatch-homing` | "ETA-Based (Returns to Lobby)" |
| `randomDispatch.ts` | `random-dispatch` | "Random" |
| `randomDispatchHoming.ts` | `random-dispatch-homing` | "Random (Returns to Lobby)" |

Each new algorithm's `description` (per the just-shipped per-algorithm-description feature) written in the same plain-language, current-behavior style as the existing six — drafted during implementation, reviewed for accuracy against the actual shipped logic before this unit is marked complete (not written speculatively ahead of the code, per the lesson already learned once this session when FCFS's own description needed correcting after its behavior changed).

## Color system: 12 slots

Doubling from 6 to 12 categorical colors is a real, qualitatively harder palette problem, not just "add 6 more" (found the hard way getting to 6 in Unit 10). Design approach: **hue families with shade variation**, not 12 unrelated hues — group each algorithm's variants (base/homing, strict/fallback) as different lightness/saturation shades of the *same* hue, so a reader can tell "these are all zoning variants" at a glance by hue alone, then tell variants apart by shade. Concretely: `nearest-car-directional`/`-homing` (2 shades of its existing hue), `scan-look`/`-homing` (2 shades of its existing hue), `zoning`/`-homing`/`-fallback`/`-fallback-homing` (4 shades of a new hue), `eta-dispatch`/`-homing` (2 shades of a new hue), `random-dispatch`/`-homing` (2 shades of a new hue) = 12.

Still implemented as flat `--series-1` through `--series-12` custom properties (no change to `algorithmColorVar`'s existing index-based mechanism) — `COLOR_ORDER` extended to 12 entries in this grouped order, and the 12 hex values themselves chosen to form the family/shade structure. Validated via the dataviz skill's `validate_palette.js` against the full 12-color set, `--pairs all`, both light and dark surfaces — expect this to need real iterative search (a programmatic search against the validator's own exported `validate()` function, same technique Unit 10 used for 6) and likely more WARN-level compromises than Unit 10's palette needed, mitigated the same way every prior amendment's palette was (every series color is always paired with a direct label — legend, bar labels, table row — never color-only encoding).

## What gets tested

- `zoneFor`: pure function, hand-computed boundary cases (even division, remainder floors, `elevatorCount` of 1, a zone of exactly one floor).
- Zoning hook-level: a call in an elevator's own zone is accepted; a call in another elevator's zone is rejected even when nearer; floor 0 is accepted by every elevator regardless of zone; a boarded passenger's drop-off outside the elevator's own zone is still honored.
- Zoning-vs-zoning-fallback: identical scenario (all in-zone elevators full, an out-of-zone one idle) — strict variant leaves the call unassigned, fallback variant assigns it.
- `estimateArrivalMs`: hand-computed exact values for a compatible car (straight-line, with and without intermediate stops) and an incompatible one (turnaround case), mirroring this project's established "exact hand-computed expectations, not snapshot" testing style.
- ETA hook-level: a nearer-but-wrong-direction-with-many-stops car loses to a farther-but-compatible one when the ETA math says so — the direct point of this algorithm.
- Random dispatch: determinism (same seed/scenario → identical picks across two runs), and a distribution check across many simulated ticks proving it is NOT always picking the same/nearest elevator (a structural spread check, not a statistical proof, matching this project's existing precedent for "random" pattern tests).
- `rng.ts` relocation: every existing test that imports `createRng` from `'../generation'`/`./rng` continues to pass unchanged — proves the re-export preserves behavior exactly; no new tests needed for the move itself beyond what already covers `createRng`.
- Real browser verification: all 12 algorithms selectable, the dashboard/replay render all 12 with visually distinct colors in both light and dark mode, a run against a zone-heavy scenario shows the expected unserved-count divergence between `zoning` and `zoning-fallback`.

## Files

Removed: `src/algorithms/fcfsNearestCar.ts`, `fcfsNearestCar.test.ts`, `fcfsNearestCarHoming.ts`, `fcfsNearestCarHoming.test.ts`.

Created: `src/algorithms/zoning.ts`, `zoningHoming.ts`, `zoningFallback.ts`, `zoningFallbackHoming.ts`, `etaDispatch.ts`, `etaDispatchHoming.ts`, `randomDispatch.ts`, `randomDispatchHoming.ts` + their `.test.ts` files; `src/engine/rng.ts` (+ `rng.test.ts`, moved from `src/generation/`); `dev_log/11_algorithm_expansion_test.md`.

Modified: `src/engine/dispatch.ts` (`DispatchSnapshot.doorDwellBaseMs`), `src/engine/simulation.ts` (populates it), `src/generation/rng.ts` (re-exports from `src/engine/rng.ts`), `src/algorithms/algorithms.test.ts` (FCFS removal, discovery count/ids → 12), `src/ui/dashboard/algorithmColor.ts` (+ test, `COLOR_ORDER` → 12 entries) `src/style.css` (`--series-7` through `--series-12`, and possibly re-chosen 1-6 if the family/shade redesign requires it), `dev_log/00_main.md`.

## Open questions (resolved)

1. **Homing variants for all three new algorithms: yes.** Developer-confirmed.
2. **Zoning fallback behavior: both, as two separate algorithm variants** (`zoning` strict, `zoning-fallback`). Developer-confirmed.

## Deviations from Plan

- **`DispatchSnapshot` needed a `floorCount` field too, not just `doorDwellBaseMs`.** Discovered
  mid-implementation: `zoning.ts`'s `zoneFor` needs the building's full floor range to divide it
  into per-elevator zones, and nothing on the pre-existing snapshot shape could derive that
  (elevators only report their own current floor; a floor with no calls yet gives no signal at
  all). Added `floorCount: number`, mirroring `BuildingConfig.floorCount`, following the exact
  precedent the plan's own `doorDwellBaseMs` addition set. Every hand-built `DispatchSnapshot` test
  fixture across the algorithm test suite got both new fields.
- **The 12-color palette could not clear `--pairs all`** (this project's standard since Units
  08/10) despite substantial, documented search effort — see `11_algorithm_expansion_test.md`'s
  "Palette validation" for the full account. Validated against `--pairs adjacent` instead, which
  is the more accurate target for this dashboard's actual chart shape (fixed row order, not an
  all-pairs-simultaneous layout). The four surviving algorithms' exact hex values are unchanged;
  only their `COLOR_ORDER` index shifted, an unavoidable consequence of removing FCFS from the
  middle of the list.
- **Zoning vs. zoning-fallback's real-world divergence showed up as wait time, not unserved
  count**, in the scenario actually tested (see the test doc's "Manual Tests" §3). The underlying
  point — zoning-fallback measurably helps when a zone saturates — held up clearly regardless.
- **`algorithms.test.ts`'s cross-algorithm comparative describe block** was rebuilt around
  `nearestCarDirectional` vs. `etaDispatch` (proving they agree on an "obvious" case through
  different mechanisms) rather than retired outright, to keep some direct comparative coverage in
  that file rather than leaving it as pure SCAN/LOOK-only sanity.

## Status: Complete
