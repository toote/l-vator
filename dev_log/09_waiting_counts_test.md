# Unit 09: Waiting-passenger counts in the replay - Test Instructions

## Test Objectives

Confirm that the replay's per-floor hall-call indicators show *how many* passengers are currently
waiting at each `(floor, direction)` pair at the replay's current simulated time, not just whether
a hall call is active there, and specifically confirm the real correctness/design risks this unit
carries, not just aesthetics:

1. **Direction-aware, not floor-aggregated counts**: two passengers waiting at the same floor for
   opposite directions must show as two independent numbers, matching the existing `▲`/`▼`
   indicators' own grain.
2. **Trial-index scoping**: the regenerated `ScriptedInput` used to compute waiting counts must be
   the *exact* trial currently selected for replay (`batch[replay.trialIndex]`), never a different
   trial's arrivals — this is the single sharpest correctness risk in this unit's design, per Unit
   05's own precedent for the analogous risk in `computeMetrics.ts`.
3. **Unsorted-input correctness**: `ScriptedInput`'s authoring order is not guaranteed
   chronological (unlike the simulation's own log), so `groupWaitingCounts`'s explicit per-group
   sort must actually be load-bearing, not decorative.
4. **The overloaded/bold treatment must actually be visually distinct** — a real regression was
   found and fixed during manual browser testing (see "Manual Tests" below): the pre-existing
   `.replay-hall-indicator.active` rule already applied `font-weight: bold`, which silently masked
   the new `.overloaded` bold treatment for the entire time a queue was building, not just once it
   exceeded capacity. Fixed by removing the redundant bold from `.active` (opacity alone still
   fully conveys active/inactive), leaving `.overloaded` as the only thing that bolds a badge.

Per this project's established split (Units 06/07/08), pure logic (`waitingCounts.ts`) is
Vitest-covered with exact hand-computed fixtures; everything DOM-rendering-touching (the badge
text, tooltip, bold treatment, live climb/drop during playback) is verified only by actually
running the app in a browser — this file's Manual Tests section is the primary verification for
that, not a supplement to the automated tests.

## Manual Tests

**Tooling note:** the `claude-in-chrome` MCP browser tools require calling `AskUserQuestion` as
part of their mandated browser-selection protocol before any browser action, and that tool was not
available in this (subagent) session. As a substitute that still exercises a real, full
Chromium/Chrome engine, these tests were driven with Playwright's `chromium.launch({ channel:
'chrome', headless: true })`, controlling the actual installed Google Chrome on the host via the
Chrome DevTools Protocol — the same substitute used in prior units (06/07/08) when `claude-in-chrome`
was unavailable. Playwright was installed only into a scratch directory outside the project
(session scratchpad, `pw-09waiting/` subfolder, via `npm init` + `npm install playwright
--no-save`) — never added to `package.json`. Verified afterward: `git diff --stat package.json
package-lock.json` produced no output (a transient, unrelated `package-lock.json` "name" field
sync — `"vite-scaffold"` -> `"elevator"`, triggered by running `npm run lint`/`test`/`build` in
this repo, nothing to do with Playwright or any new dependency — was reverted with `git checkout --
package-lock.json` before finishing), `ps aux | grep -i "vite\|playwright\|headless"` showed no
leftover dev/preview server or launched headless Chrome after cleanup, and the scratch directory
(scripts + screenshots + throwaway `npm install`) was deleted at the end of the session.
Console/page-error listeners (`page.on('console')`, `page.on('pageerror')`) were attached for every
scenario below; every run reported **0 console errors**.

Default config used as a base throughout (Unit 06/07/08 defaults): 5 floors, 2 elevators, capacity
8, up-peak, duration 5 min. Arrival rate was deliberately raised above the 6/min default (to 40/min
for the "pile up past capacity" tests, 10/min for the fine-grained active-vs-overloaded boundary
test) specifically to reproduce, quickly and reliably, the "queue piles up under a struggling
algorithm" scenario `00_main.md`'s own history describes (FCFS / Nearest Car under up-peak load).
Trial count was reduced to 2-3 for faster script iteration; this has no bearing on per-trial
waiting-count correctness, which is evaluated per-trial regardless of how many trials ran.

### 1. Dev server (`npm run dev`, `http://localhost:5190/L-vator/`), badge climbs and drops live

