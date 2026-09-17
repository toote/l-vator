# Unit 08: Dashboard charts

## Objective

Add a small number of simple bar charts to the existing results dashboard (`src/ui/dashboard/`,
built in Unit 07), sitting alongside — not replacing — the sortable, best-algorithm-highlighted
comparison table. This is the item Unit 07 explicitly deferred ("Charts — resolved: table only, no
charts in this unit... charts remain a candidate future addition if the table alone doesn't feel
sufficient once built") and that `00_main.md`'s Planned Units list now picks up as its own unit.
Design is governed by this repo's `dataviz` skill (color palette, mark specs, accessibility,
layout), which was read in full — the `references/choosing-a-form.md`, `color-formula.md`,
`marks-and-anatomy.md`, `interaction.md`, `anti-patterns.md`, and `palette.md` files — before
drafting this plan, and its guidance shapes every recommendation below.

Builds on `src/ui/dashboard/dashboardTable.ts` and `dashboardView.ts` (Unit 07): the same
`AlgorithmMetrics[]` that feeds the table feeds the charts, and `bestAlgorithmId`/
`METRIC_DIRECTIONS` are reused, not duplicated. No new runtime dependency is proposed — see
"Implementation mechanics" below.

## Implementation

### Which metrics get charts — revise Unit 07's three to four

Unit 07's plan proposed avg wait time, throughput, and unserved% as "the strongest candidates...
the other five are supporting detail better left to the table." Revisiting this against the
dataviz skill's form heuristic (`choosing-a-form.md`: "Compare magnitude, low -> high" → bar/
column) and against what this project is *for* — comparing dispatch algorithms, including their
worst-case behavior — **recommend four charts, not three: average wait time, max wait time,
throughput, and unserved%.**

`maxWaitTimeMs` is not just another metric among nine — Unit 05's plan gave it its own resolved
open question specifically because it exists to catch "worst-case/starvation behavior" (computed
over *all* passengers, including censored never-boarded ones, specifically so a strander-forever
failure can't be averaged away). A project whose stated purpose is comparing dispatch algorithms
should chart its one explicit worst-case metric, not leave it table-only while charting three
metrics that lean central-tendency/volume. The four together cover four genuinely distinct facets
— typical experience (avg wait), worst case (max wait), volume (throughput), and service
completeness (unserved%) — without becoming "eight categorical hues when the story is one number"
(the skill's own anti-pattern for over-charting). The remaining five metrics (`averageTravelTimeMs`,
`totalDistanceFloors`, `averageOccupancyWhileMovingPct`, `deadheadTravelPct`, and the underlying
`servedCounts` breakdown) stay table-only, per Unit 07's original reasoning — still true for them.
**Resolved by developer: confirmed.** Four charts, as proposed above.

### Chart type and orientation

**Four separate single-metric bar-chart panels (small multiples), one per chosen metric — not one
combined/grouped chart.** Two reasons, both from the skill:

- The skill's "One axis" non-negotiable rules out combining metrics of different units and scales
  (ms, per-hour, %) on one shared axis — that's the dual-axis anti-pattern by another name. Small
  multiples (one chart per metric, each with its own scale) is the skill's own prescribed way out
  ("Two measures of different scale → two charts, small multiples, or indexed to a common base").
- Each panel has exactly one bar per algorithm (3 bars, currently) — a plain bar chart per
  `choosing-a-form.md`'s "Compare magnitude, low → high" row, not a grouped/stacked bar (grouping
  is for multiple metrics per category in one chart, which the point above already rules out).

