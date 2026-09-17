# Unit 07: Results presentation

## Objective

Replace Unit 06's plain, unstyled results table with the project's final planned deliverable: an
animated replay of one selected run ("Run 7 of 20") showing elevators moving through a building
cross-section over simulated time, plus a dashboard that aggregates and compares the eight
headline metrics across all algorithms run. This is the last unit in `00_main.md`'s Planned Units
list — after this unit, the app's baseline scope (per `00_main.md`, "What This Is") is complete.

Builds directly on top of Unit 06's existing UI (`src/ui/`) — same `AppState`/`render()` pattern,
same "no framework" constraint — not a separate app. No new runtime dependency is proposed
(confirmed against the current `package.json`: no charting/animation library present).

## Implementation

### A gap this unit must close first: raw per-trial results are currently discarded

`runControls.ts` (Unit 06) computes `trialResults = runTrialBatch(...)` — which includes each
trial's full `SimEventLogEntry[]` log and `finalState` — but only stores
`computeMetrics(trialResults, scenario)`'s output in `AppState.run`. The `TrialRunResult[]` itself
is thrown away once `computeMetrics` returns. Nothing a replay needs (a specific trial's `log`) is
retained anywhere in the current UI. This is not a bug in Unit 06 (it correctly did only what its
own scope — a metrics table — required); it is scope this unit must pick up.

Similarly, `AppState.run`'s `'done'` variant carries no `BuildingConfig`. A replay's cross-section
needs floor count, elevator count, and floor-travel time — and `state.config.building` is **not**
safe to read for this after a run completes, because it's a live, mutable draft the user can keep
editing (e.g. changing floor count) while a completed run's results are still on screen. The
building actually used for a given run must be captured at run time, not re-derived from
possibly-since-edited config.

**Recommendation:** extend `RunState`'s `'done'` variant to snapshot both:

```ts
export type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | {
      status: 'done';
      metrics: AlgorithmMetrics[];
      trialResults: TrialRunResult[]; // Unit 04's TrialRunResult[] — retained for replay
      building: BuildingConfig; // the exact config this run used, not a live reference
    }
  | { status: 'error'; message: string };
```

`runControls.ts`'s existing `onclick` handler already computes everything needed (`scenario`,
`trialResults`, `metrics`) locally — this is a small additive change to what it stores, not a
pipeline change.

### AppState: replay-selection state

Which algorithm and which trial to replay, and playback position/state, are UI-selection concerns
independent of whether results exist — proposed as a sibling field to `run`, not nested inside
`RunState['done']`:

```ts
export interface ReplaySelection {
  /** Single-panel replay: one algorithm at a time (developer-resolved — see Open Questions;
   * side-by-side, multi-algorithm replay of the same trial is deferred as a fast-follow, not
   * baseline). */
  algorithmId: string;
  trialIndex: number;
  simTimeMs: number;
  playing: boolean;
  /** Simulated ms advanced per real ms — e.g. 5 means 5x speed. */
  speed: number;
}

export interface AppState {
  config: ConfigDraft;
  selectedAlgorithmIds: string[];
  run: RunState;
  replay: ReplaySelection | null; // null until a run completes
}
```

`runControls.ts` (re)initializes `state.replay` whenever a run reaches `'done'`: default to the
first algorithm actually run, trial 0, `simTimeMs: 0`, `playing: false`, a sensible default speed
(see "Playback controls" below). Re-running replaces it wholesale, same as `run` itself.

### Replay animation mechanics: simulated-time clock with exact interpolation

The engine's atomic event is floor-to-floor movement (`00_main.md`, "Architecture") — an
`elevatorArrived` entry is logged at **every** floor an elevator passes, not just stops. This
means, for a single elevator, the log entries between any two consecutive `elevatorArrived`
records span exactly one floor of travel over exactly `floorTravelTimeMs`. There is no ambiguity
to interpolate through: position between two known timestamps is a plain linear interpolation,
not an approximation.

Recommended approach — option (a) from the brief, concretely specialized to this log shape:

- A **simulated-time clock** (`state.replay.simTimeMs`) advances at `speed`× real time while
  `playing`, clamped to `[0, finalState.time]`.
