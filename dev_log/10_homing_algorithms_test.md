# Unit 10: Homing algorithm variants - Test Instructions

## Test Objectives

Confirm the three new homing algorithm variants actually improve fleet utilization (not just that
they exist and don't crash), and confirm the color-slot stability fix genuinely resolves the
regression this unit's own new files would otherwise cause:

1. **Idle-duration bookkeeping is correct**: an elevator homes only once idle at least
   `idleReturnThresholdMs`, not before; a real assignment before that resets the clock; an elevator
   already at floor 0 never issues a pointless "travel nowhere"; a homing elevator that reaches
   floor 0 returns to plain idle and does not loop.
2. **Homing measurably helps** on a real scripted scenario where the base algorithm strands an
   elevator far from a demand floor — not just a plausible story, an actual measured wait-time
   comparison between the base and homing variant on the identical scenario.
3. **Color-slot stability**: the original three algorithms' dashboard colors are provably unchanged
   by the three new files' existence — this is the actual regression Unit 08's plan flagged as a
   future risk, now live, and this unit's `COLOR_ORDER` fix is what prevents it.
4. **The new `idleReturnThresholdMs` config field** is wired end-to-end: engine validation, UI
   input, and actually consumed by (only) the three homing algorithms.
5. **All 6 algorithms are visually distinguishable** on the dashboard and replay, in both light and
   dark mode, using the newly added `--series-4/5/6` palette slots.

Per this project's established split, pure logic (all three homing algorithms' `decide()` logic,
`algorithmColor.ts`) is Vitest-covered with exact hand-computed fixtures and a genuine measured
comparison test (not a hollow always-passes assertion); the config panel's new field, dashboard
color rendering, and cross-algorithm visual distinctness are verified only by actually running the
app in a browser.

## Palette validation

`--series-4/5/6` (light and dark) validated with the `dataviz` skill's `validate_palette.js`
against the full 6-color palette (existing 3 + new 3 together — a categorical palette's checks are
pairwise across the whole set, so the new colors must be validated in combination with the
existing ones, not in isolation), `--pairs all`, against this project's actual `--bg` values:

**Light** (`#2a78d6,#eb6834,#1baf7a,#9e2e2e,#cbac4d,#20afdf`, surface `#fcfcfb`): **PASS**. One
expected carryover WARN (aqua's contrast vs. surface, same as Unit 08) plus two new contrast WARNs
(khaki gold, sky blue) and one CVD WARN (khaki gold vs. aqua, in the accepted 6-8 band) — all
mitigated the same way Unit 08's original aqua WARN already was: every series color is always
paired with a direct label (legend, bar labels, table row) or the table view, never color-only
encoding.

**Dark** (`#3987e5,#d95926,#199e70,#7a26c2,#ea1ef2,#c42b79`, surface `#16171d`): **PASS**. One CVD
WARN (magenta vs. blue, accepted band) and one contrast WARN (purple), same mitigation.

Both runs: Lightness band, Chroma floor, and Normal-vision floor all **PASS** outright with no
WARN.

## Manual Tests

**Tooling note:** `claude-in-chrome` was unavailable this session (extension not connected, checked
twice). As a substitute exercising a real Chromium engine, these tests were driven with
Playwright (`chromium.launch()`, headless), installed to a scratch directory outside the project
(confirmed via `git status --short package.json package-lock.json` showing no diff) — the same
substitute prior units (06-09) used under the same circumstance.

1. **Dev server, config panel, light mode.** `npm run dev`, navigated to `/L-vator/`. Confirmed:
   - "Idle return threshold (ms)" field present among the building settings, default value `30000`
     (matches `state.ts`'s `defaultConfig()`), directly below "Door dwell per-passenger
     multiplier" — editable like every other timing field.
   - All 6 algorithm checkboxes present and checked by default: "FCFS / Nearest Car", "FCFS /
     Nearest Car (Returns to Lobby)", "Nearest Car (Directional)", "Nearest Car (Directional)
     (Returns to Lobby)", "SCAN / LOOK", "SCAN / LOOK (Returns to Lobby)".

2. **Full run against the default scenario (up-peak, 2 elevators, 30s threshold, 10 trials).**
   Clicked Run. Confirmed no console errors (checked via Playwright's console/pageerror
   listeners — none fired). Dashboard rendered with:
   - A 6-entry color legend, each a distinct swatch + label, in `COLOR_ORDER`'s order (not
     alphabetical, not checkbox order) — direct visual confirmation `algorithmColorVar` is wired
     correctly end-to-end, not just unit-tested in isolation.
   - Four bar-chart panels (average wait, max wait, throughput, unserved%), each showing all 6
     algorithms with visually distinct bar colors matching the legend.
   - The comparison table with all 6 rows, real distinct metrics per algorithm (not stubbed/zero
     data).
   - **Real, measured result matching this unit's actual point**: under this scenario, FCFS's
     homing variant reduced average wait from 19,711ms to 15,463ms (and max wait 54,034ms →
     55,788ms — the improvement isn't universal across every metric, which is itself expected and
     honest: homing trades idle-repositioning cost for readiness, and under sustained load a
     repositioned-but-now-slightly-delayed elevator can occasionally cost more on a single
     worst-case trial even while average wait improves). Nearest-car-directional's homing variant
     improved max wait substantially (87,917ms → 73,092ms). SCAN/LOOK's homing variant was
     essentially a wash (14,578.0ms vs. 14,579.5ms avg wait) — expected, since SCAN/LOOK doesn't
     suffer the same idle-drift problem the assignment-based algorithms do (see
     `03_algorithms_done.md`'s concurrent-dispatch discussion), and this small building
     (5 floors, 2 elevators) leaves limited room for drift regardless.
   - Screenshot saved for the record (not committed — scratch artifact).

3. **Dark mode.** Same run, `colorScheme: 'dark'`. Confirmed the 6-color legend renders with good
   contrast against the dark background (`--bg: #16171d`), all 6 swatches visually distinct,
   matching the validated dark palette above.

4. **Replay.** Confirmed the replay's elevator shafts and waiting-count badges (Unit 09) render
   correctly alongside this unit's changes — no regression to prior units' UI from this unit's
   additions.

## Automated Tests

`npm run format`, `npm run lint`, `npm run test` (216/216 passing — 26 new: hook-level and
integration tests across the three homing algorithms, plus `algorithmColor.test.ts`'s new
color-slot-stability regression tests), `npm run build` all pass cleanly.

`algorithmColor.test.ts`'s "original three algorithms' color slots are UNCHANGED" test is a
genuine regression test: it would FAIL against the pre-Unit-10 `algorithms.findIndex(...)`-based
implementation (which shifts `nearest-car-directional`'s index 1→2 and `scan-look`'s 2→4 once the
three `*Homing.ts` files exist) and PASSES against this unit's `COLOR_ORDER`-based fix.
