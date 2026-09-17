# Unit 07: Results presentation - Test Instructions

## Test Objectives

Confirm the animated single-panel replay and the upgraded comparison dashboard work end-to-end on
top of Unit 06's existing UI: a completed run's per-trial logs (`TrialRunResult[]`) and the exact
`BuildingConfig` used are retained (`RunState['done']`), the dashboard table is sortable and
highlights the best algorithm per metric, and the replay cross-section animates elevators using
the plan's **corrected** interpolation algorithm — in particular, that a mid-route stop makes an
elevator visibly **stop** (fixed position, doors open) rather than creep through the dwell, then
resume smooth motion anchored to `doorsClosed`'s timestamp, not the earlier `elevatorArrived`'s.
Per this project's established split (Units 02-06), pure logic (`replayFrame.ts`, `replayClock.ts`,
`dashboardTable.ts`'s `bestAlgorithmId`) is Vitest-covered with exact hand-computed fixtures;
everything DOM/animation-touching is verified only by actually running the app in a browser — this
file's Manual Tests section is the primary verification method for the replay/dashboard rendering,
sorting, playback, and the interpolation correction, not a supplement to the automated tests.

## Manual Tests

**Tooling note:** identical situation to Unit 06 (see `06_ui_test.md`) — the `claude-in-chrome` MCP
browser tools were unavailable in this session (`list_connected_browsers` returned `[]`, no Chrome
extension paired). As a substitute that still exercises a real, full Chromium/Chrome engine, these
tests were driven with Playwright's `chromium.launch({ channel: 'chrome' })`, controlling the
actual installed Google Chrome on the host headlessly via the Chrome DevTools Protocol. Playwright
was installed only into a scratch directory outside the project (`npm init` + `npm install
playwright` inside the session's scratchpad `pw/` folder) — never added to `package.json`; verified
afterward that `package.json`/`package-lock.json` show no diff (`git status` confirms only the
intended `src/ui/**` files changed). All scratch scripts and screenshots were deleted at the end of
this session, and every launched headless Chrome instance was closed via `browser.close()` (no
stray processes — verified via `ps aux | grep vite` and `| grep chrome` at the end, only the
developer's own long-running Chrome windows remained). Console/page-error listeners
(`page.on('console')`/`page.on('pageerror')`) were attached for every run below.

To make the run reproducible across script iterations, the config panel's **Seed** field was set
to a fixed value (`424242`) before clicking Run, keeping every scrub/timestamp/screenshot below
describing the exact same simulated batch.

### 1. Dev server (`npm run dev`, `http://localhost:5173/L-vator/`)

1. **Load the page, set a fixed seed, run the default scenario.** Defaults unchanged from Unit 06
   (5 floors, 2 elevators, capacity 8, up-peak, all 3 algorithms selected). Set Seed to `424242`,
   click Run. **Result: confirmed** — button returned to "Run" after the batch completed; no
   console/page errors.

2. **Dashboard table renders with all 10 columns.** Confirmed header row exactly: `Algorithm`,
   `Trials`, `Avg wait (ms)`, `Max wait (ms)`, `Avg travel (ms)`, `Total distance (floors)`,
   `Throughput (per hour)`, `Avg occupancy (%)`, `Deadhead (%)`, `Unserved (count / %)` — one row
   per selected algorithm (3), real distinct numbers, e.g.:

   | Algorithm | Trials | Avg wait | Max wait | Avg travel | Total dist. | Throughput | Occupancy | Deadhead | Unserved |
   |---|---|---|---|---|---|---|---|---|---|
   | FCFS / Nearest Car | 10 | 9016.1 | 34271.6 | 16372.5 | **76.6** | 336.6 | **14.6** | **43.9** | 0 (0.0) |
   | Nearest Car (Directional) | 10 | **5581.5** | **17892.6** | **13546.4** | 100.5 | **346.7** | 11.1 | 45.9 | 0 (0.0) |
   | SCAN / LOOK | 10 | 6160.0 | 30745.7 | 14698.7 | 100.3 | 343.1 | 11.1 | 47.0 | 0 (0.0) |

   (Bold = highlighted best-per-metric, confirmed below.)

3. **Sorting.** Clicked the "Unserved (count / %)" header. **Result: confirmed** — header text
   changed to `Unserved (count / %) ▲`; clicked again, changed to `Unserved (count / %) ▼`
   (direction toggles correctly). Row order for this particular batch happened to already be
   ascending by unserved count (all three algorithms tied at 0 unserved here, so order was
   unaffected) — sort *mechanics* (arrow indicator, direction toggle, no crash) confirmed directly;
   the underlying comparator logic (ascending/descending, nulls-last) is exhaustively covered by
   `dashboardTable.test.ts`'s unit tests instead, since this particular real run didn't happen to
   produce a metric with a visible reordering.
4. **Best-algorithm highlighting.** Counted 7 bold+background-highlighted cells across the table
   (of 8 eligible metric columns) — one column (Unserved, all-zero 3-way tie) correctly had **no**
   highlight, directly confirming `bestAlgorithmId`'s "tie -> null, nothing highlighted" behavior
   in a real run, not just in the unit test. Highlight style
   (`background: color-mix(in srgb, var(--text) 12%, var(--bg))` + bold) confirmed visually
   distinct in both light and dark mode (see step 10).

5. **Replay section renders at the correct size for the building.** Confirmed: 2 car columns
   (`E1`, `E2` — matches `elevatorCount: 2`), 6 floor rows (`Floor 5` down to `Floor 0` — matches
   `floorCount: 5`, i.e. `floorCount + 1` levels), each car showing badge `0/8` (onboard count /
   capacity) at simTime 0.

6. **The core correctness check: a mid-route stop STOPS, doesn't creep.** Rather than relying on
   eyeballing playback alone, the timeline was scrubbed in 250ms steps across the first two
   minutes of simulated time, reading each car's `style.transform` (`translateY(...)`) at every
   step, and scanning for runs of ≥3 consecutive identical values bracketed by *different* values
   immediately before and after (proof of "was moving, stopped, moved again," not just "sat idle
   the whole time"). **Result: confirmed**, multiple such stop windows detected per car, e.g. car
   `E2`: fixed at `translateY(80px)` for the entire window `t=[55250ms, 63250ms]` (8 real seconds
   of simulated dwell), with the immediately preceding sample at `134.004px` and the immediately
   following sample at `29.0043px` — both clearly different, proving genuine bracketing movement,
   not a stuck/idle elevator. Targeted screenshots at the window's midpoint confirmed **both**
   visual cues simultaneously: the car aligned exactly on a floor gridline (`80px = (5 - 3) × 40px`
   → floor 3 exactly) AND the doors-open styling (`color-mix` fill) active, with the onboard badge
   reading `3/8`. Screenshots immediately before/after the window showed the car at a *fractional*
   position between gridlines (e.g. `94.0043px`, `155.917px` — not floor-aligned), doors closed —
   i.e. genuinely in transit, not stopped. This is the exact behavior the plan's Correction note
   requires and the exact bug class the review caught before implementation (see
   `replayFrame.test.ts`'s hand-computed regression test for the equivalent proof against a
   minimal fixture, including the explicit "this would fail against the original naive algorithm"
   check).

7. **Scrub/seek.** Setting the range input directly to an arbitrary value (bypassing playback
   entirely) and dispatching `input` immediately updated car position/doors/badge to the exact,
   correct state for that instant — confirmed at every one of the ~500 sampled timestamps above
   (each one is itself an independent large jump from wherever the slider previously was), plus
   explicit before/mid/after screenshots around the detected stop window. No drift, no stale
   frame, no flicker.

8. **Play/Pause and speed.** Set scrub to 3 seconds before a known stop window, clicked Play,
   waited 1.5s then another 1.5s (3s total real time), confirmed car position changed
   continuously and non-repeating across both waits (`154.042px → 182.93px → 182.832px` /
   `134.004px → 80px → 0px`) and the scrub input's own value advanced to `67250` — exactly
   `52250 + 3000ms × 5x speed = 67250`, confirming the 5x default speed's real-time-to-sim-time
   scaling is exactly right, not approximate. Clicked Pause; motion stopped. Changed the speed
   selector from `5` to `20`; selector value updated correctly (`advanceSimTime`'s speed-scaling
   math itself is exhaustively unit-tested in `replayClock.test.ts`, so this step confirms only
   that the UI control is correctly wired to `state.replay.speed`, not the math again).

9. **Trial and algorithm selectors (structural — go through the outer `render()`).** Clicked
   "Next": label changed `Run 1 of 10` → `Run 2 of 10`, and the scrub input reset to `0` (matches
   spec: switching trial resets `simTimeMs`). Selected a different algorithm from the dropdown
   (`FCFS / Nearest Car` → `SCAN / LOOK`): trial label reset to `Run 1 of 10` (matches spec:
   switching algorithm resets `trialIndex`/`simTimeMs`). Confirmed **no leaked animation loop**:
   after each such switch, the previously-rendered controls/cross-section elements were detached
   from the DOM (old element handles Playwright held became stale — `Element is not attached to
   the DOM` when reused), and the newly rendered cross-section animated correctly on its own —
   exactly the self-terminating `!wrapper.isConnected` rAF-loop-stop mechanism working as
   designed, observed indirectly through Playwright's own staleness errors when the test script
   itself reused an old handle.

10. **Dark mode.** Emulated `prefers-color-scheme: dark`. Confirmed: page background/text swap via
    the existing `--text`/`--bg` variables (unchanged from Unit 06), dashboard table's
    best-algorithm highlight (`color-mix(in srgb, var(--text) 12%, var(--bg))`) remains clearly
    visible and correctly themed (a light-gray tint in dark mode vs. Unit light mode's own tint),
    replay cross-section's shaft borders/car outlines/hall-call indicators all remain visible and
    correctly contrasted, doors-open fill (`color-mix(in srgb, var(--text) 30%, var(--bg))`)
    clearly distinguishable from doors-closed. No hardcoded colors found anywhere in the new code
    (confirmed by inspection of `replayCrossSection.ts`/`dashboardTable.ts` — every color value is
    `var(--text)`, `var(--bg)`, or a `color-mix()` of the two).

11. **Console.** Zero page errors and zero app-level console warnings/errors across the entire
    session above (only Vite's own HMR debug lines in dev mode, matching Unit 06's precedent).

### 2. Production build + preview (`npm run build && npm run preview`, `/L-vator/` base path)

1. Built successfully (`tsc -b && vite build`) and served via `vite preview` on port 4173.
   Navigated to `http://localhost:4173/L-vator/`. Repeated the exact same seeded-run script (seed
   `424242`) end-to-end: dashboard headers/sorting/highlighting, replay layout, stop-window
   detection and targeted screenshots, play/pause with exact speed-scaling verification, speed
   selector, trial/algorithm selectors, dark/light mode. **Result: confirmed identical behavior**
   to dev mode at every step — e.g. the stop-window detector found a fixed `translateY(200px)`
   run for car `E2` across `t=[38250ms, 46000ms]` with doors-open confirmed at the window's
   midpoint and doors-closed + a different (`191.602px`) fractional position 1 second after the
   window ended.
2. Console/page errors: **none**, in either initial load or after running the batch.

## Automated Tests

Ran via `npm run test` (Vitest):

```
Test Files  25 passed (25)
     Tests  164 passed (164)
```

- 127 pre-existing tests (Units 01-06), unaffected — the only pre-existing test file touched was
  `src/ui/validation.test.ts`'s `makeState()` helper, which needed one additive field
  (`replay: null`) to keep satisfying `AppState`'s now-larger shape; no assertions changed.
- 37 new tests across 3 new files:
  - **`src/ui/replay/replayFrame.test.ts` (22 tests):** `countAtOrBefore` binary-search primitive
    (empty array, T before first, T after last, T exactly matching an entry); position
    interpolation for a straight pass-through span (no stop); **the Correction regression case**
    — a hand-authored log where a stop occurs at the earlier `elevatorArrived` (`doorsOpened` at
    the same timestamp, `doorsClosed` `dwellMs` later), asserting position stays fixed at the stop
    floor for the *entire* dwell window and, critically, that interpolation after the dwell is
    anchored to `doorsClosed`'s timestamp (5000) and not the earlier `elevatorArrived`'s (2000) —
    the test comments spell out the exact numeric value (`2.875`) the ORIGINAL uncorrected
    algorithm would have produced at `T=5500` versus the corrected `2.5`, so this test would
    genuinely fail against the pre-correction algorithm, not just against an unrelated bug; door
    state transitions (open/closed boundaries, a second open/close cycle); onboard count across a
    boarding-then-alighting sequence; active hall calls across register/clear boundaries including
    T exactly on an event timestamp.
  - **`src/ui/replay/replayClock.test.ts` (8 tests):** `clampSimTime` (in-range, below 0, above
    max, exact boundaries); `advanceSimTime` (speed scaling at 1x/5x/20x, additive advance,
    clamping at both bounds).
  - **`src/ui/dashboard/dashboardTable.test.ts` (7 tests):** `bestAlgorithmId` for a
    lower-is-better metric, a higher-is-better metric, a tie (returns `null`), a null-valued
    metric on some rows (skipped), all-null (returns `null`), an empty list (returns `null`), and
    a single-row list.

No jsdom dependency was added, per Unit 06's precedent — DOM-touching files
(`replayCrossSection.ts`, `replayControls.ts`, `replayView.ts`, `dashboardTable.ts`'s DOM-building
half, `dashboardView.ts`, `resultsView.ts`) are covered only by the Manual Tests above.

## Integration Checks

- `npm run lint` — clean, no errors/warnings.
- `npm run format` then `npm run format:check` — all files match Prettier style (two files needed
  one auto-format pass during implementation: `replayControls.ts`, `replayView.ts` — both
  re-verified clean afterward).
- `npm run build` (`tsc -b && vite build`) — succeeds with strict TypeScript (no `any`, no
  unjustified non-null assertions); production bundle: `dist/assets/index-*.js` ≈36.8kB (≈10.7kB
  gzip), `dist/assets/index-*.css` ≈0.34kB.
- `src/ui/replay/*` and `src/ui/dashboard/*` import only from `src/engine`, `src/algorithms`,
  `src/generation`, `src/metrics`, and sibling `src/ui/*` files (confirmed by inspection) — no new
  dependency added to `package.json` (confirmed via `git status`/`git diff` showing no changes to
  `package.json`/`package-lock.json`), matching the plan's "no new runtime dependency proposed."
- `git status` after implementation shows exactly the expected file set changed (see
  `07_results.md`'s "Files Modified") and nothing else — in particular no stray changes to
  Unit 01-05 files or to `configPanel.ts`/`algorithmSelect.ts`/`buildScenario.ts`/`validation.ts`
  (beyond the one-line `validation.test.ts` fixture fix).

## Success Criteria

- [x] `RunState['done']` retains `trialResults: TrialRunResult[]` and a snapshotted `building:
      BuildingConfig`; `AppState.replay: ReplaySelection | null` is (re)initialized whenever a run
      completes.
- [x] Dashboard table renders all 8 headline metrics + Algorithm/Trials, is sortable (click a
      header, ascending/descending, arrow indicator), and highlights the best algorithm per metric
      (bold + tinted background) with ties correctly showing no highlight.
- [x] Replay cross-section renders at the correct size for the run's building (floor rows, shaft
      columns) and shows door state, onboard-count badge, and hall-call indicators.
- [x] **The corrected interpolation algorithm is visibly and measurably correct**: an elevator that
      stops mid-route holds a fixed, floor-aligned position with doors open for the entire dwell,
      then resumes smooth fractional motion anchored to `doorsClosed`'s timestamp — confirmed both
      by a targeted hand-computed Vitest regression test (which would fail against the
      pre-correction algorithm) and by direct measurement against a real, reproducible (fixed-seed)
      run in both dev and production builds.
- [x] Scrubbing to an arbitrary time produces the exact, correct state for that instant with no
      drift; play/pause and speed selection work and the real-time-to-sim-time scaling is exactly
      right (verified numerically, not just visually).
- [x] Trial and algorithm selectors switch which run is replayed, correctly resetting playback
      position, without leaking a stale `requestAnimationFrame` loop across the switch.
- [x] No console or page errors in any tested scenario, in dev or production/preview mode.
- [x] Dark mode (and light mode) both render correctly using only `--text`/`--bg`-derived colors —
      no hardcoded colors anywhere in the new code.
- [x] `npm run lint`, `npm run format:check`, `npm run test` (164/164), and `npm run build` all
      pass.
- [x] No new runtime dependency added; the scratch Playwright install used for manual testing left
      `package.json`/`package-lock.json` untouched and no stray processes running.
