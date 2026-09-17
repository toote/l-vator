# Unit 03: Algorithms - Test Instructions

## Test Objectives

Verify that the three dispatch algorithms under `src/algorithms/` (`fcfsNearestCar`, `scanLook`, `nearestCarDirectional`) each correctly implement the `DispatchHook` seam Unit 02 defined, that they are genuinely different dispatch strategies rather than three names for the same behavior, and that the `import.meta.glob`-based discovery mechanism in `src/algorithms/index.ts` finds exactly the three of them automatically:

- **FCFS/naive nearest-car**: assignment-map-based dispatch (nearest idle elevator to the nearest-in-array-order unassigned call), drop-off priority over pickup, deterministic tie-breaking, the same-pass exclusion invariant, and graceful handling of "no elevator available."
- **SCAN/LOOK**: stateless directional sweeping — idle direction pick, in-path stop/continue, LOOK-style immediate reversal (no overshoot to the physical top/bottom), and ignoring opposite-direction calls until the return sweep.
- **Nearest-car with directional matching**: the same assignment-map structure as FCFS, but with the `isCompatible` candidate filter (idle always compatible; a moving car only compatible if already heading the call's direction and hasn't passed its floor).
- **Cross-algorithm comparison**: the same scripted scenario run through all three algorithms via `runSimulation`, proving they produce meaningfully different dispatch outcomes on identical input.
- **Discovery**: `src/algorithms/index.ts`'s `algorithms` export contains exactly the three real algorithm modules, and `types.ts`/`shared.ts`/test files are correctly excluded.

## Manual Tests

None. Like Unit 02, this unit is headless dispatch logic with no UI (Unit 06 will eventually surface algorithm selection) — there is nothing to click through. All verification is automated.

## Automated Tests

Run via `npm run test` (Vitest). 45 tests across 9 files, all passing — 23 pre-existing from Unit 02 (`src/engine/`) plus 22 new for this unit:

- **`src/algorithms/fcfsNearestCar.test.ts`** (7 tests)
  - **Integration**: a single call, single idle elevator not co-located — travels one floor at a time to the pickup, then to the drop-off (5 `elevatorArrived` entries, 2 `doorsOpened` stops).
  - **Hook-level**: two simultaneous calls at different distances from two idle elevators — nearer elevator assigned to nearer call.
  - **Hook-level**: equidistant elevators — deterministic tie-break to the lower id.
  - **Hook-level**: an elevator with both an onboard drop-off available right now and an existing pickup assignment elsewhere stops for the drop-off, not diverting toward the pickup (driven via two chained hook invocations on the same hook instance, using its persistent assignment memory).
  - **Hook-level**: a busy (non-idle) elevator and an active call — the call stays unassigned across repeated invocations of the same hook, then gets assigned the moment the elevator's snapshot shows it idle.
  - **Hook-level**: two simultaneous calls both much nearer to one elevator than the other — the same-pass exclusion means the second call goes to the (otherwise farther) second elevator rather than being skipped or double-claimed.
  - **Hook-level invariant**: three elevators, three calls — the returned action array never has a duplicate `elevatorId`.