**Horizontal bars**, not vertical columns: algorithm names ("Nearest Car (Directional)") are long
enough to force rotated or truncated tick labels as vertical-column x-axis labels, especially at
the ~400px narrow-viewport width this project must support (no other unit has needed rotated
labels, and this one shouldn't be the first). Horizontal bars put the label to the left of each bar
(never rotated, wraps naturally if needed — never clipped, per `marks-and-anatomy.md`) and the
value at the bar's tip on the same row, which also reads better at phone width since panels stack
to a single column.

**Bar order is fixed (the algorithm registry's order — see Color below) and identical across all
four panels, not sorted by value per panel.** The table already has interactive per-column sorting;
charts intentionally don't replicate it — a reader scanning across panels should always find "FCFS"
in the same row position, which is the entire point of giving it a consistent color.

**No axis ticks/gridlines.** Every bar already carries its own direct value label at the tip (per
`marks-and-anatomy.md`, ticks "carry the values you didn't directly label, so keep them unless
every value is labeled" — here every value is labeled), so a numeric axis scale would be
redundant. A single hairline baseline (derived from `--text` via `color-mix`, matching the
project's existing convention) is enough.

### Color: consistent per-algorithm identity across all four charts

This is the one part of this unit where getting it wrong is a real correctness bug, not just
aesthetics: **`selectedAlgorithmIds` means a run — and therefore the `AlgorithmMetrics[]` the
dashboard receives — may contain any subset of the algorithms, not always all of them.** If color
slots were assigned by an algorithm's *position within the current run's* `AlgorithmMetrics[]`,
re-running with a different subset would repaint colors onto different algorithms — exactly the
skill's "recolor-on-filter" anti-pattern ("a reader who learned 'Acme is blue' is now misled...
color follows the entity, not its row number").

**Recommendation:** assign each algorithm's color slot by its index in the full, fixed
`algorithms` registry (`src/algorithms/index.ts`) — never by position in the current run's
filtered metrics array. Concretely, a small shared helper:

```ts
// src/ui/dashboard/algorithmColor.ts
import { algorithms } from '../../algorithms';

/** Fixed by the algorithm's position in the full registry, never by its position in a
 * particular run's (possibly-filtered) AlgorithmMetrics[] -- so re-running with a different
 * algorithm subset never repaints a surviving algorithm's color. See "Color" in 08_charts.md. */
export function algorithmColorVar(algorithmId: string): string {
  const index = algorithms.findIndex((a) => a.id === algorithmId);
  return `var(--series-${index + 1})`;
}
```

Currently there are exactly 3 algorithms (`FCFS / Nearest Car`, `SCAN / LOOK`,
`Nearest Car (Directional)`), which conveniently matches the dataviz palette's own constraint: per
`palette.md`, the documented 8-hue default palette's **first three slots are the ones validated for
all-pairs CVD separation** (any two marks can sit side by side — relevant here since bars from
different panels, or table rows, can appear adjacent on screen), at Δ E 9.2 light / 9.4 dark, well
clear of the warn band. Slots 1–3 — blue, orange, aqua — are exactly enough for this project's
three algorithms, so no series cap or "Other" folding is needed *today*.

Add to `style.css`, following its existing `--text`/`--bg` dark-mode pattern exactly:

```css
:root {
  --series-1: #2a78d6; /* blue   -- FCFS / Nearest Car (registry index 0) */
  --series-2: #eb6834; /* orange -- SCAN / LOOK (registry index 1) */
  --series-3: #1baf7a; /* aqua   -- Nearest Car (Directional) (registry index 2) */
}
@media (prefers-color-scheme: dark) {
  :root {
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
  }
}
```

(The actual registry-index → name mapping above is illustrative — `import.meta.glob`'s file-glob
order determines the real index; the plan's point is that the mapping is registry-derived and
fixed, not that a specific algorithm must be blue.)

**Validation, not eyeballing (per the skill's core rule):** run the palette validator against
these three slots in both modes, against *this project's actual* surface colors (`--bg`:
`#ffffff` light / `#16171d` dark — not the skill's own reference surfaces, since contrast is
surface-relative) and `--pairs all` (bars from different panels/rows can be visually adjacent):

```
node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --pairs all --surface #ffffff
node scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark  --pairs all --surface #16171d
```

`palette.md` already reports these three slots passing all-pairs in both modes against its own
reference surfaces; re-running against this project's actual `--bg` values is still a required
implementation step, not a formality, since the contrast check (≥3:1 vs. surface) depends on the
exact surface color. One thing to expect and not "fix": `palette.md` also notes slot 3 (aqua) sits
below 3:1 contrast on a light surface by design, which triggers the relief rule (ship visible
direct labels or a table view). Both already exist here — every bar has a direct text label, and
the adjacent table is the accessible-equivalent table view — so this is a pass-through note to
confirm during implementation, not a gap to close.

**Forward-looking limitation, not a blocker — but sharper than "just add more slots."** Confirmed
against the actual `src/algorithms/index.ts`: `algorithms`' order comes from `import.meta.glob`'s
key order, which is effectively alphabetical by filename, not a stable hand-assigned index. This
means adding a *new* algorithm file doesn't just need a 4th color slot (the palette's all-pairs
guarantee doesn't extend past 3, an issue on its own) — if the new file's name happens to sort
alphabetically *before* an existing algorithm file, `algorithmColorVar`'s `findIndex` would shift
that *existing* algorithm to a different slot too, silently recoloring it (`fcfsNearestCar.ts`,
`nearestCarDirectional.ts`, `scanLook.ts` today; a new `greedyLook.ts` would insert before
`nearestCarDirectional.ts` and `scanLook.ts` alphabetically, reassigning both). This is exactly the
"color follows the entity, not its row number" failure this plan's own Color section calls out —
just triggered by file-glob order instead of a filtered run array. Not fixed here: a fully stable
scheme needs an explicit, hand-maintained `algorithmId -> color slot` mapping, which trades away
Unit 03's deliberate no-manual-registry design for color stability, a bigger call than this unit
should make unilaterally for a problem that isn't live yet (still exactly 3 algorithms). Noted
precisely so whichever unit adds a 4th algorithm inherits an accurate warning, not a vague one.

**Table integration — recommend a color swatch, not a repurposed highlight.** The table's existing
per-cell "best in this column" highlight (a neutral `color-mix(in srgb, var(--text) 12%, var(--bg))`
tint) does a **status** job (this cell won this metric), not an identity job — reusing an
algorithm's series color for that highlight would conflate identity and status encoding in one
place, which the skill explicitly calls an anti-pattern ("status color used for a non-status
series... never both in one chart"). Leave that highlight exactly as Unit 07 built it. Instead, add
a small color swatch (a `<span>` with `background: var(--series-N)`, ~10px, rounded) beside the
algorithm name in the table's first column, using the same `algorithmColorVar` helper — this gives
the requested cross-view consistency (the same blue dot next to "FCFS" in the table and on every
chart bar) without overloading the highlight's meaning.

### Null-valued metrics: omit the fill, show a visible "n/a" — never a zero-height bar

All four charted fields (`averageWaitTimeMs`, `maxWaitTimeMs`, `throughputPerHour`, `unservedPct`)
are `number | null`. **Recommendation: a `null` value renders as a visible "n/a" placeholder in
that algorithm's row — no colored fill at all — never a zero-width/zero-height bar.** A zero-length
bar is genuinely ambiguous between "measured zero" and "no data," and this project has repeatedly
cared about exactly this failure mode (Unit 05's `ServedCounts`/censored-wait design). The
distinction that resolves any remaining ambiguity: **a real value of `0` (e.g., an algorithm with
zero unserved passengers) *does* render as an actual zero-length bar — that's correct, not
misleading, since it *is* zero.** Only `null` ("nobody was served at all, so there's no average to
compute") gets the "n/a" treatment. This exactly mirrors `dashboardTable.ts`'s existing
`formatNumber` (`value === null ? 'n/a' : value.toFixed(1)`) — same convention, extended to a
visual form, not a new one. The algorithm's row stays present (never removed) so the fixed
row-per-algorithm alignment across all four panels holds even when one algorithm has a null value
in one panel. Also handle the shared "all values null" and "all values 0" edge cases in the pure
proportion-computation function (see Testing) so neither divides by zero.

### Implementation mechanics: DOM + CSS, no SVG, no charting library

**Recommend continuing this project's zero-new-runtime-dependency track, with sized DOM elements
styled via CSS custom properties — the same pattern `replayCrossSection.ts` (Unit 07) already
established** (a scoped `<style>` block injected once, classed elements, colors and gaps driven by
`var(--text)`/`var(--bg)`/`color-mix`, no canvas, no library). Nothing in the dataviz skill's mark
specs requires SVG specifically — 4px rounded data-ends are `border-radius`, the 2px surface gap
between bars is `margin`/`gap`, the hover/focus tooltip is a positioned `<div>` toggled on
`pointermove`/`focus`, and proportional bar length is exact with plain percentage `width` (DOM
layout computes this precisely; there's no rendering-fidelity reason to reach for SVG here). This
project's chart needs are genuinely simple — 4 panels × 3 bars, no pan/zoom, no continuous
scale/axis, no large data volume — well inside what plain DOM/CSS already does well in this
codebase's replay grid. Introducing a charting library would be new dependency surface for a
problem this small; **recommend not doing it.** Not flagged as an open question — this follows
directly from the same reasoning Unit 07 already applied to its own (more complex) replay grid.

### Layout: charts above the table, in one responsive row that wraps

Both charts and the table live in the same `dashboard/` section (`dashboardView.ts` renders them
in sequence, not as tabs or toggled visibility — table and charts show the same data at different
grain, so there's no reason to hide either behind an interaction). **Recommend charts first, table
second**: the charts are the fast, at-a-glance comparison; the table is the exact-value reference a
reader drops to next — and the skill's own accessibility rule ("a table view exists") is satisfied
for free by the table always being immediately below, not behind a toggle.

A single shared legend (algorithm name + color swatch, one row, reused across all four panels —
not repeated per panel, and not a separate box per the skill's single-series exception, since here
there genuinely are 3 named series) sits above the chart panels, styled like the skill's "one
filter row above everything it scopes" composition rule applied to a legend instead of a filter.

**Responsive layout is new — `style.css` currently has no layout rules for anything beyond the
dark-mode color swap** (confirmed: 25 lines, just `:root` custom properties, one `@media
(prefers-color-scheme: dark)` block, and `body` margin/padding — no grid/flex, no other media
query, and no other UI file styles panels via a shared stylesheet class beyond the per-component
scoped `<style>` pattern `replayCrossSection.ts` established). Recommend a CSS grid on the chart
panels' container, in that same scoped `<style>` block:

```css
.chart-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}
```

`auto-fit`/`minmax` stacks to one column automatically under ~400px without a hand-authored
breakpoint — consistent with this project's "no unnecessary complexity" ethos, and it's the first
genuinely responsive layout rule in the app, worth calling out in review as such.

### File layout

Following Unit 07's one-concern-per-file split (`dashboardTable.ts` DOM+logic /
`dashboardView.ts` orchestrator), pure computation is split out from DOM rendering the same way
`replayFrame.ts` (pure) was split from `replayCrossSection.ts` (DOM) in Unit 07:

```
src/ui/dashboard/
  algorithmColor.ts       # pure: algorithmId -> registry-fixed color slot / CSS var name
  dashboardChartData.ts   # pure: AlgorithmMetrics[] -> per-chart bar data (value, proportion
                           #   0..1, null -> "n/a", per-panel max) for each of the 4 charted metrics
  dashboardChartData.test.ts
  dashboardCharts.ts       # DOM: renders the legend + 4 bar-chart panels from dashboardChartData's
                           #   output; owns the chart <style> block, hover/focus tooltips, and the
                           #   algorithmColor-driven fills
  dashboardTable.ts        # existing (Unit 07) -- gains the small color-swatch addition described
                           #   above; bestAlgorithmId/METRIC_DIRECTIONS imported by chart code
                           #   rather than duplicated, if/when charts need "which is best" (see
                           #   Open Questions)
  dashboardView.ts         # orchestrator -- renders charts above, table below
```

### What gets tested

Consistent with this project's established Vitest-for-pure-logic / manual-browser-verification-
for-DOM split (Units 06/07):

**Vitest, pure logic, exact hand-computed fixtures:**
- `dashboardChartData.ts`: bar proportion computed correctly for ordinary values; a `null` value
  produces the "n/a" marker, not a `0` proportion; **all-null-for-one-metric** (every algorithm's
  value is `null` for that panel) doesn't divide by zero and every row is "n/a"; **all-zero**
  (every algorithm has a real `0`, e.g. `unservedPct: 0` for everyone) renders real zero-length
  bars, not "n/a" — the specific distinction this plan resolves, worth its own explicit test since
  it's exactly the kind of thing that looks right at a glance and is wrong on close inspection;
  mixed null-and-real-values in the same panel; proportion is relative to that panel's own max
  (not shared across panels, since units differ).
- `algorithmColor.ts`: slot assignment is stable and keyed by the full registry, not by an
  `AlgorithmMetrics[]` array's order — a fixture with a *subset* of algorithms (mirroring what
  `selectedAlgorithmIds` produces) must still return the same color for a given `algorithmId` as
  the full-registry fixture does. This is the direct regression test for the recolor-on-filter
  concern above.

**Manual/browser verification (no jsdom, per Units 06/07's precedent):**
- Actual bar rendering and proportional lengths at a few different metric-value spreads, in both
  light and dark mode.
- The palette validator commands above, run against this project's actual `--bg` values, both
  modes — confirm PASS, not just trust `palette.md`'s numbers against its own reference surface.
- Legend + swatch + bar color correctly match across all four panels and the table for the same
  algorithm, including after re-running with a different `selectedAlgorithmIds` subset (the
  recolor-on-filter check, visually — complements the `algorithmColor.ts` unit test).
- "n/a" rendering for a scenario producing a null metric (e.g., a trial with zero served
  passengers) vs. a genuine-zero scenario, side by side.
- Hover/focus tooltip content and keyboard-focusability of each bar.
- Responsive layout at a few widths, including ~400px (per-panel stacking, label wrapping instead
  of clipping).
- End-to-end: confirm a chart's bar for a given algorithm/metric visually agrees with that same
  cell's exact value in the table.

## Open questions for developer sign-off

1. ~~**Four charts (adding max wait time)**~~ — **Resolved by developer: yes.** Four charts —
   average wait time, max wait time, throughput, unserved% — supersedes `00_main.md`'s original
   three-chart description.
2. ~~**Null-value rendering**~~ — **Accepted as proposed (no objection raised):** "n/a" placeholder,
   never a zero-height bar; a real `0` still renders as an actual zero-length bar.
3. ~~**Best-algorithm highlighting on charts**~~ — **Accepted as proposed:** skipped for this unit,
   magnitude-only bars.
4. ~~**Charts-above-table ordering**~~ — **Accepted as proposed:** charts first, table second, no
   tabs/toggle.

## Scope check against `00_main.md`'s Future Enhancements

None of the three explicitly-deferred items (manual/interactive mode, destination-dispatch
algorithms, UI-authorable scripted scenarios) are touched by this unit — it is purely a results-
side presentation addition on top of already-computed `AlgorithmMetrics[]`, consistent with how
Unit 07 scoped the same check.

## AI Interactions

Implemented per the approved plan. `algorithmColor.ts` implements `algorithmColorVar` exactly as
specified (registry-index-keyed, never array-position-keyed), plus one small addition:
`algorithmRegistryIndex` was factored out and exported so `dashboardChartData.ts`'s row-ordering
logic (fixed registry order across all four panels) reuses the same lookup instead of duplicating
`algorithms.findIndex(...)` a second time — a minor, in-spirit extension of the plan's single-file
description, not a deviation from its design.

`style.css` got the plan's exact three hex values in both modes. Re-validated for real (not just
trusting `palette.md`'s numbers) with `node scripts/validate_palette.js` from the dataviz skill,
against this project's actual `--bg` values and `--pairs all`:

```
node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --pairs all --surface "#ffffff"
  [PASS] Lightness band, Chroma floor, CVD separation (worst 9.2), Normal-vision floor (worst 24.0)
  [WARN] Contrast vs surface: #1baf7a (aqua) at 2.82, below 3:1 -- relief required
  -> ALL CHECKS PASS (the WARN is the plan-anticipated relief case, mitigated by direct value
     labels on every bar + the adjacent table view, both already present)

node scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark --pairs all --surface "#16171d"
  [PASS] Lightness band, Chroma floor, CVD separation (worst 9.4), Normal-vision floor (worst 20.9),
         Contrast vs surface (all >= 3:1)
  -> ALL CHECKS PASS
```

Exactly the plan's anticipated result -- see `08_charts_test.md` for the full recorded output.

`dashboardChartData.ts` implements `computeChartPanels` as a single pure entry point covering all
four charted metrics at once (rather than four separate exported functions) -- an implementation
grouping choice, not a scope change: it still returns exactly what the plan specified (value,
0..1 proportion relative to the panel's own max, null -> "n/a" marker) per metric. All-null and
all-zero edge cases are handled explicitly (see the file's `computePanel` -- `max` starts at `0`
and only real non-null values raise it, so an all-null panel never divides by zero and an all-zero
panel correctly produces real `0` proportions, not `null`).

`dashboardCharts.ts` follows `replayCrossSection.ts`'s scoped-`<style>`-block, CSS-custom-property
pattern, but rebuilds fully on every call (like `dashboardTable.ts`) rather than patching
in-place like replay's `update(frame)` -- these panels have no per-frame animation, so there was no
reason to adopt that half of the replay pattern. One layout fix made during implementation, after
first-pass manual verification: the initial row layout put the algorithm-name label in a narrow
grid column, which caused long names ("Nearest Car (Directional)") to wrap mid-word
("Neares"/"t Car") in real rendering -- ugly and arguably against `marks-and-anatomy.md`'s "wraps
naturally... never clipped" spirit even though it wasn't technically clipped. Fixed by giving the
label its own full-width line above the track+value row (flex column instead of a 3-column grid);
re-verified in the browser that labels now wrap only at word boundaries at every width tested,
including ~400px.

Table integration (`dashboardTable.ts`): added a `showSwatch?: boolean` flag to `ColumnDef`, set
only on the Algorithm column, and a small branch in the row-rendering loop that prepends a
10px/rounded `algorithmColorVar`-driven `<span>` before the cell's existing formatted text. The
existing best-per-metric highlight logic (`bestByColumn`, the `color-mix` background) is completely
untouched. `algorithmName` was changed from a private to an exported function so `dashboardCharts.ts`
reuses it rather than duplicating the same `algorithms.find(...)` lookup.

`dashboardView.ts` now renders `renderDashboardCharts(metrics)` above `renderDashboardTable(metrics,
render)`, in sequence, no tabs/toggle -- `resultsView.ts` needed no changes since
`renderDashboardView`'s signature is unchanged.

Real browser verification (Playwright driving actual installed Chrome, `channel: 'chrome'`,
headless) was performed in dev, in a production build+preview (`/L-vator/` base path), and in both
light and dark mode -- `claude-in-chrome` was unavailable in this session (its browser-selection
protocol requires `AskUserQuestion`, not available to this agent), consistent with prior units'
precedent for that tool being unavailable. Specifically verified, beyond what automated tests can
check: cross-view color consistency via computed styles (legend/chart-bars/table-swatch all report
identical `rgb(...)` per algorithm); the recolor-on-filter regression live (unchecking one
algorithm and re-running left the survivors' colors unchanged); the null-vs-real-zero distinction
live (a zero-arrival-rate run showed "n/a" with no bar element in any panel, contrasted against a
default run's genuinely-zero Unserved panel, which had a real, present zero-width bar); hover and
keyboard-focus tooltip parity; ~400px responsive stacking with no clipped labels and no
chart-contributed horizontal overflow (the page does still overflow at that width from the
pre-existing, out-of-scope Unit 07 table); zero console errors in every scenario. Full detail,
including the exact colors/percentages read back from the DOM, is in `08_charts_test.md`.

No deviations from the approved plan's design or scope. The one implementation-time adjustment
(label layout, described above) was a rendering-quality fix discovered during manual verification,
not a plan change -- the plan's markup/CSS were illustrative, not literal, and `marks-and-anatomy.md`'s
own label-wrapping guidance is what the fix followed. No new runtime dependency added (confirmed via
`git diff --stat package.json package-lock.json` producing no output). No stray scratch files,
npm installs, or processes left behind (verified via `ps aux` and directory listing after cleanup).

## Files Modified

Created: `src/ui/dashboard/algorithmColor.ts`, `algorithmColor.test.ts`, `dashboardChartData.ts`,
`dashboardChartData.test.ts`, `dashboardCharts.ts`; `dev_log/08_charts_test.md`.

Modified: `src/style.css` (`--series-1`/`-2`/`-3` added to `:root` and the dark-mode media query),
`src/ui/dashboard/dashboardTable.ts` (`algorithmColorVar`-driven swatch on the Algorithm column via
a new `showSwatch` flag; `algorithmName` exported instead of private; best-per-metric highlight
logic untouched), `src/ui/dashboard/dashboardView.ts` (renders `renderDashboardCharts` above
`renderDashboardTable`), `dev_log/08_charts.md` (this file).

## Status: Complete