- A pure function computes each elevator's **displayed state at time T** by reading the log, not
  by replaying the simulation:
  - **Position** — see "Correction" note immediately below; this is the one place in this unit
    where naive interpolation is actually wrong, not just simplified.
  - **Door state**: the most recent `doorsOpened`/`doorsClosed` for that elevator at or before T.
  - **Onboard count**: a running net count, `passengerBoarded` count minus `passengerAlighted`
    count for that elevator, folded up to T (the log carries no live onboard-count field, so this
    is reconstructed, not read directly).
  - **Active hall calls**: the set of `(floor, direction)` pairs with a `hallCallRegistered` at or
    before T and no matching `hallCallCleared` at or before T — independent of any elevator.

**Correction (developer review, before implementation): interpolating directly between two `elevatorArrived` timestamps is wrong whenever the earlier one included a stop.** The original draft of this section proposed finding the two `elevatorArrived` entries `(T_A, floor_A)` / `(T_B, floor_B)` surrounding T and linearly interpolating across the full `[T_A, T_B]` span whenever no dwell is *currently* active at T. That's incomplete: when a stop occurs at `floor_A`, `doorsOpened` is logged at the exact same timestamp as that `elevatorArrived` (confirmed in `simulation.ts`'s `handleStop`, called synchronously from `handleElevatorArrived`), and the matching `doorsClosed` fires `dwellMs` later — so `T_B - T_A = dwellMs + floorTravelTimeMs`, not just `floorTravelTimeMs`. Interpolating linearly across the *whole* `[T_A, T_B]` span would show the elevator visibly creeping away from `floor_A` throughout what should be a motionless dwell, then continuing to creep (too slowly) once it actually starts moving — wrong in exactly the case (a stop mid-route) this project's algorithms exist to make interesting.

Corrected algorithm — the interpolation's start point is the *travel* start, not the arrival timestamp:

```
positionAtTime(elevatorId, T, log):
  find (T_A, floor_A) and (T_B, floor_B): the two elevatorArrived entries for this elevator
  surrounding T (binary search; before-first-entry → floor 0; after-last-entry → floor_A, fixed)

  dwellOpen = this elevator's doorsOpened entry with time === T_A, if any (a stop happened here)
  if dwellOpen exists:
    dwellClose = this elevator's next doorsClosed entry (time > T_A)
    if T < dwellClose.time: return floor_A          # still dwelling — fixed, no interpolation
    travelStart = dwellClose.time                     # motion resumes exactly here
  else:
    travelStart = T_A                                  # passed straight through, never stopped

  fraction = (T - travelStart) / (T_B - travelStart)
  return floor_A + fraction * (floor_B - floor_A)
```

Before an elevator's first log entry, position is floor 0 (confirmed against `simulation.ts`: elevators are constructed with `currentFloor: 0`).

- **No CSS transitions.** Because both normal playback (many small time steps) and scrubbing (one
  large, arbitrary jump) go through the exact same "compute state at T" function, position is set
  directly (`transform: translateY(...)`) every frame/seek rather than animated via CSS duration —
  a CSS transition would fight a scrub jump and can't stay in sync with a variable playback speed.

This is deliberately not full physics (no easing, no acceleration/deceleration) — a toy project
doesn't need it, and the log's floor-to-floor atomicity means linear interpolation (once correctly
anchored to the actual travel-start time, per the Correction above) is exact for how the engine
models movement, not a simplification of something richer.

### Visual representation

Plain positioned DOM + CSS, no canvas — consistent with "vanilla TS, no framework, no unnecessary
dependency," and the scene is simple (a handful of floors × a handful of shafts, not thousands of
elements):

- A grid: one row per floor (top = highest floor, per `00_main.md`'s 0-indexed-from-ground
  convention), one column per elevator shaft, sized from `building.floorCount` /
  `building.elevatorCount`.
- Each shaft column has one absolutely/flex-positioned car element per elevator, moved via
  `transform: translateY(...)` computed from the interpolated floor each frame.
- Car element shows: a passenger-count badge (`onboardCount` / `capacity`), and a visual door-state
  cue (e.g. a border/fill change on open vs. closed — no animated sliding doors; unnecessary
  detail for a toy project).
- Each floor row shows a small hall-call indicator per direction (lit when that `(floor,
  direction)` pair is in the active set at the current T).