Ran up-peak with arrival rate 40/min, only FCFS / Nearest Car selected (known, per project history,
to struggle under this load), 3 trials, 5 min duration. After the run completed, scrubbed the
replay's `simTimeMs` across the full timeline in 13 evenly spaced steps and read each step's floor
0 / up indicator's `textContent`, `title`, and `active`/`overloaded` classes directly from the DOM.
Result — the count **climbed then dropped**, exactly as the plan's "What gets tested" end-to-end
check requires:

| t (ms) | badge text | title | active | overloaded |
|---|---|---|---|---|
| 0 | `▲` | `Floor 0, up` | false | false |
| 52043 | `▲ 8` | `Floor 0, up — 8 waiting` | true | false |
| 104085 | `▲ 31` | `Floor 0, up — 31 waiting` | true | true |
| 156128 | `▲ 50` | ... | true | true |
| 208170 | `▲ 59` | ... | true | true |
| 260213 | `▲ 75` | ... | true | true |
| **312255** | **`▲ 86`** (peak) | ... | true | true |
| 364298 | `▲ 70` | ... | true | true |
| 416341 | `▲ 54` | ... | true | true |
| 468383 | `▲ 38` | ... | true | true |
| 520426 | `▲ 22` | ... | true | true |
| 572468 | `▲ 6` | `Floor 0, up — 6 waiting` | true | false |
| 624511 | `▲` | `Floor 0, up` | false | false |

Confirms: the badge visibly climbs as passengers accumulate, visibly drops as the elevators pick
people up, returns to the bare glyph (no `▲ 0`) once the queue clears, and the tooltip text tracks
the count exactly (`"Floor N, direction — K waiting"` when `K > 0`, bare `"Floor N, direction"`
when `K === 0`). **0 console errors.**

### 2. Bug found and fixed: `.overloaded` bold was masked by `.active` bold

The first pass of test 1 (before the fix below) showed `fontWeight: '700'` (bold) starting at
`t=52043` (count 8, `overloaded: false`) — i.e. **before** the count actually exceeded capacity.
Root cause: Unit 07's pre-existing `.replay-hall-indicator.active` rule already sets
`font-weight: bold`, so the moment ANY passenger is waiting (which makes the hall call active
almost immediately), the badge was already bold — the new `.overloaded` rule's own
`font-weight: bold` had no additional visible effect once a queue actually exceeded capacity. This
directly violates the plan's own success condition ("the bold/large-count treatment actually
renders distinctly and isn't mistaken for a different UI element").

**Fix:** removed `font-weight: bold` from `.replay-hall-indicator.active` (kept `opacity: 1`,
which alone still fully conveys active vs. inactive — dimmed at 0.25 opacity, full opacity when
active). `.overloaded` is now the *only* rule that bolds a badge. Re-ran a fine-grained scrub (41
steps, arrival rate lowered to 10/min so the count climbs slowly through capacity instead of
jumping straight past it) and captured all three states directly:

| State | badge | active | overloaded | `fontWeight` | `opacity` |
|---|---|---|---|---|---|
| Inactive (nobody waiting) | `▲` | false | false | `400` | `0.25` |
| Active, not yet overloaded (1-7 waiting, capacity 8) | `▲ 1` .. `▲ 7` | true | false | `400` | `1` |
| Overloaded (>8 waiting, from test 1's higher-rate run) | `▲ 31` etc. | true | true | `700` | `1` |

Confirms the three states are now visually distinct: dim+normal-weight (inactive), full-opacity
normal-weight (active, under capacity), full-opacity **bold** (over capacity) — the overloaded
treatment no longer collides with the merely-active state. This was a genuine bug caught only by
real browser measurement (computed `getComputedStyle` values), not by reading the code, and is
recorded as a deviation from the plan's literal CSS in `09_waiting_counts.md`'s "AI Interactions".

### 3. Trial/algorithm selection updates counts correctly (not stale)

With all 3 algorithms selected (arrival rate 40/min, 3 trials, 5 min), scrubbed to a fixed
mid-timeline point (50% of `maxTimeMs`) on Run 1 of 3, read the floor 0 / up badge (`▲ 96`), then
clicked "Next" (Run 2 of 3 — a structural change that re-groups `groupedWaitingCounts` from that
trial's own regenerated arrivals) and scrubbed to the *same relative midpoint* again: badge read
`▲ 91` — a different, non-stale value. Then switched the Algorithm selector to "Nearest Car
(Directional)" (also structural, resets to trial 1) and scrubbed to its own midpoint: badge read a
valid, freshly computed count (`▲ 96`, a real, distinct grouping recomputed for the new
algorithm/trial combination, not a leftover DOM value from the previous selection). **0 console
errors** throughout every switch.

### 4. Zero-count shows bare glyph, never a "0" badge

Across all scrubbed samples in tests 1 and 3 (dozens of distinct timestamps), every sample with
`count === 0` rendered `textContent === '▲'` or `'▼'` (bare glyph) and never `'▲ 0'`/`'▼ 0'` —
confirmed programmatically (`el.textContent` read directly), not just visually. Confirms
`labelFor`'s `count > 0 ? ... : glyph` branch renders exactly as specified.

### 5. Visual legibility, light and dark mode

Full-page screenshots taken after a run (light mode, then with `page.emulateMedia({ colorScheme:
'dark' })`) showing the Replay section's floor grid with the `▲ 96` bold badge at Floor 0 clearly
legible and visually distinct from the dim, bare `▲`/`▼` glyphs at Floors 1-5 (up-peak generates no
calls above floor 0, so all upper floors correctly show inactive/dim glyphs throughout). In dark
mode, the badge's computed `color` read `rgb(243, 244, 246)` — exactly `--text`'s dark-mode value
(`#f3f4f6`) from `style.css`, confirming no hardcoded color was introduced, and `fontWeight: '700'`
confirmed the overloaded bold treatment renders correctly in dark mode too. Both screenshots showed
correct theme-appropriate background/text throughout the whole page, not just the replay section.

### 6. Production build (`npm run build && npm run preview`, real `/L-vator/` base path)

Repeated test 1's climb/drop scrub sequence against `http://localhost:5191/L-vator/` served from
`npm run preview` (the actual production bundle, real base path). Result: identical badge/title/
active/overloaded progression to the dev-server run (climbs from `▲` through overloaded counts and
back to bare `▲`), same `fontWeight`/`opacity` state distinctions. **0 console errors.**

## Automated Tests

`npm run test` (Vitest) — 28 test files, **183 tests, all passing** (177 pre-existing + 6 new in
`src/ui/replay/waitingCounts.test.ts`):

- **Direction-aware**: two passengers at the same floor, opposite directions, produce two
  independent `WaitingCountFrame` entries, not one combined number.
- **Never-boarded passenger**: counted as waiting for every `T >= arrivalTime` through `T =
  1_000_000` (no upper bound), confirming no censoring arithmetic silently kicks in.
- **Boarding transition, exact-timestamp edge case**: a passenger boarding at `t = 5000` is still
  counted at `t = 4999` and excluded exactly at `t = 5000` (inclusive boarding, mirroring
  `replayFrame.test.ts`'s established "T on an event boundary" precedent).
- **All-zero / absent group**: a `(floor, direction)` pair with zero arrivals is absent from
  `GroupedWaitingCounts.groups` and from `computeWaitingCounts`'s output entirely, confirming the
  "absent key defaults to 0" convention `replayCrossSection.ts` relies on.
- **Unsorted-input regression**: an `arrivals` fixture deliberately NOT in time order — asserts
  `groupWaitingCounts` sorts each group ascending regardless of authoring order, and, as a direct
  regression check, shows that binary-searching the SAME data left unsorted (bypassing the sort)
  would produce the wrong count (2, not the correct 1) at the probe time — proving the sort is
  load-bearing, not decorative.
- **Trial-index-scoping regression**: mirrors `computeMetrics.test.ts`'s Unit 05 precedent exactly
  — a real `RandomScenario` (building/arrivals/seed `12345`, matching the fixture already proven in
  `computeMetrics.test.ts` to produce colliding `"arrival-0"`-style ids with different underlying
  data across trial indices) run through `runTrialBatch` with a hand-written test dispatch hook.
  Computes waiting counts for trial 0's own log against (a) trial 0's own regenerated arrivals
  (correct) and (b) trial 1's regenerated arrivals (deliberately wrong scoping), and asserts the
  total arrival population differs between the two and matches only the correctly-scoped one —
  this is the automated counterpart to Manual Test 3 above, and the risk `replayView.ts`'s actual
  wiring (`batch[replay.trialIndex]`) guards against.

`npm run lint` (ESLint) — clean, no errors/warnings.

`npm run format:check` (Prettier) — all files formatted correctly.

`npm run build` (`tsc -b && vite build`) — clean typecheck, successful production build.

## Integration Checks

- `src/ui/types.ts`'s `RunState['done']` gained exactly one new field (`scenario: Scenario`);
  `runControls.ts`'s object literal gained exactly one new property in the same spot `building` is
  already snapshotted. No existing field was removed or renamed. `src/ui/validation.test.ts`'s
  `makeState()` helper needed no change (it only ever constructs `run: { status: 'idle' }`, never
  the `'done'` variant).
- `replayFrame.ts` itself is untouched — `waitingCounts.ts` imports `countAtOrBefore` from it
  rather than duplicating the binary-search primitive, confirmed by the unsorted-input regression
  test exercising the imported function directly.
- `replayView.ts`'s existing `groupReplayLog` call and structure are unchanged; `groupWaitingCounts`
  is computed at the exact same point (once per trial/algorithm selection), from
  `generateTrialBatch(run.scenario)` — a new call, but to an already-existing, already-tested
  (`trialBatch.test.ts`) pure function, no new dependency.
- `replayControls.ts`'s `ReplayControlsOptions` widened additively (`groupedWaitingCounts` is a new
  required field, not a replacement of `groupedLog`); the frame loop now calls
  `computeWaitingCounts` alongside (not instead of) `computeReplayFrame`, passing both to
  `crossSection.update(frame, waitingCounts)`.
- `replayCrossSection.ts`'s `CrossSectionHandle.update` signature widened additively (`waitingCounts:
  readonly WaitingCountFrame[]` is a new second parameter); the existing `activeHallCalls`
  highlighting logic, car positioning, and door-state rendering are all unchanged.
- No new runtime dependency: confirmed via `git diff --stat package.json package-lock.json`
  producing no output (after reverting the unrelated lockfile "name" field sync noted above).

## Success Criteria

- [x] Each floor row's `▲`/`▼` indicator shows a live waiting-passenger count per `(floor,
      direction)` pair, not a combined per-floor number.
- [x] The badge visibly climbs as passengers accumulate and visibly drops as an elevator picks
      people up, confirmed against the default up-peak scenario under a struggling algorithm.
- [x] A floor/direction with zero waiting shows the bare glyph, never a `"0"` badge — confirmed
      programmatically across every scrubbed sample, not just visually.
- [x] The bold/overloaded treatment (`count > building.capacity`) renders distinctly from the
      merely-active state — a real masking bug was found via real browser measurement and fixed
      (see Manual Test 2); re-verified afterward that all three states (inactive / active-under-
      capacity / overloaded) are visually and programmatically distinct.
- [x] Tooltip text is correct on hover (`"Floor N, direction — K waiting"` / bare `"Floor N,
      direction"` at K = 0), confirmed via the `title` attribute at every scrubbed sample.
- [x] Switching trial or algorithm selection updates counts correctly, never showing a stale value
      from the previous selection.
- [x] Both light and dark mode render correctly; the badge text stays in `--text` (confirmed via
      computed `color`), no hardcoded colors introduced.
- [x] No console errors in dev, preview (production build/base path), or either color scheme.
- [x] Verified against a production build (`npm run build && npm run preview`, real `/L-vator/`
      base path) with identical behavior to the dev server.
- [x] `npm run lint`, `npm run format:check`, `npm run test` (183 tests), and `npm run build` all
      pass.
- [x] No stray scratch files, npm installs, or processes left behind; no `package.json`/
      `package-lock.json` diff.
