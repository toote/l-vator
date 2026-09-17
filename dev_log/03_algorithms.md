# Unit 03: Algorithms

## Objective

Deliver the three dispatch algorithms named in `00_main.md`'s Planned Units list — FCFS/naive nearest-car, SCAN/LOOK, and nearest-car with directional matching — plus the common structure that lets each live in its own file and be added to without touching the others. Each algorithm is a real implementation of the `DispatchHook` seam Unit 02 built and proved out (`src/engine/dispatch.ts`), replacing the trivial test-only stubs in `src/engine/testFixtures.ts` (`noOpDispatchHook`, `createGreedyStopAndGoHook`) with actual dispatch logic a user could meaningfully compare.

**Why this order:** each algorithm is a deliberate step up in sophistication, and the order lets later algorithms be built and reasoned about in terms of what the previous one gets wrong:

1. **FCFS/naive nearest-car** is the simplest possible baseline — assign each call to whichever elevator is spatially nearest, no awareness of where that elevator is headed. It establishes the shared plumbing (per-elevator routing, hall-call assignment, tie-breaking) the other two reuse.
2. **SCAN/LOOK** is a structurally different strategy (no call-to-elevator assignment at all — each car just sweeps and serves whatever is in its path) and is the natural next step because it's the classic "elevator algorithm" every reader of this project will already have an intuition for; it's a good contrast case against #1.
3. **Nearest-car with directional matching** closes the loop by fixing #1's most obvious flaw (it can send the geometrically nearest car even when that car is already moving away from the call) using the same assignment-based structure as #1, making the two directly comparable on identical scenarios — which is exactly the kind of side-by-side story this project exists to tell (per `00_main.md`: "run it against multiple algorithms, and compare how they perform").

This unit delivers algorithm logic only. No metrics computation (Unit 05), no call generation (Unit 04 — this unit's own tests use hand-authored `ScriptedInput` fixtures the same way Unit 02's did), no UI (Unit 06).

## Implementation

### Directory/file layout

```
src/algorithms/
├── types.ts                      # Algorithm type: the common per-file export shape
├── shared.ts                     # small pure helpers reused by 2+ algorithms (distance, directionFrom)
├── fcfsNearestCar.ts
├── scanLook.ts
├── nearestCarDirectional.ts
├── index.ts                      # discovers algorithm files at build time — no manual listing
├── fcfsNearestCar.test.ts
├── scanLook.test.ts
├── nearestCarDirectional.test.ts
└── algorithms.test.ts            # cross-algorithm comparative sanity tests
```

All files are plain data + pure functions — no classes — consistent with `src/engine`'s confirmed house style. `src/algorithms/*` imports only from `src/engine` (the `DispatchHook`/`DispatchSnapshot`/`DispatchAction`/`ElevatorSnapshot`/`HallCall`/`FloorIndex`/`Direction` types exported from `src/engine/index.ts`) — it never reaches into `src/engine/testFixtures.ts`, which is test-only scaffolding for Unit 02, not a real algorithm to build on.

### Common interface: `Algorithm`

```ts
// src/algorithms/types.ts
import type { DispatchHook } from '../engine';

export interface Algorithm {
  id: string;           // stable key, e.g. 'fcfs-nearest-car'
  name: string;          // display name, e.g. "FCFS / Nearest Car" — for a future UI (Unit 06) to list
  createHook: () => DispatchHook;
}
```

Each algorithm file exports one `Algorithm` object under the **same fixed export name**, `algorithm` (not a per-file name like `fcfsNearestCar`) — e.g. `export const algorithm: Algorithm = { id: 'fcfs-nearest-car', name: 'FCFS / Nearest Car', createHook: () => ... }`. A uniform export name is what makes automatic discovery possible below; tests import a specific algorithm directly by file path (e.g. `import { algorithm } from './fcfsNearestCar'`) when they need one in isolation.

