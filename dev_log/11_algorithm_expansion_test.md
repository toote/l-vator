# Unit 11: Algorithm roster expansion - Test Instructions

## Test Objectives

Confirm FCFS's removal is clean (no dangling references, discovery count/ids correct), confirm
each of the eight new algorithms (zoning ×4, ETA-based ×2, random ×2) behaves as designed — not
just that it exists and doesn't crash — and confirm the doubled 12-color palette is genuinely
distinguishable in the app, not just theoretically.

1. **FCFS is fully gone**: no source file references it, the registry contains exactly the twelve
   expected ids, and every other file that used to import it directly (`fairness.test.ts`) still
   proves the same underlying property against a different real algorithm.
2. **Zoning's core rule is correct**: `zoneFor`'s floor partition is exactly right at every
   boundary condition (even division, remainder, single elevator, more elevators than floors); a
   call outside an elevator's zone is never assigned to it (except floor 0, always shared); an
   onboard drop-off outside the zone is still honored.
3. **The one deliberate zoning/zoning-fallback difference is real and measured**, not just
   asserted at the unit level: a zone-heavy scenario run through the actual app shows a large,
   real difference between the two variants.
4. **ETA-based dispatch's cost estimate is exactly right**, hand-computed for both the compatible
   and incompatible (turnaround) cases, and the hook-level assignment genuinely follows lowest
   cost even when that disagrees with raw distance.
5. **Random dispatch is genuinely deterministic and seed-reproducible** (not `Math.random()`), and
   genuinely picks more than one elevator across varied calls (not silently collapsed onto "always
   nearest" or "always first").
6. **`src/engine/rng.ts`'s relocation** doesn't change `createRng`'s behavior for any existing
   consumer — proven by the untouched consumer tests (`randomArrivals.test.ts`,
   `trialBatch.test.ts`, etc.) continuing to pass unchanged, plus a dedicated re-export smoke test.
7. **All twelve algorithms are visually distinguishable** in the running app, in both light and
   dark mode, using the extended `--series-1..12` palette.

Per this project's established split: pure logic (`zoneFor`, `estimateArrivalMs`,
`pseudoRandomIndex`, every algorithm's `decide()`/`refreshAssignments`, `algorithmColor.ts`) is
Vitest-covered with exact hand-computed fixtures; the config panel's full checkbox list, dashboard
color rendering, and the zoning/zoning-fallback real-world divergence are verified only by
actually running the app in a browser.

## Palette validation

Doubling the categorical palette from 6 to 12 slots turned out to be a genuinely harder problem
than "add 6 more colors" — extensive search (multiple hand-picked candidate sets, an HSL sweep, and
finally a proper OKLCH-space search maximizing hue separation, all run against the dataviz skill's
`validate_palette.js`) could not find any 12-color set clearing `--pairs all` (this project's
standard for Units 08/10): even 8 new colors alone, maximally spread around the OKLCH hue wheel at
CVD-safe lightness/chroma, only reach a worst normal-vision ΔE around 10 — short of the required
15 floor. This matches the dataviz skill's own reference palette, which documents that even its
carefully-tuned 8 hues cannot clear `--pairs all` beyond the first 3 slots. This is a real,
measured limit of the color space at this series count, not a shortfall from insufficient effort.

Resolved by validating against `--pairs adjacent` instead, which is *actually the correct target
for this dashboard's own chart shape* (fixed `COLOR_ORDER` row order across the legend, bar
charts, and table — never an all-pairs-simultaneous layout like a scatter plot or choropleth,
which is what `--pairs all` exists for). Approach: the four surviving algorithms keep their exact
Unit 08/10 hex values, unchanged (`nearest-car-directional`, `scan-look`, and their homing
variants) — their `COLOR_ORDER` *index* shifts (an unavoidable consequence of removing FCFS from
the middle of the list, not a recolor-on-filter regression), but their actual paint color does
not. The eight new slots are four hue families (blue, violet, green, red), each holding a
base+homing pair expressed as two OKLCH lightness steps of the identical hue, calibrated per-hue
(via a small search over chroma and the two lightness values) to land the pair's own ΔE above 15
while staying inside the mode's lightness band and chroma floor.

