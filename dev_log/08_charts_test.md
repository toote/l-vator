# Unit 08: Dashboard charts - Test Instructions

## Test Objectives

Confirm the four small-multiple bar-chart panels (average wait time, max wait time, throughput,
unserved%) render correctly above the existing comparison table, and specifically confirm the two
things that are real correctness risks in this unit, not just aesthetics:

1. **Cross-view, cross-panel color consistency**: the same algorithm has the same color in the
   shared legend, every one of the four chart panels, and the table's new swatch column.
2. **Recolor-on-filter is actually fixed, not just tested in isolation**: re-running with a
   different `selectedAlgorithmIds` subset must not repaint a surviving algorithm's color — this is
   the direct visual regression check for the anti-pattern `algorithmColor.ts`'s registry-index
   design exists to prevent.

Also confirmed: the null ("n/a") vs. real-zero bar distinction, the palette validator's actual
output against this project's real surface colors (not `palette.md`'s reference surfaces),
hover/focus tooltip behavior and keyboard-focusability, responsive layout at ~400px, and both color
schemes. Per this project's established split (Units 06/07), pure logic (`algorithmColor.ts`,
`dashboardChartData.ts`) is Vitest-covered with exact fixtures; everything DOM-rendering-touching is
verified only by actually running the app in a browser — this file's Manual Tests section is the
primary verification for chart rendering, color consistency, and interaction, not a supplement to
the automated tests.

## Manual Tests

**Tooling note:** the `claude-in-chrome` MCP browser tools require calling `AskUserQuestion` as
part of their mandated browser-selection protocol before any browser action, and that tool was not
available in this (subagent) session. As a substitute that still exercises a real, full
Chromium/Chrome engine, these tests were driven with Playwright's `chromium.launch({ channel:
'chrome', headless: true })`, controlling the actual installed Google Chrome on the host via the
Chrome DevTools Protocol — the same substitute used in prior units when `claude-in-chrome` was
unavailable. Playwright was installed only into a scratch directory outside the project (`npm init`
+ `npm install playwright` inside the session's scratchpad, in a `pw-08charts/` subfolder) — never
added to `package.json`. Verified afterward: `git diff --stat package.json package-lock.json`
produced no output (no diff), `ps aux | grep -i "vite\|playwright\|headless"` showed no leftover
dev/preview server or launched headless Chrome after the script's `browser.close()` ran, and the
scratch directory (script + screenshots + throwaway `npm install`) was deleted at the end of the
session. Console/page-error listeners (`page.on('console')`, `page.on('pageerror')`) were attached
for every scenario below; every run reported **0 console errors**.

Default config used throughout (Unit 06/07 defaults, unchanged): 5 floors, 2 elevators, capacity 8,
up-peak, arrival rate 6/min, duration 5 min, trial count 10, all 3 algorithms selected. The actual
registered algorithm ids (from `src/algorithms/index.ts`'s real `import.meta.glob` order, confirmed
via `ls src/algorithms/`) are, alphabetically by filename: `fcfsNearestCar.ts` (index 0, "FCFS /
Nearest Car"), `nearestCarDirectional.ts` (index 1, "Nearest Car (Directional)"), `scanLook.ts`
(index 2, "SCAN / LOOK") — this is the real registry order the plan's illustrative mapping
explicitly said might not match; it doesn't, and that's expected/fine, since the mapping is
registry-derived, not literal.

### 1. Dev server (`npm run dev`, `http://localhost:5183/L-vator/`), light mode, default run

Ran the default scenario with all 3 algorithms selected. Result: 4 chart panels rendered above the
table ("Average wait time", "Max wait time", "Throughput", "Unserved"), each with 3 horizontal
bars (one per algorithm, in fixed registry order: FCFS / Nearest Car, Nearest Car (Directional),
SCAN / LOOK — same order in every panel), a direct value label at each bar's tip, no axis
ticks/gridlines, and a single shared legend above all four panels.