**Why `createHook: () => DispatchHook` (a factory) rather than a bare `hook: DispatchHook`:** two of the three algorithms (FCFS and nearest-car-directional, see below) need to remember, across invocations within a single simulation run, which elevator is currently committed to which hall call — the `DispatchSnapshot` the engine hands the hook has no field for "who's already been assigned this call," only current position/direction/onboard state (see "Assignment memory" below for why). That memory has to live in a closure, the same pattern `testFixtures.ts`'s `createGreedyStopAndGoHook`/`createScriptedDispatchHook` already use. A factory is required so `00_main.md`'s seeded multi-trial fairness guarantee holds: each of the N trials in a batch comparison must start an algorithm with a **fresh, empty** assignment memory, not one carried over from a previous trial. The one algorithm that doesn't need this memory (SCAN/LOOK) still exposes `createHook` for interface uniformity; its factory just returns a stateless function.

**Integration note for Unit 04** (not an open question, just a contract worth stating now since Unit 04 is the actual caller): the trial runner must call `algorithm.createHook()` once per `runSimulation` call, never reuse one hook instance across multiple trials.

### Discovery: `src/algorithms/index.ts` (resolves former open question #2)

**Revised per developer feedback**: rather than a manually maintained array that someone has to remember to update every time a new algorithm file is added, `index.ts` discovers algorithm files automatically at build time, using Vite's `import.meta.glob`. Adding a new algorithm is then genuinely just "drop a file that exports `algorithm: Algorithm`" — zero edits anywhere else, which is a better fit for `00_main.md`'s stated goal ("make sure each algorithm is a separate file so new ones can be easily added") than a hand-maintained list ever was.

```ts
// src/algorithms/index.ts
import type { Algorithm } from './types';

// Eagerly imports every sibling file except itself, the shared type/helper files, and tests —
// so only files meant to BE an algorithm are considered. A file that doesn't export `algorithm`
// (or exports something that doesn't match the Algorithm shape) is silently excluded rather than
// erroring, so types.ts/shared.ts can't accidentally end up in the list even if the glob pattern
// were ever loosened.
const modules = import.meta.glob<{ algorithm?: Algorithm }>(
  ['./*.ts', '!./index.ts', '!./types.ts', '!./shared.ts', '!./*.test.ts'],
  { eager: true },
);

export const algorithms: Algorithm[] = Object.values(modules)
  .map((m) => m.algorithm)
  .filter((a): a is Algorithm => a !== undefined);

export type { Algorithm } from './types';
```

`import.meta.glob` is resolved at build time (not a runtime filesystem scan), so this has no runtime cost or Node-specific filesystem API dependency — it works identically in the dev server, the test runner, and the production Pages build. The explicit exclusion list (`!./index.ts` etc.) keeps the glob pattern honest about what counts as "an algorithm file" without relying on a subdirectory split.

### Shared helpers (`shared.ts`)

Only genuinely repeated, trivial pure functions — not a home for algorithm logic:

```ts
export function directionFrom(from: FloorIndex, to: FloorIndex): Direction | null {
  if (to === from) return null;
  return to > from ? 'up' : 'down';
}

export function distance(a: FloorIndex, b: FloorIndex): number {
  return Math.abs(a - b);
}
```

### A structural constraint from the engine that shapes all three algorithms

Two things worth stating explicitly because they drove the design below, and because a developer sanity-checking the pseudocode needs them in mind:

1. **The engine defaults an unaddressed eligible elevator to idle** (`applyDecision` in `simulation.ts`: any elevator that was eligible to act but wasn't named in the hook's returned actions gets force-set to idle). So every algorithm below always computes and returns exactly one action for **every** elevator in the snapshot, every invocation — not just the ones it thinks changed — otherwise a moving elevator would stop dead the moment the hook forgets to mention it. Returning actions for elevators the engine currently considers ineligible (e.g. one still mid-`moving`) is harmless — the engine silently ignores those — so hooks don't need to reason about eligibility themselves.
2. **`DispatchSnapshot` carries no "this elevator is already assigned to this call" field.** `ElevatorSnapshot.carButtons` only reflects *onboard passenger* destinations, set by the engine at boarding time — it says nothing about a hall call an elevator is currently travelling toward but hasn't reached yet. An algorithm that wants to remember "car E1 is on its way to serve the call at floor 6" (so a later invocation doesn't reassign that same call to a different, now-closer car and cause thrashing) has to keep that memory itself, via a closure in `createHook()`. FCFS and nearest-car-directional need this (see "Assignment memory" below); SCAN/LOOK doesn't, because it never assigns calls to specific cars in the first place — it just reads `elevator.direction` (which the engine *does* track and expose) as an implicit proxy for "which way this car is currently sweeping."