- Colors/contrast must use the existing `--text`/`--bg` custom properties in `style.css` (already
  dark-mode-aware via `prefers-color-scheme`) rather than hardcoded colors, so the replay doesn't
  break dark mode.

### Playback controls

- Play/pause toggle.
- Speed selector (e.g. 1x/5x/10x/20x, default something in the 5x–10x range — at 1x, this
  project's default 5-minute scenario would take 5 real minutes to watch in full, too slow for
  actually validating algorithm behavior; exact default speed list is a minor implementation
  choice, not an open question worth blocking on).
- Scrub/seek: a range input bound to `[0, finalState.time]`, driving `state.replay.simTimeMs`
  directly — since "state at T" is a pure function of the log, scrubbing is exact and free of
  drift, not an approximation.
- Trial selector: a dropdown/stepper, "Run `trialIndex + 1` of `trialCount`".
- Algorithm selector: which of the algorithms actually included in this run to replay.

**Side-by-side replay — resolved: deferred, not baseline.** Unit 04's fairness guarantee (trial K's
arrivals are byte-for-byte identical across every algorithm compared) would make replaying the same
trial across multiple algorithms side by side both correctness-free and cheap to add later — worth
keeping in mind as a natural fast-follow — but this unit ships single-panel replay only: one
algorithm, one trial, at a time.

### File layout

```
src/ui/
  replay/
    replayFrame.ts      # pure: per-elevator/hall-call state-at-time-T computation (see below)
    replayClock.ts       # pure: simTime advance/clamp math (speed × elapsed, bounds)
    replayCrossSection.ts # DOM: building grid, car elements, hall-call indicators for ONE
                           # algorithm's ONE trial; exposes update(frame) for imperative
                           # per-frame redraws (no full rebuild)
    replayControls.ts    # DOM: play/pause, speed, scrub, trial/algorithm selectors; owns the
                           # requestAnimationFrame loop
    replayView.ts        # orchestrator: single-panel — one cross-section for the currently
                           # selected algorithm/trial (see "Side-by-side replay" — deferred)
  dashboard/
    dashboardTable.ts     # upgraded comparison table (absorbs/replaces resultsView.ts's old
                           # table) — sortable + best-algorithm highlighting; no charts (see
                           # "Dashboard content" — deferred)
    dashboardView.ts      # orchestrator: renders the table
```

`resultsView.ts` stays as the top-level "Results" section (idle/running/error messages unchanged
verbatim from Unit 06), but its `'done'` branch changes from directly building a table to
rendering `renderDashboardView(state)` + `renderReplayView(state, render)`. The old
`renderResultsTable`/`COLUMNS`/`metricsRow` logic moves into `dashboardTable.ts` as the literal
upgrade path (same data, richer presentation), not left duplicated alongside the new code.

### A new pattern for `app.ts`'s render cycle: an animation loop that doesn't call `render()`

Every existing render in this codebase (Unit 06) either mutates the DOM directly without
re-rendering (text input `oninput`) or calls the passed-in `render()` to rebuild a subtree
wholesale on structural change (checkbox toggle, scenario-mode switch). Neither fits a 60fps
animation: calling the outer `render()` every frame would tear down and rebuild the *entire app
tree* — config panel, algorithm checkboxes, dashboard — many times a second, which is wasteful and
would fight input focus exactly the way Unit 06's state-model doc warned against for text fields.

**Resolution:** `replayControls.ts` owns its own `requestAnimationFrame` loop internally. Each
frame it (1) advances `state.replay.simTimeMs` via `replayClock.ts`'s pure step function, (2)
calls `computeReplayFrame` (pure), and (3) calls `replayCrossSection.ts`'s `update(frame)` to
imperatively patch only the car/door/badge/indicator elements it already created — never touching
the rest of the app's DOM and never calling the outer `render()`. The outer `render()` is still
called for genuinely structural changes: a new run completing, switching which trial/algorithm is
selected (rebuilds which cross-section(s) exist), or play/pause/speed changing (small enough to
just re-render that section, or handled by direct mutation like Unit 06's text fields — either
is fine; not worth over-specifying here). This is worth calling out explicitly in review since
it's the first genuine exception to "just call render()" in this codebase.

### Dashboard content

