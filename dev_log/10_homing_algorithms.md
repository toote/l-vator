# Unit 10: Homing algorithm variants

## Objective

Add a "returns to the lobby after sitting idle too long" variant of each of the three existing dispatch algorithms — developer-requested, motivated directly by a real finding from this project's own investigation history: FCFS (and nearest-car-directional) can strand idle elevators wherever they happened to last deliver a passenger, since neither algorithm ever repositions an idle car. Under sustained one-origin-floor demand (e.g. up-peak), that creates a self-reinforcing cluster where 1-2 elevators do almost all the work while others sit fully idle far from the demand source (traced live: see `03_algorithms_done.md`'s concurrent-dispatch amendment). A homing policy — go park at floor 0 once idle for X ms — is a standard real-world mitigation and gives this project a natural new comparison: does homing measurably help, and at what cost (extra deadhead travel when it *doesn't* help)?

Scope, resolved with the developer up front:
- **All three** existing algorithms get a homing variant (6 algorithms total).
- The idle threshold is a **new, UI-configurable building setting** (`idleReturnThresholdMs`), not a hardcoded constant — consistent with every other timing parameter in this project.

## Design: what "homing" means

Each homing variant is its own file, not a flag on the existing one — consistent with this project's established "each algorithm is a separate file" convention (`00_main.md`) and with keeping the base algorithms completely unmodified (zero risk of regressing already-shipped, already-tested behavior).

**The idle-duration signal lives entirely in each variant's own closure memory** — no new field needed on `ElevatorSnapshot` or anywhere else per-elevator. Each variant's `createHook()` keeps a `Map<string, number>` (`idleSince`), keyed by elevator id:
- Whenever a `decide()` invocation would otherwise return `{ type: 'idle' }` (nothing to do): if `idleSince` has no entry for this elevator, set it to `snapshot.time` (just went idle *now*). Then, if `snapshot.time - idleSince.get(id) >= snapshot.idleReturnThresholdMs` **and** `elevator.currentFloor !== 0`, return `{ type: 'travel', direction: 'down' }` instead (floor 0 is always at or below any other floor, so "toward home" is always `down` once actually homing). Otherwise still return `idle`.
- Whenever a `decide()` invocation returns anything OTHER than idle (a real pickup, dropoff, or travel-toward-a-real-target), delete that elevator's `idleSince` entry — it's no longer idle, the clock resets.
- No special preemption logic needed: a homing elevator that's just issuing `travel` toward floor 0 with no assignment is, from the algorithm's own perspective, indistinguishable from any other idle-but-available elevator — the very next invocation where a real call needs an elevator will assign it normally (FCFS/nearest-car-directional) or let it detect the call directly (SCAN/LOOK), overriding the homing travel exactly the way any other redirect already works today. This falls directly out of `decide()`'s existing structure (a real target always takes priority over the idle/homing fallback) — no new logic needed to "interrupt" homing.
- Once a homing elevator actually reaches floor 0 with nothing else to do, the next invocation naturally returns plain `idle` again (target undefined, already at floor 0) — no infinite homing loop, no special-casing needed.

This applies near-identically to all three:

- **`fcfsNearestCarHoming.ts`** / **`nearestCarDirectionalHoming.ts`**: both already have exactly one `return idle` fallback path in `decide()` (`target === undefined`, i.e., no assignment and no carButtons) — the homing check slots in exactly there.
- **`scanLookHoming.ts`**: has two `return idle` fallback paths (the idle-direction branch when `nearest === undefined`, and the committed-direction branch's final `return idle` when nothing is ahead or behind) — the homing check slots into both, keyed by the same per-elevator `idleSince` map.

Pseudocode (identical shape in all three, illustrated against the FCFS-style fallback):
```
if (target === undefined) {
  if (!idleSince.has(elevator.id)) idleSince.set(elevator.id, snapshot.time);
  const idleFor = snapshot.time - idleSince.get(elevator.id)!;
  if (idleFor >= snapshot.idleReturnThresholdMs && elevator.currentFloor !== 0) {
    return { type: 'travel', elevatorId: elevator.id, direction: 'down' };
  }
  return { type: 'idle', elevatorId: elevator.id };
}
idleSince.delete(elevator.id);
... (existing logic, producing stop/travel toward the real target)
```

**Duplication vs. sharing:** the idle-tracking logic (a handful of lines) is small enough, and each base algorithm's `decide()` structure different enough, that this follows the project's existing precedent (`fcfsNearestCar.ts`/`nearestCarDirectional.ts` already duplicate their near-identical `decide()`/`refreshAssignments` rather than share them) rather than introducing a new shared helper. Open to reconsidering only if implementation reveals the duplication is worse than expected.

## New config field: `idleReturnThresholdMs`

- Added to `BuildingConfig` (`src/engine/types.ts`), a required field like every other timing parameter (`floorTravelTimeMs`, `doorDwellBaseMs`) — no precedent in this project for an optional `BuildingConfig` field, and an asymmetric exception would look like an oversight rather than a choice.
- **This requires adding the field to every existing `BuildingConfig` object literal across the codebase** (~25 files, mostly test fixtures — `grep -rl floorTravelTimeMs src/` enumerates them). Purely mechanical: one line per literal, same shape as when `doorDwellPerPassengerMultiplier` was originally added. Not a design risk, just a known, bounded amount of mechanical work to budget for.
- Validated at the same point `doorDwellBaseMs > 0` already is (`src/engine/simulation.ts`'s `validateBuildingConfig`) — but `idleReturnThresholdMs` legitimately means "return home immediately on going idle" at 0, unlike `doorDwellBaseMs` (which needs `> 0` to avoid the zero-dwell infinite-loop class documented in that file). Validation here is `>= 0`, not `> 0`.
- `DispatchSnapshot` (`src/engine/dispatch.ts`) gains a matching `idleReturnThresholdMs: number` field, populated by `simulation.ts`'s `buildDispatchSnapshot` from `config.idleReturnThresholdMs` — this is what the three new algorithms actually read; the base (non-homing) algorithms simply never look at it, exactly like they already ignore `time` for anything but tie-breaking-adjacent logic today.
- `state.ts`'s `defaultConfig()`: default value **30000** (30s) — long enough that an elevator finishing a normal delivery under typical demand doesn't immediately home (avoiding pointless empty-car churn), short enough to matter within this project's default 5-minute trial duration. Open to the developer's own preferred default.
- `configPanel.ts` / `validation.ts`: new numeric input alongside the other timing fields, same UI pattern (label, `min="0"`, live validation message).

## Color-slot stability (a real, now-live consequence of adding files)

`algorithmColor.ts` currently keys each algorithm's dashboard color to `algorithms.findIndex(...)` — i.e., `import.meta.glob`'s alphabetical-by-filename discovery order. Unit 08's plan flagged this explicitly as *not yet a live problem* with exactly 3 algorithms, but warned a new algorithm file sorting alphabetically before an existing one would silently shift that existing one's color. **This unit makes it live**: sorting all 6 filenames alphabetically interleaves each `*Homing.ts` file immediately after its base counterpart (e.g. `fcfsNearestCar.ts`, `fcfsNearestCarHoming.ts`, `nearestCarDirectional.ts`, ...) — which shifts `nearestCarDirectional`'s registry index from 1→2 and `scanLook`'s from 2→4, silently repainting both to different colors even though nothing about them changed.

Fixed here as part of this unit (the trigger Unit 08 anticipated, not deferred further): `algorithmColor.ts`'s `algorithmRegistryIndex` switches from `algorithms.findIndex(...)` (glob-order-derived) to an explicit, hand-maintained `COLOR_ORDER: readonly string[]` array of algorithm ids, append-only for future algorithms. The existing three ids stay first, in their current order, guaranteeing their colors are unchanged by this unit; the three new homing ids are appended after. `algorithmRegistryIndex`'s public signature/behavior is unchanged (still "an algorithm's fixed color-slot index, independent of a run's filtered subset") — only its internal source of truth changes.

New `--series-4/5/6` custom properties added to `style.css` (light + dark mode), validated against this project's actual surface colors via the `dataviz` skill's `scripts/validate_palette.js`, same process Unit 08 used for `--series-1/2/3`.

## Naming

| File | `id` | `name` |
|---|---|---|
| `fcfsNearestCarHoming.ts` | `fcfs-nearest-car-homing` | "FCFS / Nearest Car (Returns to Lobby)" |
| `nearestCarDirectionalHoming.ts` | `nearest-car-directional-homing` | "Nearest Car - Directional (Returns to Lobby)" |
| `scanLookHoming.ts` | `scan-look-homing` | "SCAN / LOOK (Returns to Lobby)" |

Matches each base algorithm's existing display name exactly, with a parenthetical suffix — makes the pairing obvious in the algorithm-selection checkboxes and dashboard legend without needing a separate grouping UI (out of scope; `algorithmSelect.ts`/dashboard changes are purely additive, no restructuring).

## What gets tested

Per new algorithm file, hook-level tests mirroring each base file's existing style:
- An elevator idle for exactly the threshold, not yet at floor 0 → starts traveling down.
- An elevator idle for less than the threshold → still returns idle (no premature homing).
- An elevator that goes idle, then gets a real assignment/call before the threshold elapses → the idle clock is irrelevant, normal dispatch behavior unchanged, and (implicitly) `idleSince` gets cleared (verified by then letting it go idle again afterward and confirming the clock restarted rather than reusing the earlier idle-since timestamp).
- An elevator already at floor 0 when idle-too-long → stays idle (no pointless "travel nowhere").
- A homing elevator that reaches floor 0 → returns to plain idle, does not loop.

One integration-level test per variant (mirroring the existing `describe('X (integration)')` blocks): a scenario where, under the corresponding base algorithm, an elevator would be measurably stuck far from a demand floor, and under the homing variant it proactively repositions and reduces wait time — a direct, measured demonstration of the feature's actual point, not just unit-level plumbing.

`algorithmColor.test.ts`: extended to prove `algorithmRegistryIndex`/`algorithmColorVar` are stable for the original three ids regardless of the three new files existing (the actual regression this unit's own additions would otherwise cause), plus coverage for the three new ids' slots.

Real browser verification (config panel's new field, all 6 algorithms selectable and distinguishable on the dashboard/replay, colors visually distinct) — same bar as every other UI-touching unit.

## Files

Created: `src/algorithms/fcfsNearestCarHoming.ts`, `nearestCarDirectionalHoming.ts`, `scanLookHoming.ts`, and their `.test.ts` files; `dev_log/10_homing_algorithms_test.md`.

Modified: `src/engine/types.ts` (`BuildingConfig.idleReturnThresholdMs`), `src/engine/dispatch.ts` (`DispatchSnapshot.idleReturnThresholdMs`), `src/engine/simulation.ts` (`buildDispatchSnapshot` populates it; `validateBuildingConfig` gains the `>= 0` check), `src/ui/state.ts` (default value), `src/ui/configPanel.ts` / `validation.ts` (new field), `src/ui/dashboard/algorithmColor.ts` (+ its test) for the color-slot fix, `src/style.css` (`--series-4/5/6`), and every existing `BuildingConfig` object literal across the codebase (mechanical, ~25 files) for the new required field.

## Open questions (resolved)

1. **Default `idleReturnThresholdMs`: 30000ms (30s).** Confirmed by the developer.
2. **Home floor hardcoded to 0**, not configurable in this unit. Confirmed by the developer; a configurable home floor is a future enhancement if it turns out to matter.

## AI Interactions

Implemented exactly as planned, with one deviation and one implementation note:

**Deviation (mechanical, not a design change):** the implementing agent's session stalled mid-task
(no progress for 600s) after completing the core algorithm/config/color-slot work but before
adding the `--series-4/5/6` CSS colors or writing this file's remaining sections. Picked up
directly by the reviewing session rather than re-running the agent from scratch — verified the
already-completed work first (216/216 tests passing, one small lint error: an unused
`SAFETY_CUTOFF` const left over in `fcfsNearestCarHoming.test.ts`, fixed by removing it), then
finished the remaining scope directly.

**Color selection took real iteration, worth documenting.** The plan's instruction to validate
`--series-4/5/6` via the dataviz skill undersold the actual difficulty: with 3 existing colors
already occupying blue/orange/green, and `--pairs all` requiring every pair (not just adjacent) to
clear CVD/normal-vision separation, several hand-picked candidates failed — warm hues (gold, amber,
brown, red) repeatedly collapsed into each other and into the existing orange under deutan/protan
simulation, which is expected (red-green colorblindness genuinely compresses that whole hue
region) but not obvious from eyeballing hex codes. Resolved by writing a small throwaway script
(not committed — scratch only) that imports `validate_palette.js`'s exported `validate()` function
directly and searches many HSL-generated candidates programmatically rather than guessing by hand;
found a passing 6-color set for both light and dark mode this way. Full validation output recorded
in `10_homing_algorithms_test.md`.

**Implementation note, not a deviation:** `scanLookHoming.ts`'s header comment documents a real
structural subtlety found (and confirmed correct, not a bug) while implementing it — once a homing
`travel` action is issued, the engine sets `elevator.direction` to `'down'` before the next
decision point, so the very next invocation lands in the committed-direction branch, not the
idle-direction branch. This is fine (the committed branch's own idle fallback re-fires the same
homing check via the same `idleSince` entry, continuing the descent one floor at a time, and
naturally picks up any real `'down'` call in its path exactly like an ordinary sweep would) but
was worth calling out explicitly since it's the kind of cross-branch state interaction that could
otherwise look like a missed case on a quick read.

## Files Modified

Created: `src/algorithms/fcfsNearestCarHoming.ts`, `nearestCarDirectionalHoming.ts`,
`scanLookHoming.ts`, and their `.test.ts` files; `dev_log/10_homing_algorithms_test.md`.

Modified: `src/engine/types.ts` (`BuildingConfig.idleReturnThresholdMs`), `src/engine/dispatch.ts`
(`DispatchSnapshot.idleReturnThresholdMs`), `src/engine/simulation.ts` (`buildDispatchSnapshot`
populates it; `validateBuildingConfig` gains the `>= 0` check), `src/ui/state.ts` (default value
30000), `src/ui/configPanel.ts` / `validation.ts` (new field + validation),
`src/ui/dashboard/algorithmColor.ts` (+ its test) for the `COLOR_ORDER` color-slot fix,
`src/style.css` (`--series-4/5/6`, light + dark), and every existing `BuildingConfig` object
literal across the codebase (mechanical — `src/algorithms/*.test.ts`, `src/engine/*.test.ts` +
`testFixtures.ts`, `src/generation/*.test.ts`, `src/metrics/computeMetrics.test.ts`,
`src/scenarios/upPeakDemo.ts`, `src/ui/buildScenario.test.ts`, `src/ui/replay/waitingCounts.test.ts`,
`src/ui/dashboard/dashboardChartData.test.ts`) for the new required field.

## Amendment (during developer review, before this unit's own commit): unvisited-assignment hostage bug fixed in the homing variants too

While this unit sat uncommitted awaiting review, the developer found and the base algorithms got fixed for a real bug: an elevator could hold a hall-call assignment hostage indefinitely without ever visiting it, since the release logic only ever fired for an elevator that had *visited then left* — see `03_algorithms_done.md`'s matching amendment for the full root cause, the design discussion (idle-preference in candidate selection conflicting with FCFS's documented "naive" character, resolved by redefining naive as "nearest *available*"), and the fix (idle-preference plus a bounded unvisited-release timeout, backed by a new `DispatchSnapshot.floorTravelTimeMs` field).

Since `fcfsNearestCarHoming.ts` and `nearestCarDirectionalHoming.ts` duplicate their base algorithms' `refreshAssignments` logic exactly (per this unit's own "Duplication vs. sharing" note), the identical fix was folded into both here, before this unit's first commit, rather than shipping known-buggy code and amending it separately afterward. No interaction with homing itself — a homing elevator (idle, drifting toward floor 0) is exactly the kind of "genuinely idle" candidate the idle-preference fix favors, and the unvisited-release timeout applies identically regardless of whether the elevator that won an assignment is homing-capable.

## Status: Implemented — awaiting developer validation