### Algorithm 1: FCFS / naive nearest-car (`fcfsNearestCar.ts`)

**Assignment memory.** The closure holds `assignments: Map<elevatorId, HallCall>`. On each hook invocation:

```
refreshAssignments(snapshot, assignments):
  # 1. Drop assignments whose call is no longer active (served, or otherwise gone)
  for (elevatorId, call) in assignments:
    if call not in snapshot.activeHallCalls: assignments.delete(elevatorId)

  # 2. Assign each unassigned active call to the nearest still-unassigned, available elevator
  assignedCallKeys = { key(call) for call in assignments.values() }
  unassigned = [c for c in snapshot.activeHallCalls if key(c) not in assignedCallKeys]
               # order = snapshot.activeHallCalls's own order (see FCFS ordering caveat below)

  for call in unassigned:
    candidates = [e for e in snapshot.elevators
                  if e.id not in assignments         # not already carrying an assignment
                  and e.capacityRemaining > 0]
                  # deliberately NOT filtered by e.state or e.direction — "naive" means it will
                  # happily send the nearest car even if that car is already moving away from
                  # the call. See "Correction" note below.
    if candidates is empty: continue   # no car free this round; retried next decision point
    best = candidate minimizing distance(e.currentFloor, call.floor),
           ties broken by elevator id (stable array order, e.g. "E1" before "E2")
    assignments.set(best.id, call)
    # best is now excluded from `candidates` on the NEXT call in this same loop pass,
    # since assignments.has(best.id) is now true
```

**Per-elevator routing**, run for every elevator after `refreshAssignments`:

```
decide(elevator, assignments):
  if elevator.carButtons.includes(elevator.currentFloor):
    return stop                         # drop-off takes priority over a new pickup
  call = assignments.get(elevator.id)
  if call and call.floor === elevator.currentFloor:
    return stop                         # pickup
  target = nearest(elevator.carButtons) ?? call?.floor
  if target === undefined:
    return idle                         # this algorithm's idle policy: stay put — see below
  return travel(directionFrom(elevator.currentFloor, target))
```

**Idle policy (per-algorithm decision, not a shared engine rule — see "Open questions" resolution below): stay put.** With no assigned call and no onboard passengers left to drop off, the elevator simply goes/stays idle exactly where it is. No deadhead travel to a "home floor." This is FCFS's own choice; the other two algorithms state theirs independently below.

**Correction (found during implementation review): FCFS's candidate filter must NOT be idle-only.** An earlier version of this plan (and its first implementation) restricted FCFS's candidates to `e.state === 'idle'`. That's a real bug, not a simplification: `nearestCarDirectional`'s entire point is to add a *direction* filter on top of the same candidate pool FCFS uses — but direction is meaningless for an idle car (no committed direction to conflict with), so restricting FCFS to idle-only elevators makes its candidate pool a strict *subset* of what direction-filtering alone would produce, meaning `nearestCarDirectional` could never end up choosing something farther than FCFS would. That's backwards from this unit's Objective, which explicitly requires FCFS to be capable of "send[ing] the geometrically nearest car even when that car is already moving away from the call" — the exact flaw `nearestCarDirectional` exists to fix. Fixed: FCFS's candidates are now any elevator without an existing assignment and with spare capacity, in *any* movement state — idle or moving, regardless of direction. This also restores the intended comparative-test framing in `algorithms.test.ts` (see "What gets unit-tested" below).

**FCFS ordering (resolved — was flagged as a caveat, now a guaranteed engine contract):** "first come, first served" is implemented as "assign in the order calls appear in `snapshot.activeHallCalls`." This used to be an incidental property of Unit 02's implementation; per developer feedback during this unit's planning, it's now a documented, tested guarantee of `DispatchSnapshot.activeHallCalls` — see the doc comment on that field in `src/engine/dispatch.ts` and the ordering test added to `src/engine/capacity.test.ts` (commit `90c2b26`, "Document and test activeHallCalls ordering guarantee"). This algorithm can rely on it directly; no caveat comment needed in `fcfsNearestCar.ts` beyond citing the guarantee.