- **Table upgrade** (concrete, not just "better styling"): sortable columns (click a header to
  sort ascending/descending by that metric across algorithms), and highlighting the best
  algorithm per metric (bold or a colored cell) — which requires knowing, per metric, whether
  lower or higher is better (e.g. lower average wait time is better; higher throughput is better;
  lower unserved% is better). Recommend a small pure function,
  `bestAlgorithmId(metrics: AlgorithmMetrics[], key, direction: 'lower' | 'higher') => string |
  null`, driven by a small static table of metric→direction — directly unit-testable.
- **Charts — resolved: table only, no charts in this unit.** The upgraded, sortable,
  best-algorithm-highlighted table is the full extent of the dashboard's presentation for now;
  charts remain a candidate future addition if the table alone doesn't feel sufficient once built.

### Performance

Expected scale for this project (a handful of elevators, a run duration on the order of minutes,
moderate arrival rates) puts a trial's log at roughly hundreds to low thousands of entries — a
full linear scan per animation frame would still almost certainly be fine at that size. To stay
comfortably ahead of that rather than relying on it:

- Once per trial/algorithm **selection change** (not per frame), group that trial's log by
  `elevatorId` into per-elevator arrays (already time-ordered, since the source log is) — O(n)
  once, not O(n) every frame.
- Per frame, find the surrounding `elevatorArrived` entries via **binary search** on each
  elevator's array (O(log n) per elevator per frame) rather than re-scanning the whole log.
- Door state / onboard count / active hall calls at T can be derived from the same
  per-elevator (and a similarly grouped hall-call-only) arrays via binary search for "latest
  entry at or before T," rather than folding from the start of the log every frame.

This is a binary-search-over-precomputed-groups approach, not an interval tree or anything
heavier — appropriately sized for a toy project, not over-engineered, per the brief.

### What gets tested

Consistent with Units 02–06's established split (Vitest for pure logic, manual browser
verification for DOM/animation):

**Vitest, pure logic, exact hand-computed fixtures (small hand-authored logs, mirroring Unit 02's
`testFixtures.ts` style):**
- `replayFrame.ts`: interpolated position at various T strictly between two `elevatorArrived`
  entries with NO stop at the earlier one (straight pass-through — plain interpolation across the
  full span); position while dwelling (doors open, between `doorsOpened` and `doorsClosed`);
  **the regression case from the Correction above — a stop DID occur at the earlier
  `elevatorArrived`: assert position is fixed at that floor for the entire dwell window, then
  resumes interpolating from `doorsClosed`'s timestamp (not the earlier `elevatorArrived`'s
  timestamp) once T passes it** — the specific case that was wrong in this plan's first draft;
  before an elevator's first log entry (floor 0); door state transitions; onboard count across a
  boarding-then-alighting sequence; active hall calls across register/clear boundaries, including
  T exactly on an event timestamp (edge case worth its own test).
- Binary-search helpers directly: empty array, T before the first entry, T after the last entry, T
  exactly matching an entry.
- `replayClock.ts`: simTime advance math, clamping at 0 and at `finalState.time`, speed scaling.
- `dashboardTable.ts`'s `bestAlgorithmId`: lower-is-better vs. higher-is-better cases, ties,
  `null`-valued metrics (e.g. `averageWaitTimeMs: null` when nobody was served).