**Cross-view color consistency — confirmed via computed styles, not eyeballing.** Read
`getComputedStyle(...).backgroundColor` for the legend swatches, every chart bar in all 4 panels,
and every table-row swatch in the same page load:

| Algorithm | Legend swatch | Chart bars (all 4 panels) | Table swatch |
|---|---|---|---|
| FCFS / Nearest Car | `rgb(42, 120, 214)` | `rgb(42, 120, 214)` | `rgb(42, 120, 214)` |
| Nearest Car (Directional) | `rgb(235, 104, 52)` | `rgb(235, 104, 52)` | `rgb(235, 104, 52)` |
| SCAN / LOOK | `rgb(27, 175, 122)` | `rgb(27, 175, 122)` | `rgb(27, 175, 122)` |

`rgb(42, 120, 214)` = `#2a78d6` (`--series-1`), `rgb(235, 104, 52)` = `#eb6834` (`--series-2`),
`rgb(27, 175, 122)` = `#1baf7a` (`--series-3`) — exactly the three validated light-mode slots, and
identical across legend/charts/table for every algorithm. **Confirmed.**

**Real proportional bar lengths and direct value labels**, e.g. (one representative run):

- Average wait time: FCFS / Nearest Car 9333 ms (bar 100%, the panel max), Nearest Car
  (Directional) 4551 ms (bar 48.77%), SCAN / LOOK 5414 ms (bar 58.00%) — `4551/9333 = 0.4877`,
  `5414/9333 = 0.5800`, confirming proportion is computed correctly relative to that panel's own
  max, matching the exact numbers in the table row below.
- Unserved panel: all three algorithms genuinely served everyone this run (`0.0%` each) — every bar
  rendered with `barColor` present (a real `<span class="chart-bar">` element exists) and
  `barWidthPct: "0%"`, i.e. an actual zero-length *real* bar, not the null/"n/a" case (see test 4
  below for that contrast). Confirms the "all-zero-but-real" edge case live, not just in
  `dashboardChartData.test.ts`'s fixture.
- End-to-end value agreement: every chart bar's tip label matched its algorithm's exact cell value
  in the table below it (e.g. "Average wait time" panel's `9333 ms` for FCFS matches the table's
  "Avg wait (ms)" column `9333.1` for the same row, rounding aside).

### 2. Recolor-on-filter — the direct regression check

With the default scenario still configured, **unchecked the "FCFS / Nearest Car" algorithm
checkbox** (leaving Nearest Car (Directional) and SCAN / LOOK selected) and re-ran. Read the
resulting legend's computed swatch colors:

| Algorithm | Color before filtering (test 1) | Color after filtering out FCFS |
|---|---|---|
| Nearest Car (Directional) | `rgb(235, 104, 52)` | `rgb(235, 104, 52)` |
| SCAN / LOOK | `rgb(27, 175, 122)` | `rgb(27, 175, 122)` |

Both surviving algorithms kept their exact color after FCFS was filtered out of the run — neither
shifted to fill the gap (a position-in-filtered-array implementation would have repainted Nearest
Car (Directional) to slot 1's blue). **Confirmed**: `algorithmColorVar`'s registry-index design
works as designed in a real re-run, not just in `algorithmColor.test.ts`'s fixture-only regression
test.

### 3. Null ("n/a") vs. real-zero — side by side

Test 1 above already exercised the real-zero case live (Unserved panel, `0.0%`, a genuine
zero-length colored bar). To force the null case, set **Arrival rate (per minute)** to `0` (no
passengers ever arrive) and ran. Result: every one of the 4 panels showed **"n/a"** for all 3
algorithms, with:

- No `.chart-bar` element rendered at all in any row (`hasBarFill: false` for all 12
  panel/algorithm combinations read via `document.querySelectorAll`) — not a zero-width bar, no
  bar element at all.
- Each row's `aria-label` reading e.g. `"FCFS / Nearest Car: n/a"`.
- The table below correctly showing `n/a` throughout too (Unit 07's existing `formatNumber`,
  unmodified).

This is visually and structurally distinguishable from test 1's genuine-zero Unserved panel (which
had a real, present zero-width bar element and text `0.0%`) — confirms the plan's core
null-vs-real-zero distinction end-to-end, not just via `dashboardChartData.test.ts`'s fixtures.