### Algorithm 2: SCAN/LOOK (`scanLook.ts`)

No assignment map, no cross-elevator coordination — each car independently sweeps in `elevator.direction` and services whatever's in its path; `createHook()` returns a stateless function.

```
decide(snapshot, elevator):
  direction = elevator.direction

  if direction === null:
    # was idle: pick a direction toward the nearest pending floor (carButton or any active call)
    pending = union(elevator.carButtons, [c.floor for c in snapshot.activeHallCalls])
    if elevator.currentFloor in pending: return stop   # e.g. a call sitting right where it's parked
    nearestFloor = closest(pending, elevator.currentFloor)
    if nearestFloor === undefined: return idle          # this algorithm's idle policy: stay put
    direction = directionFrom(elevator.currentFloor, nearestFloor)
    return travel(direction)

  # committed direction: only calls matching it count as "in path" for stop/continue purposes —
  # opposite-direction calls are served on the return sweep, not now (this IS the LOOK behavior)
  compatibleCallFloors = [c.floor for c in snapshot.activeHallCalls if c.direction === direction]
  pending = union(elevator.carButtons, compatibleCallFloors)

  if elevator.currentFloor in pending:
    return stop

  ahead = [f in pending where (direction === 'up' ? f > currentFloor : f < currentFloor)]
  if ahead is nonempty:
    return travel(direction)              # keep sweeping this way

  behind = [f in pending where (direction === 'up' ? f < currentFloor : f > currentFloor)]
  # note: pending was built from the SAME direction, so "behind" here only catches calls that
  # were behind at assignment time in this direction — see reversal note below
  if behind is nonempty:
    return travel(opposite(direction))    # reverse: nothing further ahead, something behind
  return idle                             # this algorithm's idle policy: stay put
```

**Idle policy: stay put**, same choice as FCFS, made independently for this algorithm — a sweep that finds nothing pending in either direction simply stops sweeping where it is rather than parking somewhere fixed.

**Reversal note:** once `travel(opposite(direction))` is issued, `elevator.direction` flips at the engine level before the *next* decision point, so the following invocation recomputes `compatibleCallFloors` using the new direction automatically — the sweep-the-other-way behavior falls out of re-running the same logic each time, no extra state needed. This is the concrete mechanism behind "reverses at the last call in that direction" (LOOK), never sweeping to the building's physical top/bottom unless a call is actually there (which would be full SCAN).

### Algorithm 3: Nearest-car with directional matching (`nearestCarDirectional.ts`)

Same assignment-map structure as FCFS, with one change to candidate eligibility in `refreshAssignments`:

```
isCompatible(elevator, call):
  if elevator.state === 'idle': return true          # no committed direction to conflict with
  if elevator.direction !== call.direction: return false
  return call.direction === 'up'
    ? elevator.currentFloor <= call.floor
    : elevator.currentFloor >= call.floor
  # i.e.: already heading the right way, and hasn't already passed the call's floor

candidates = [e for e in snapshot.elevators
              if e.id not in assignments
              and e.capacityRemaining > 0
              and isCompatible(e, call)]
```

Everything else (nearest-by-distance selection among candidates, tie-break by id, per-elevator `decide()` routing, drop-off-before-pickup priority, **and idle policy: stay put, same independent choice as the other two**) is identical to FCFS. This is deliberate: the only behavioral difference from Algorithm 1 is the candidate filter, which is exactly what makes the two directly comparable on the same scenario (see comparative tests below).

### Ties and edge cases (applies across the three algorithms except where noted)