- **`src/algorithms/scanLook.test.ts`** (5 tests)
  - **Integration**: sweeping up with calls at floors 2 and 5 and nothing beyond — stops at 2, continues to 5, then reverses immediately (`elevatorArrived` sequence `[1,2,3,4,5,4,3,2,1,0]`, `doorsOpened` sequence `[2,5,0]`, floor 6 never visited) — the core LOOK-vs-SCAN distinguishing test.
  - **Integration**: an opposite-direction call sitting in the sweep's path is not served on the way up (`doorsOpened` at that floor happens exactly once, and only after the elevator's arrival at the reversal point) but is served on the way back down.
  - **Hook-level**: an idle elevator picks the initial direction toward the nearest pending floor (position only — the call's own direction is irrelevant to this pick).
  - **Hook-level**: nothing pending in either direction after a sweep — goes idle rather than getting stuck.
  - **Hook-level invariant**: three elevators (mixed idle/moving), three calls — no duplicate `elevatorId` in the returned actions.

- **`src/algorithms/nearestCarDirectional.test.ts`** (4 tests, all hook-level)
  - The key differentiator: a nearby elevator already moving away from the call (incompatible) is skipped in favor of a farther but compatible (idle) one.
  - No compatible car currently available — the call stays unassigned across repeated invocations until the elevator's snapshot shows it idle (turned compatible).
  - An idle elevator is always a valid candidate regardless of its (artificially non-null, for isolation) stored direction — `isCompatible`'s idle branch short-circuits before any position/direction check.
  - Invariant: no duplicate `elevatorId` in the returned actions.

- **`src/algorithms/algorithms.test.ts`** (6 tests)
  - **Comparative sanity** (4 tests): one scripted scenario (`p0` sends the sole idle elevator, E1, up toward floor 9; while E1 is already en route and passing directly through floor 6, `p1` registers a call there) run through all three algorithms:
    - FCFS sends the otherwise-uninvolved E2 all the way from floor 0 to serve `p1` — E2 has one or more `elevatorArrived` entries (real, dedicated travel).
    - Nearest-car-directional recognizes E1 is already heading the right way and hasn't passed floor 6 — E1 picks up `p1` "for free" on its existing path, and E2 never moves at all (zero `elevatorArrived` entries).
    - Directional matching delivers `p1` no later than plain FCFS does, on the same script.
    - SCAN/LOOK's resulting log differs from both other algorithms' logs on the same script, while still fully serving both passengers — proof it's a genuinely different strategy, not a third name for one of the other two.
  - **Discovery** (2 tests): `algorithms` (from `index.ts`) has exactly 3 entries with the expected ids (`fcfs-nearest-car`, `nearest-car-directional`, `scan-look`), and every entry has the real `Algorithm` shape (`id`/`name`/callable `createHook` producing a callable hook) — proving `types.ts`, `shared.ts`, and the `*.test.ts` files were correctly excluded from the glob (they export no `algorithm`, so any accidental inclusion would either be filtered out or fail this shape check).

Full verification commands and results at implementation time:

| Command | Result |
|---|---|
| `npm run lint` | Pass, no warnings/errors |
| `npm run format` / `npm run format:check` | Pass (two new test files were reformatted by the `format` pass — line-wrapping only, no content change; `format:check` clean afterward) |
| `npm run test` | Pass — 9 files, 45 tests (23 pre-existing + 22 new) |
| `npm run build` | Pass (`tsc -b` type-checks clean under strict mode, `import.meta.glob` resolves correctly via the `vite/client` types; `vite build` succeeds) |

## Integration Checks

- **`src/algorithms/index.ts`'s discovery mechanism** works identically under Vitest (`algorithms.test.ts`'s discovery tests) and the production `vite build` (verified by `npm run build` succeeding, since `import.meta.glob` is resolved at build time) — no manual registry to keep in sync when a new algorithm file is added.
- Every algorithm file imports **only** from `src/engine`'s public barrel (`DispatchHook`, `DispatchSnapshot`, `DispatchAction`, `ElevatorSnapshot`, `HallCall`, `FloorIndex`, `Direction`) — never from `src/engine/testFixtures.ts`. Test files also build their own local, self-contained fixtures (`buildConfig`, `arrival`, `makeElevator`, `makeSnapshot`) rather than importing Unit 02's test-only scaffolding, per the plan's explicit note that `testFixtures.ts` is a style reference only.
- **Unit 04** (call generation) can call `algorithm.createHook()` once per trial and get a hook with fresh, empty assignment memory each time (`fcfsNearestCar` and `nearestCarDirectional`'s hook-level tests demonstrate the same hook instance accumulating state correctly across chained invocations — but a *new* `createHook()` call always starts clean, since the assignment `Map` lives entirely inside that call's closure).
- **Unit 06** (UI) has `id`/`name` on every discovered `Algorithm` to list, verified present and correctly typed by the discovery shape-check test.
- All three algorithms always return exactly one action per elevator in `snapshot.elevators`, every invocation (verified structurally by every hook-level test's full-coverage snapshots, and directly by the three duplicate-id invariant tests) — satisfying the engine's "an unaddressed eligible elevator defaults to idle" contract from `simulation.ts`.

## Success Criteria

- All 45 automated tests pass under `npm run test`.
- `npm run lint`, `npm run format:check`, and `npm run build` all pass with no errors or warnings.
- The developer has reviewed `src/algorithms/` against the approved plan in `03_algorithms.md` (assignment memory, per-elevator routing, idle policy, discovery mechanism, tie-breaking, same-pass exclusion) and confirms it matches.
- The developer has reviewed and agrees with the one noted plan-interpretation point in `03_algorithms.md`'s AI Interactions section (the comparative test's "nearer/farther" framing, inverted from the plan's illustrative wording for reasons specific to the approved pseudocode's idle-only FCFS candidate gate).
- The developer confirms the comparative test in `algorithms.test.ts` is convincing evidence the three algorithms are genuinely different strategies.