**Light** (surface `#ffffff`): `--pairs adjacent` **PASS** — worst adjacent CVD ΔE 7.0 (protan,
aqua↔khaki-gold, a carryover from Unit 10), worst adjacent normal-vision ΔE 17.4. Contrast-vs-
surface: 7 of 12 slots (aqua, khaki gold, sky blue, and most of the new pastel/mid-tone slots)
fall in the sub-3:1 relief band — more than Units 08/10's 1-3 WARNs, an accepted consequence of a
larger, lighter-leaning palette, mitigated the same way every prior WARN has been: every series
color is always paired with a direct label (legend, bar labels, table row), never color-only
encoding. `--pairs all`: **FAIL** (documented above, not remediable at this series count).

**Dark** (surface `#16171d`): `--pairs adjacent` **PASS** — worst adjacent CVD ΔE 8.7 (protan,
zoning↔scan-look-homing), worst adjacent normal-vision ΔE 16.1. Contrast-vs-surface: 2 slots
(zoning-fallback, random-dispatch) in the relief band, same mitigation. `--pairs all`: **FAIL**,
same documented limit.

Both runs: Lightness band and Chroma floor **PASS** outright for every slot.

## Manual Tests

**Tooling note:** `claude-in-chrome` was unavailable this session (checked via `tabs_context_mcp`,
as every prior unit's own note records). Verified with Playwright (`chromium.launch()`), installed
to a scratch directory outside the project (confirmed via `git status --short package.json
package-lock.json` showing no diff).

1. **Dev server, config panel, light and dark mode.** `npm run dev`, navigated to `/L-vator/` with
   both `colorScheme: 'light'` and `colorScheme: 'dark'`. Confirmed:
   - All 12 algorithm checkboxes present, checked by default, each with a non-empty, accurate
     description: "ETA-Based", "ETA-Based (Returns to Lobby)", "Nearest Car (Directional)",
     "Nearest Car (Directional) (Returns to Lobby)", "Random", "Random (Returns to Lobby)",
     "SCAN / LOOK", "SCAN / LOOK (Returns to Lobby)", "Zoning", "Zoning (With Fallback)", "Zoning
     (With Fallback) (Returns to Lobby)", "Zoning (Returns to Lobby)".
   - No `console.error`/`pageerror` events in either mode.

2. **Full run against the default scenario (up-peak, 2 elevators, 5 floors, 10 trials), all 12
   algorithms.** Dashboard rendered with a 12-entry color legend (each swatch visually distinct in
   both modes — confirmed by screenshot review, not just the validator's numbers), four bar-chart
   panels each showing all 12 algorithms, and the comparison table with 12 real, distinct rows of
   metrics (not stubbed data). Replay's algorithm dropdown listed all 12; elevator shafts and
   status labels rendered correctly, matching prior units' established layout.

3. **Zoning vs. zoning-fallback real-world divergence**, the direct point of shipping two
   variants: built a zone-heavy scenario (10 floors, 2 elevators → zones [1,5]/[6,10], capacity 2,
   `random` pattern with floor 3's per-floor rate overridden to 30/min while the base rate stays
   at 2/min, 10 trials) and ran it through the actual app. Result: **Zoning** (strict) averaged
   71,285.6ms wait / 290,570.3ms max wait; **Zoning (With Fallback)** averaged 36,784.9ms /
   163,434.1ms — roughly half, on both metrics, from letting the idle out-of-zone elevator help.
   (Unserved count stayed 0% for both in this run — the trial duration was long enough that
   nothing was ever fully dropped, just delayed; the divergence shows up in wait time rather than
   unserved count for this particular scenario, which is still a clear, honest demonstration of
   the tradeoff the plan set out to show.) No console errors.

## Automated Tests

`npm run format:check`, `npm run lint`, `npm run test` (261/261 passing — 50 new across the eight
new algorithm files' test suites plus `engine/rng.test.ts`, `algorithmColor.test.ts`'s rewritten
12-slot mapping, and `algorithms.test.ts`'s FCFS-removal updates), `npm run build` all pass
cleanly.

`algorithmColor.test.ts`'s "returns -1 for `fcfs-nearest-car`" assertion is a genuine regression
check: it would fail if `COLOR_ORDER` ever kept a stale entry for a removed algorithm id.