**Manual/browser verification (no jsdom, per Unit 06's precedent):**
- Actual animation smoothness at each speed setting, scrub responsiveness, play/pause behavior.
- Visual layout of the cross-section (floor/shaft grid, car positioning, door/badge/hall-call
  indicators) at a few different building sizes (1 floor, many floors; 1 elevator, many
  elevators).
- Trial/algorithm selector behavior, including side-by-side replay if approved.
- Dashboard table sorting/highlighting and any charts, in both light and dark mode.
- End-to-end: run a scenario, replay it, confirm what's animated actually matches the dashboard's
  numbers for that same trial (e.g. a trial with unserved passengers should visibly show someone
  left behind).

## Open questions for developer sign-off

1. ~~**Side-by-side multi-algorithm replay of the same trial**~~ — **Resolved by developer:
   deferred.** Single-panel replay (one algorithm, one trial, at a time) is this unit's baseline;
   side-by-side is a clearly-scoped future fast-follow, not built here.
2. ~~**Charts on the dashboard**~~ — **Resolved by developer: table only.** No charts in this
   unit; the sortable, best-algorithm-highlighted table is the full dashboard presentation.
3. ~~**Default playback speed and speed options**~~ — **Accepted as proposed (no objection
   raised):** 1x/5x/10x/20x, 5x default.
4. ~~**`RunState['done']` retaining full per-trial logs in memory**~~ — **Accepted as proposed:**
   a deliberate, visible tradeoff, not a real concern at this project's scale.

## Scope check against `00_main.md`'s Future Enhancements

Re-confirmed none of the three explicitly-out-of-baseline items need any changes from this unit:
manual/interactive mode (this unit only replays *already-run* batch results, no live/clickable
simulation), destination-dispatch algorithms (no call-model change — replay consumes the existing
`SimEventLogEntry` shape as-is), and UI-authorable scripted scenarios (this unit is purely
results-side; scenario authoring/`buildScenario.ts` is untouched). After this unit, `00_main.md`'s
Planned Units list is empty and those three remain the only explicitly deferred items.

## AI Interactions

Implemented per the approved plan, including the corrected interpolation algorithm verbatim from the "Correction" note. `replayFrame.ts`'s `positionAtTime` implements exactly the pseudocode's branches (before-first-entry → floor 0; after-last-entry → fixed; dwell-open-at-`T_A` detection via an exact timestamp match against `doorsOpened`; `travelStart` anchored to `doorsClosed`'s timestamp when a dwell occurred, or to `T_A` directly when the elevator passed straight through). The regression test (`replayFrame.test.ts`) explicitly computes and asserts against the numeric value the *original, uncorrected* algorithm would have produced (2.875 vs. the correct 2.5 at a specific probe time) — confirmed by independent developer review to be a genuine differentiating test, not one that would pass either way.

`RunState['done']` extended with `trialResults: TrialRunResult[]` and a snapshotted `building: BuildingConfig` (captured at run time, not a live reference to the mutable config draft). `AppState.replay: ReplaySelection | null` added as a sibling to `run`, single-`algorithmId` (not plural) per the developer's decision to defer side-by-side replay. Dashboard is table-only (no charts) per the developer's decision. Performance follows the plan exactly: `groupReplayLog` runs once per trial/algorithm selection, `countAtOrBefore` binary search drives every per-frame lookup. The replay animation loop is self-contained in `replayControls.ts` and does not call the outer `app.ts` `render()`, patching only its own elements via `update(frame)`; it self-terminates via an `!wrapper.isConnected` check when the DOM section it belongs to is torn down by a structural re-render (confirmed working via manual testing — see `07_results_test.md`).

One pre-existing test fixture required an additive one-line fix: `src/ui/validation.test.ts`'s `makeState()` helper needed `replay: null` added to keep satisfying `AppState`'s now-larger shape — no assertions changed.

No deviations from the approved plan's design. Real browser verification (Playwright driving actual installed Chrome, `claude-in-chrome` unavailable this session, consistent with Unit 06's precedent) was performed in both dev and production-preview modes under a fixed seed for reproducibility, with the mid-route-stop interpolation fix specifically verified both by direct pixel-position sampling across many scrubbed timestamps and by targeted before/during/after screenshots — see `dev_log/07_results_test.md` for full detail. No new runtime dependency added (confirmed via `git status` showing no `package.json`/`package-lock.json` diff); no stray scratch files or processes left behind.

## Files Modified

Created: `src/ui/replay/replayFrame.ts`, `replayClock.ts`, `replayCrossSection.ts`, `replayControls.ts`, `replayView.ts`, `replayFrame.test.ts`, `replayClock.test.ts`; `src/ui/dashboard/dashboardTable.ts`, `dashboardView.ts`, `dashboardTable.test.ts`; `dev_log/07_results_test.md`.

Modified: `src/ui/types.ts` (`RunState['done']` extended, `ReplaySelection`/`AppState.replay` added), `src/ui/state.ts` (initial `replay: null`), `src/ui/app.ts`, `src/ui/runControls.ts` (populates `trialResults`/`building`, initializes `replay` on run completion), `src/ui/resultsView.ts` (`'done'` branch now renders dashboard + replay instead of the old inline table; idle/running/error unchanged), `src/ui/validation.test.ts` (one-line fixture fix), `dev_log/07_results.md` (this file).

## Status: Complete