- **No elevator available** (all full, all busy, or — nearest-car-directional only — all moving the wrong way): the call simply stays active/unassigned and is reconsidered at every subsequent decision point until an elevator frees up or becomes compatible. No starvation prevention beyond ordinary greedy proximity — consistent with the project's existing stance that unserved/overflow situations are *measured* (Unit 05's job), not prevented by the engine or the algorithms.
- **Distance ties** in nearest-car selection: broken by elevator id in `snapshot.elevators` array order (stable insertion order, `"E1"` before `"E2"`, etc.) — deterministic, which matters both for unit-test assertions and for `00_main.md`'s seeded-reproducibility requirement (same input must produce the same dispatch decisions every run).
- **Multiple simultaneous unassigned calls in one invocation** (e.g. two calls registered at the same sim tick before any idle elevator reacts): `refreshAssignments`'s loop must exclude an elevator from `candidates` as soon as it's picked for an earlier call *in the same pass*, not only elevators with pre-existing assignments from prior invocations — called out explicitly in the pseudocode above (`# best is now excluded...`) because it's an easy off-by-one to get wrong, and it's a dedicated test case below.
- **A call no compatible car can currently reach** (nearest-car-directional): stays pending, re-evaluated every invocation, until compatibility changes (a car goes idle, or a moving car's position/direction shifts into range) — dedicated test below.
- **Duplicate actions for the same elevator**: the engine throws if a hook returns two actions for one elevator id in a single invocation. Each algorithm's per-elevator loop iterates `snapshot.elevators` once and emits exactly one action per elevator by construction, so this shouldn't be reachable — but it's cheap to assert directly as an invariant test per algorithm rather than trust-by-construction alone.

### What gets unit-tested

Two levels per algorithm, both needed: **hook-level** tests that call `algorithm.createHook()()` directly against hand-built `DispatchSnapshot` objects (fast, isolates assignment/routing logic from engine timing), and a smaller number of **integration** tests that drive the real `runSimulation` end-to-end with a small scripted scenario and inspect the resulting log — proving the algorithm actually works through the real event loop, not just against a snapshot shape.

**FCFS/naive nearest-car** (`fcfsNearestCar.test.ts`):
- Single call, single idle elevator not co-located: travels stepwise, stops on arrival (integration).
- Two simultaneous calls, two idle elevators at different distances: nearer elevator assigned to nearer call (hook-level).
- Equidistant elevators: deterministic tie-break (lower id) (hook-level).
- Onboard drop-off takes priority over diverting to a newly assigned pickup (hook-level).
- No available elevator (all full/busy): call remains active/unassigned across repeated invocations until one frees up (hook-level).
- Two calls registered in the same invocation don't get assigned to the same elevator (hook-level, targets the "excluded within the same pass" edge case above).
- No duplicate elevator ids in a single returned action array (invariant, hook-level).

**SCAN/LOOK** (`scanLook.test.ts`):
- Sweeping up with calls at floors 2 and 5 and nothing beyond 5: stops at 2, continues to 5, then reverses immediately rather than continuing toward the building's top floor — the core LOOK-vs-SCAN distinguishing test (integration, since it needs to observe behavior across several decision points).
- Ignores (doesn't stop for) an opposite-direction call while sweeping, but does serve it after reversing (integration).
- Idle elevator picks the correct initial direction toward the nearest pending floor (hook-level).
- No pending targets in either direction after finishing a sweep: goes idle, doesn't get stuck (hook-level).
- No duplicate elevator ids invariant (hook-level).

**Nearest-car with directional matching** (`nearestCarDirectional.test.ts`):
- Two elevators: one nearby but already moving away from the call, one farther but compatible — call assigned to the farther compatible car, not the nearer incompatible one (hook-level; this is the key differentiator).
- No compatible car currently available: call stays unassigned until one becomes idle or turns compatible (hook-level).
- An idle elevator is always a valid candidate regardless of its last direction (hook-level).
- No duplicate elevator ids invariant (hook-level).

**Comparative sanity tests** (`algorithms.test.ts`): the same small scripted scenario run through all three `Algorithm`s via `runSimulation`, asserting the resulting logs/behavior actually differ in the expected direction — not a metrics comparison (Unit 05's job), just proof the three are genuinely different strategies, not three names for the same behavior. At minimum: a scenario where Algorithm 1 sends the nearer-but-departing car (visible in the log as extra travel before the eventual stop) while Algorithm 3 sends the farther-but-compatible one directly.

### Open questions — all resolved during plan review

1. ~~**Idle elevator with no active calls**~~ — **Resolved: this is each algorithm's own independent decision, not a shared engine-level or plan-level rule.** Per developer feedback, an "idle policy" is itself a variation an algorithm can express — a future algorithm could plausibly return to a home floor while another stays put, and that difference would itself be worth comparing. All three algorithms in this unit independently choose **stay put** (see each algorithm's own "Idle policy" note above) — chosen the same way for all three here because it's the simplest starting behavior and keeps this unit's comparisons purely about dispatch strategy, not parking strategy, but it is not a constraint the interface or the engine imposes. A later algorithm is free to do something else.

2. ~~**Registry/metadata mechanism**~~ — **Resolved: no manually maintained registry.** Per developer feedback ("couldn't they be loaded real-time reading the files from the folder"), `index.ts` now discovers algorithm files automatically via `import.meta.glob` rather than a hand-maintained array — see "Discovery" above. `id`/`name` stay on `Algorithm` (still needed for the factory-per-trial reason and for Unit 06 to have something to display), but nothing about assembling the list is manual, so there's no ongoing maintenance burden or premature abstraction to weigh — adding an algorithm is just "add a file."

3. ~~**FCFS ordering caveat**~~ — **Resolved: fixed at the source.** `DispatchSnapshot.activeHallCalls`'s arrival-order guarantee is now a documented, tested contract of Unit 02's engine (commit `90c2b26`), not an incidental property this algorithm quietly depended on. See "FCFS ordering" above.

## AI Interactions

Implemented the full unit exactly as specified: `types.ts`, `shared.ts`, `fcfsNearestCar.ts`, `scanLook.ts`, `nearestCarDirectional.ts`, `index.ts`, plus the four test files (`fcfsNearestCar.test.ts`, `scanLook.test.ts`, `nearestCarDirectional.test.ts`, `algorithms.test.ts` — originally 22 new tests; see the "Correction" note below for post-review changes to test counts and content). No classes anywhere; each algorithm file is self-contained (per-file `decide`/`refreshAssignments`/tie-break helpers, deliberately duplicated between `fcfsNearestCar.ts` and `nearestCarDirectional.ts` rather than factored into a shared module, since the plan's own file layout and `shared.ts` scope only call out `directionFrom`/`distance` as genuinely shared — and per instruction, each algorithm's idle policy ("stay put") is implemented independently in its own `decide()`, not centralized). `index.ts`'s discovery block is copied verbatim from the plan. `npm run lint`, `npm run format` (reformatted only line-wrapping in the two newest test files, no content change) / `npm run format:check`, `npm run test` (45/45 passing), and `npm run build` (`tsc -b` + `vite build`, confirming `import.meta.glob` resolves correctly at build time) all pass cleanly, first attempt, under strict TypeScript with no `any`. Non-null assertions (`!`) are used only where a preceding assertion/branch already guarantees presence (e.g. after `expect(x).toBeDefined()` in a test, or `Map.get()` following a check that set the entry) — consistent with Unit 02's established standard; several `directionFrom(...)` call sites include a defensive `if (direction === null) return idle` fallback instead of an assertion, even though the null case is unreachable by construction given the preceding stop-checks, to keep the type-narrowing honest without asserting.

No deviations from the approved algorithm logic itself — the pseudocode for all three algorithms, the `isCompatible` filter, the same-pass exclusion, the tie-break rule, and the discovery mechanism are implemented exactly as specified. One point worth flagging clearly, since the plan was reviewed so thoroughly that a real deviation would be unusual (and this isn't one, but it's the closest thing to a wrinkle):

**The comparative test's "nearer/farther" framing had to be inverted from the plan's illustrative wording, for a structural reason inherent to the approved pseudocode itself, not an implementation choice.** The plan's example says "Algorithm 1 sends the nearer-but-departing car... while Algorithm 3 sends the farther-but-compatible one." Working through the actual approved candidate-filter pseudocode: FCFS's candidates require `state === 'idle'` unconditionally, while `nearestCarDirectional`'s `isCompatible` treats every idle elevator as compatible too (plus, additionally, some moving ones). This makes Algorithm 3's candidate pool a strict superset of Algorithm 1's for any given call and snapshot — so Algorithm 3's nearest-by-distance pick among its (larger) pool can never be *farther* than Algorithm 1's pick among its (smaller) pool; it can only be equal or nearer. A literal "Algorithm 1 picks nearer, Algorithm 3 picks farther" scenario is therefore not constructible from the approved pseudocode as written. The comparative test in `algorithms.test.ts` instead demonstrates the mathematically-consistent version of the same underlying point — that Algorithm 1's idle-only gate keeps it from ever using a compatible car that isn't idle, forcing it to send a *farther, previously-idle* car (with real, visible extra travel in the log) in a scenario where Algorithm 3 instead uses the *nearer, already-compatible, already-en-route* car directly, at zero extra travel. This is documented at length in the test file's own comments and in `03_algorithms_test.md`. Flagging this explicitly for developer sign-off: it's a clarification of the illustrative narrative in the "At minimum" comparative-test example, not a change to any algorithm's actual behavior or to the approved pseudocode, which is implemented verbatim.

### Correction (developer review, post-implementation): FCFS's `state === 'idle'` restriction was a real bug, not a simplification

Developer review of the above "nearer/farther inverted" flag identified the actual root cause: `nearestCarDirectional`'s entire purpose is to add a *direction* filter on top of FCFS's candidate pool, but direction is meaningless for an idle car — so restricting FCFS to idle-only elevators made its pool a strict *subset* of what direction-filtering alone would produce, which is backwards. That's not a quirk of "naive" behavior, it's a bug: it made it structurally impossible for FCFS to ever exhibit the exact flaw ("sends the geometrically nearest car even when that car is already moving away from the call") that this unit's own Objective names as the reason `nearestCarDirectional` exists. Fixed:

- `fcfsNearestCar.ts`'s candidate filter no longer checks `elevator.state` — any elevator without an existing assignment and with spare capacity is a candidate, idle or moving, regardless of direction. The plan's pseudocode (Algorithm 1, "Assignment memory") and this file's own top-of-file comment were corrected to match.
- `nearestCarDirectional.ts`'s comment was corrected — it previously (incorrectly) described the fix as being about idle-vs-moving eligibility; it's actually about direction compatibility, which was always its real differentiator.
- `fcfsNearestCar.test.ts`'s `'leaves a call unassigned across repeated invocations until an elevator becomes idle'` test encoded the buggy behavior directly (asserting a moving elevator stays unassigned) and was rewritten around the real "no candidate" cause (zero remaining capacity), plus a new test (`'is naive: assigns the nearer elevator... even though it is already moving away'`) proving the corrected, genuinely naive behavior directly at the hook level.
- `algorithms.test.ts`'s comparative scenario was rebuilt from scratch around a real direction-mismatch case (previously impossible pre-fix): the script and its extensive commentary were replaced; see the file for the current scenario and reasoning. The "inverted framing" limitation described above no longer applies — the comparative test now demonstrates the *original*, literal framing from this unit's Objective.

**A second, independent bug surfaced while validating the rebuilt comparative test**: an engine-level (Unit 02) boarding-direction bug that produced an infinite loop whenever an elevator had to travel one direction to reach a call registered in the opposite direction (a realistic, common scenario, not an edge case). This is **not** a Unit 03 issue — it lives in `simulation.ts`'s `handleStop` — but is recorded here because Unit 03's own testing is what surfaced it. Full details and the fix are in `dev_log/02_engine_done.md`'s "Amendment (during Unit 03 implementation)" section and commit `c7ea422`. Re-verified after the fix: 48/48 tests pass overall (24 engine + 23 algorithms + 1 pre-existing scaffolding placeholder test), lint/format/build all clean.

## Files Modified

Created:
- `src/algorithms/types.ts`
- `src/algorithms/shared.ts`
- `src/algorithms/fcfsNearestCar.ts`
- `src/algorithms/scanLook.ts`
- `src/algorithms/nearestCarDirectional.ts`
- `src/algorithms/index.ts`
- `src/algorithms/fcfsNearestCar.test.ts`
- `src/algorithms/scanLook.test.ts`
- `src/algorithms/nearestCarDirectional.test.ts`
- `src/algorithms/algorithms.test.ts`
- `dev_log/03_algorithms_test.md`

Modified:
- `dev_log/03_algorithms.md` (this file — AI Interactions, Files Modified, Status)

Not part of this unit, modified separately as amendments to Unit 02 and committed independently (see `dev_log/02_engine_done.md` for details, commits `90c2b26` and `c7ea422`):
- `src/engine/dispatch.ts`, `src/engine/simulation.ts` — `activeHallCalls` ordering guarantee, boarding-direction fix
- `src/engine/capacity.test.ts` — regression tests for both

## Status: Complete