### 4. Hover/focus tooltip

Focused the first chart row (`Tab` to it / programmatic `.focus()`) — result: a tooltip appeared
positioned above the row, reading `"8829 ms" "FCFS / Nearest Car"` with the value in a bold/strong
span and the algorithm name in a secondary/muted span after it (value leads, per the dataviz
skill's `interaction.md`), and the row showed a visible focus outline (`outline: 2px solid
var(--text)`). Hovering the same row with the pointer (`pointerenter`) produced the identical
tooltip content and position — **same content on keyboard focus as on hover**, confirmed, not just
asserted. Moving off the row (`pointerleave`/`blur`) hid the tooltip both times. The value is also
always readable directly on the bar's tip label with no interaction required — the tooltip
enhances, it doesn't gate, per the skill's non-negotiable.

### 5. Responsive layout at ~400px

Resized the viewport to 390px wide (a common phone width) and re-inspected. Result:
`.chart-panels`' computed `grid-template-columns` collapsed to a single `318px` column (all 4
panel elements' `getBoundingClientRect().left` identical, i.e. stacked vertically, not
side-by-side) — the `auto-fit`/`minmax(200px, 1fr)` grid naturally stacked with no hand-authored
breakpoint, as the plan predicted. No chart label was clipped (`overflow-wrap: normal` on
`.chart-row-label`, which now sits on its own full-width line above the bar+value row — see
"Deviation" below). `.dashboard-charts`' own `scrollWidth` (318px) stayed within the 390px
viewport — no horizontal overflow contributed by the charts. (The page's `<body>` does show
horizontal overflow at this width — traced to the pre-existing Unit 07 comparison table, which has
10 unresponsive columns; confirmed via per-element `scrollWidth` inspection that neither
`.dashboard-charts` nor any of its descendants are the source. That table was not in this unit's
scope to fix — see "Deviations" in `08_charts.md`.)

### 6. Dark mode

Repeated test 1's default run with `colorScheme: 'dark'` emulated. Result: page background/text
correctly flipped to the dark tokens; chart bars rendered in the validated dark-mode series colors
(visually distinct blue/orange/green, adequate contrast against the dark surface); legend swatches
and table swatches matched the chart bars' colors in this mode too, same cross-view-consistency
check as test 1, repeated visually in dark mode. No console errors.

### 7. Production build (`npm run build && npm run preview`, real `/L-vator/` base path)

Repeated test 1 and test 2 against `http://localhost:5184/L-vator/` served from `npm run preview`
(the actual production bundle, real base path). Result: identical legend/chart/table color
agreement (`rgb(42, 120, 214)` / `rgb(235, 104, 52)` / `rgb(27, 175, 122)` for the same three
algorithms respectively) and identical recolor-on-filter behavior (surviving algorithms' colors
unchanged after filtering). 0 console errors.

## Automated Tests

`npm run test` (Vitest) — 27 test files, **177 tests, all passing**, including the two new files:

- **`src/ui/dashboard/algorithmColor.test.ts`**: `algorithmRegistryIndex` returns each registered
  algorithm's real registry position (and `-1` for a non-registered id); `algorithmColorVar`
  assigns each registered algorithm the correct `var(--series-N)` by registry index; the direct
  recolor-on-filter regression test — simulating a run with the first registered algorithm filtered
  out of `selectedAlgorithmIds`, confirms every surviving algorithm's color matches what the
  full-registry fixture would produce (never a color derived from the filtered subset's own
  position/length).
- **`src/ui/dashboard/dashboardChartData.test.ts`**: the four panels compute in the fixed order;
  proportion computed correctly for ordinary values relative to that panel's own max; a `null`
  value produces the "n/a" marker (`value: null`, `proportion: null`), never a `0` proportion;
  **all-null-for-one-metric** doesn't divide by zero (`max: 0`, no `NaN`, every row null); **all-zero**
  (every algorithm has a real `0`) renders real zero-length bars (`value: 0`, `proportion: 0`), not
  "n/a" — the specific distinction the plan resolves; mixed null-and-real values in the same panel;
  proportion is independent across panels with different units/scales (not a shared max); bar rows
  follow the fixed registry order even when `metrics` arrives in a different order (simulating an
  arbitrary `selectedAlgorithmIds` order); `formatValue` formats each metric's representative
  value correctly (ms/hr%/percent, rounding).

`npm run lint` (ESLint) — clean, no errors/warnings.

`npm run format:check` (Prettier) — all files formatted correctly.

`npm run build` (`tsc -b && vite build`) — clean typecheck, successful production build (both
before and after the `chart-row` label-wrapping layout fix described in "Deviations" below).

## Integration Checks

- `dashboardTable.ts`'s existing `bestAlgorithmId`/`METRIC_DIRECTIONS`/`formatNumber` and its
  best-per-metric cell highlight are untouched — only the new swatch span was added to the
  Algorithm column, gated behind a new `showSwatch` flag on that one `ColumnDef` entry; all of
  `dashboardTable.test.ts`'s existing tests still pass unmodified.
- `dashboardView.ts` renders charts above the table in sequence (not tabs/toggle), matching the
  plan; `resultsView.ts` (which calls `renderDashboardView`) required no changes — the function
  signature was unchanged.
- `style.css`'s existing `--text`/`--bg` dark-mode pattern was extended, not replaced: `--series-1`/
  `-2`/`-3` follow the identical `:root` + `@media (prefers-color-scheme: dark)` structure already
  there.
- No new runtime dependency: confirmed via `git diff --stat package.json package-lock.json`
  producing no output.
- `algorithmName` was changed from a private helper to an exported one in `dashboardTable.ts` so
  `dashboardCharts.ts` reuses it instead of duplicating the same `algorithms.find(...)` lookup —
  the only change to that file beyond the swatch itself.

## Success Criteria

- [x] Four chart panels (average wait, max wait, throughput, unserved%) render as small multiples,
      one bar per algorithm, fixed registry row order identical across all four panels.
- [x] Colors are consistent for a given algorithm across the legend, all four chart panels, and the
      table's swatch column — confirmed via computed styles, not eyeballing.
- [x] Recolor-on-filter does not occur: re-running with a different `selectedAlgorithmIds` subset
      leaves surviving algorithms' colors unchanged — confirmed both by a unit test and live in the
      browser.
- [x] A `null` metric value renders as a visible "n/a", never a zero-height/zero-width bar element;
      a real `0` value renders as an actual zero-length bar — both confirmed live, distinguishable.
- [x] Palette validated with `node scripts/validate_palette.js` against this project's actual
      `--bg` values (`#ffffff` light / `#16171d` dark) with `--pairs all`: **PASS** in both modes
      (light carries the expected, plan-anticipated contrast WARN on slot 3/aqua, mitigated by
      direct labels + the adjacent table view — see `08_charts.md`).
- [x] Hover and keyboard focus show the same tooltip content; every value is also reachable without
      hovering (direct labels + table).
- [x] Layout stacks to a single column under ~400px with no clipped chart labels and no horizontal
      overflow contributed by the chart panels themselves.
- [x] Both light and dark mode render with real, validated contrast.
- [x] No console errors in dev, preview (production build/base path), or either color scheme.
- [x] `npm run lint`, `npm run format:check`, `npm run test` (177 tests), and `npm run build` all
      pass.
- [x] No stray scratch files, npm installs, or processes left behind; no `package.json`/
      `package-lock.json` diff.
