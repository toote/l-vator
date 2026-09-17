# Unit 06: UI - Test Instructions

## Test Objectives

Confirm the vanilla-TS config panel, algorithm selection, run controls, and plain results table
work end-to-end: a user can configure a building/fleet/timing/arrival scenario (or load a
scripted example), select algorithms, run a batch, and see real per-algorithm metrics — with the
UI's own guards (empty algorithm selection, NaN fields, the `floorCount >= 1` Correction) and the
lower layers' own thrown errors (e.g. `doorDwellBaseMs <= 0`) both surfacing as a clear message
instead of a crash or blank page. Because this is the first unit with real DOM code, and per
`06_ui.md`'s own testing-split decision, the pure logic (`buildScenario.ts`, `validation.ts`) is
Vitest-covered while everything DOM-touching is verified only by actually running the app in a
browser — this file's Manual Tests section is therefore the primary verification method for most
of this unit, not a supplement to it.

## Manual Tests

**Tooling note:** the `claude-in-chrome` MCP browser tools were unavailable in this session
(`tabs_context_mcp` / `tabs_create_mcp` failed with "Browser extension is not connected", and
`list_connected_browsers` returned an empty list — no Chrome extension was paired to this
session). As a substitute that still exercises a real, full Chromium/Chrome engine rather than a
DOM-simulation shim, these tests were driven with Playwright's `chromium.launch({ channel:
'chrome' })`, controlling the actual installed Google Chrome on the host headlessly via the
Chrome DevTools Protocol — real HTML/CSS layout, real event dispatch, real `<input
type="number">` semantics, not jsdom. Playwright was installed only into a scratch directory
outside the project (not added to `package.json`), used purely as a browser driver for this
verification pass. Console messages and uncaught page errors were captured for every scenario
below via `page.on('console')` / `page.on('pageerror')`.

### 1. Dev server (`npm run dev`, `http://localhost:5180/L-vator/`)

1. **Load the page.** Confirm the heading "L-vator", the Configuration/Algorithms/Run/Results
   sections all render, and the config panel's defaults match `06_ui.md`'s table exactly:
   - Floors (above ground): 5, Elevators: 2, Capacity: 8, Floor travel time (ms): 2000, Door
     dwell base (ms): 3000, Door dwell per-passenger multiplier: 0.5, Arrival rate (per minute):
     6, Origin/destination pattern: up-peak, Trial count: 10, Duration (minutes): 5, Seed: a
     freshly random positive integer (observed e.g. `732390294`, different each load).
   - **Result: confirmed.** All fields read back exactly these defaults via `inputValue()`.
2. **Per-floor rate override matches `generatingFloors`.** With the up-peak default, confirm
   exactly one row, "Floor 0". **Result: confirmed** (`Floor 0:` only).
3. **Floor count change is structural.** Set Floors to 8 and blur (commit), then change the
   pattern dropdown to `random`. Confirm the per-floor-rate panel now shows 9 rows, "Floor 0"
   through "Floor 8". **Result: confirmed** (`count=9`, `Floor 0` … `Floor 8`).
4. **Pattern change is structural.** With floors still 8, change the pattern to `down-peak`.
   Confirm the panel now shows 8 rows, "Floor 1" through "Floor 8" — no "Floor 0" (down-peak
   never generates from the ground floor). **Result: confirmed** (`count=8`, `Floor 1` …
   `Floor 8`, no `Floor 0`).
5. **Scenario type toggle: Load example scenario.** Select "Load example scenario". Confirm the
   random-arrival fields (pattern, rate, per-floor rates, duration, seed) are hidden, a dropdown
   shows "Example 1", and the read-only building block shows exactly `upPeakDemo.ts`'s building:
   Floors 5, Elevators 1, Capacity 4, Floor travel time 2000ms, Door dwell base 3000ms,
   multiplier 0.5. Trial count remains a visible, editable field. **Result: confirmed** — the
   rendered block read exactly `Floors (above ground): 5 / Elevators: 1 / Capacity: 4 / Floor
   travel time (ms): 2000 / Door dwell base (ms): 3000 / Door dwell per-passenger multiplier:
   0.5`, matching `src/scenarios/upPeakDemo.ts` field-for-field.
6. **Toggle back to Random.** Confirm the random panel reappears with the state as last left
   (floors still 8 from step 3/4 — `AppState.config` isn't reset by toggling modes). **Result:
   confirmed** (`floors` read back as `8`). Floors was then reset to 5 and pattern back to
   up-peak for the run steps below.
7. **Algorithm selection.** Confirm three checkboxes, all checked by default, labeled by
   `algorithm.name`: "FCFS / Nearest Car", "Nearest Car (Directional)", "SCAN / LOOK". Uncheck
   "SCAN / LOOK". **Result: confirmed.**
8. **Run — "Running…" paints before the synchronous work.** Click Run. Immediately (same tick,
   no wait) read the button's text. **Result: confirmed** — the button read `Running...`
   immediately after the click, before the batch had finished, proving the `setTimeout(fn, 0)`
   deferral actually lets the "Running…" state paint per `06_ui.md`'s "Run controls" step 2.
9. **Results — real, distinct numbers.** Wait for the button to read "Run" again (batch done).
   Confirm the results table has exactly 3 rows (1 header + 2 selected algorithms — SCAN/LOOK
   correctly excluded) with real, algorithm-distinct numbers across all 8 headline metrics plus
   trial count. **Result: confirmed**, e.g.:

   | Algorithm | Trials | Avg wait | Max wait | Avg travel | Total dist. | Throughput | Occupancy | Deadhead | Unserved |
   |---|---|---|---|---|---|---|---|---|---|
   | FCFS / Nearest Car | 10 | 9605.3 | 5896411.2 | 14708.1 | 55.8 | 22.4 | 12.9 | 44.3 | 113 (36.5%) |
   | Nearest Car (Directional) | 10 | 7126.2 | 5896411.2 | 14128.2 | 73.3 | 42.3 | 12.1 | 46.2 | 72 (23.2%) |

   (See "Observation surfaced by this testing" below — the very large max-wait/high-unserved
   figures here are real and reproducible, but they point at an algorithm-layer characteristic,
   not a UI defect.)
10. **Error path 1 — the Correction note's `floorCount >= 1` guard.** Set Floors to 0, blur, click
    Run. Confirm a clear inline message appears ("Floors (above ground) must be at least 1.")
    and — critically — that `AppState.run`/the results section is untouched (still showing the
    previous successful table, not cleared, not crashed), matching `06_ui.md`'s "without touching
    AppState.run" instruction for a validation failure. **Result: confirmed**, message text
    exactly `Floors (above ground) must be at least 1.`; the previous results table was still
    intact afterward, byte-for-byte identical to step 9's output.
11. **Error path 2 — NaN guard.** Restore Floors to 5, clear the Elevators field entirely (blank
    `<input type="number">` → `NaN`), click Run. **Result: confirmed**, message read `Elevators
    must be a number.`.
12. **Error path 3 — a lower-layer thrown error surfaces via the try/catch.** Restore Elevators to
    2, set Door dwell base (ms) to 0, click Run. This passes the UI's own `validate()` (it's a
    well-formed number) but is rejected deep inside `runSimulation`'s own guard. Confirm the
    Results section renders a plain `<p>` reading `Error: BuildingConfig.doorDwellBaseMs must be
    > 0 (got 0) — a non-positive dwell time can produce a zero-duration stop that repeats forever
    with no time advancement.` — not a crash, not a blank page. **Result: confirmed** (see
    `scratchpad/pw/dev-error-state.png` screenshot taken at this exact state).
13. **Console.** `page.on('console')` and `page.on('pageerror')` were attached for the entire dev
    session above. **Result:** zero page errors; the only console output was Vite's own HMR
    `[vite] connecting...` / `[vite] connected.` debug lines — no app-level warnings or errors at
    any step.

### 2. Production build + preview (`npm run build && npm run preview`, `/L-vator/` base path)

1. Built successfully (`tsc -b && vite build`) and served via `vite preview` on port 4322.
   Navigated to `http://localhost:4322/L-vator/` — the real `/L-vator/` GitHub-Pages base path,
   not the dev server's root. **Result: confirmed** — page loaded, heading "L-vator" present, no
   404s/broken asset paths (`index.html`'s emitted `<script src="/L-vator/assets/...">` and
   `<link href="/L-vator/assets/...">` tags resolved correctly).
2. Ran the default scenario (all 3 algorithms selected, all default fields, i.e. exactly what a
   first-time visitor would get with zero configuration). **Result: confirmed** — a 4-row table
   (header + 3 algorithms) with real, distinct numbers, e.g. SCAN/LOOK: avg wait 5732.1ms, max
   wait 30252.0ms, 0 unserved (0.0%); FCFS: avg wait 9261.2ms, max wait 5946334.0ms, 63 unserved
   (21.9%). Screenshots saved to `scratchpad/pw/preview-initial.png` and
   `scratchpad/pw/preview-results.png`.
3. Console/page errors: **none**, in either the initial load or after running the batch.

### Observation surfaced by this testing — RESOLVED

**Resolved as a Unit 03 amendment immediately after this unit's review** — see `dev_log/03_algorithms_done.md`'s "Amendment (during Unit 06 review)" section for the root cause (two compounding bugs in FCFS's/nearest-car-directional's assignment logic) and fix (commit `778eb12`). Re-run against the exact default scenario below: FCFS went from 21.9% unserved / ~5.9M ms max wait to 0% unserved / 37,016ms max wait. The specific numbers in the walkthrough below (captured before this fix) are preserved for the record — they still correctly demonstrate that the UI rendered real, distinct per-algorithm numbers end-to-end, which is what this unit's manual testing was verifying; they are no longer representative of current algorithm behavior. The "flagged, not fixed" framing below reflects the state at implementation time, not the current state.

Across every dev-mode and preview-mode run above, **FCFS / Nearest Car** and **Nearest Car
(Directional)** consistently showed a very large `maxWaitTimeMs` (≈5.9 million ms, i.e. close to
but under `runTrialBatch`'s own `durationMs × 20` safety cutoff of 6,000,000ms for the default
5-minute/10-trial scenario) together with a high unserved percentage (20–37%), while **SCAN /
LOOK**, run against the *identical* seeded batch in the same call, showed a small, plausible max
wait (~30 seconds) and 0% unserved. This pattern was fully reproducible across two independent
runs (different random seeds, one in dev mode, one in preview mode against the default
scenario), and it's algorithm-specific, not scenario-specific — the same batch fed to all three
algorithms in the same `runTrialBatch` call. It's consistent with an elevator being dispatched
`idle` by one of those two algorithms while a hall call at that floor is still active (unserved
passengers waiting), combined with `runSimulation`'s `handlePassengerArrival` only re-invoking
the dispatch hook when a *new* (floor, direction) hall call becomes active — a later arrival at
an *already*-active call (guaranteed under up-peak, since every passenger originates at floor 0)
never re-pokes an idled dispatcher. This is a `src/engine`/`src/algorithms` (Units 02/03)
question, not a `src/ui` one, and per this unit's explicit scope boundary ("consumes, without
modifying" those layers) it has **not** been investigated further or touched here. Flagged for
the developer per this project's established practice (`00_main.md`'s amendment history: prior
units' "run it for real" testing repeatedly surfaced bugs narrower tests missed) — this unit's
results table did exactly the job `06_ui.md`'s scope-boundary section says it exists for.

## Automated Tests

Ran via `npm run test` (Vitest):

```
Test Files  22 passed (22)
     Tests  124 passed (124)
```

- 107 pre-existing tests (Units 01–05), all still passing after the `generatingFloors` export
  change (see "Files Modified" in `06_ui.md`).
- 17 new tests in `src/ui/`:
  - `buildScenario.test.ts` (7 tests): random-mode `Scenario` shape with no `floorRates` when
    none entered; `floorRates` filtered to exactly the pattern-relevant floors under `up-peak`,
    `random`, and `down-peak`; scripted-mode `Scenario` splicing in the UI's trial count while
    leaving the stored example's `building`/`script` untouched; a clear thrown error when
    scripted mode has no scenario selected.
  - `validation.test.ts` (10 tests): passes for well-formed random/scripted drafts; fails on an
    empty algorithm selection, a `NaN` building/arrivals field, a `NaN` seed; fails on
    `floorCount` 0 and negative (the Correction note's guard); fails in scripted mode with no
    scenario selected; confirms the random-mode `floorCount` guard does *not* fire in scripted
    mode.

No jsdom dependency was added, per `06_ui.md`'s explicit testing-split decision — DOM-touching
files (`configPanel.ts`, `algorithmSelect.ts`, `runControls.ts`, `resultsView.ts`, `app.ts`) are
covered only by the Manual Tests above.

## Integration Checks

- `npm run lint` — clean, no errors/warnings.
- `npm run format` then `npm run format:check` — all files match Prettier style.
- `npm run build` (`tsc -b && vite build`) — succeeds with strict TypeScript (no `any`, no
  unjustified non-null assertions); production bundle: `dist/assets/index-*.js` ≈26.6kB
  (≈7.8kB gzip).
- Confirmed Unit 04's own test suite (`randomArrivals.test.ts`, `fairness.test.ts`,
  `trialBatch.test.ts`, `trialRunner.test.ts`, etc.) still passes unchanged after exporting
  `generatingFloors` — that change is purely additive (one new `export` keyword on an
  already-existing function, plus a re-export line), no logic touched.
- `src/ui/*` imports only from `src/generation`, `src/algorithms`, `src/metrics`, `src/scenarios`,
  and `src/engine` (types) — confirmed by inspection: no import touches `src/engine`'s
  `simulation.ts`/`dispatch.ts` internals or any algorithm/generation/metrics internal module
  outside each layer's own public barrel (`index.ts`).

## Success Criteria

- [x] Config panel renders with every field from `06_ui.md`'s table, correct defaults.
- [x] Per-floor rate override shows exactly the floors `generatingFloors(pattern, floorCount)`
      returns, and updates (structural re-render) when floor count or pattern changes.
- [x] Scenario type toggle switches between the full random panel and a read-only scripted-example
      view; the scripted building readout matches the selected example exactly.
- [x] Algorithm checkboxes list every entry in `algorithms`, all checked by default, and
      unchecking one excludes it from the run.
- [x] Clicking Run shows "Running…" before the batch completes (proving the `setTimeout` deferral
      works), then a plain results table with one row per selected algorithm and one column per
      headline metric plus trial count, populated with real, algorithm-distinct numbers.
- [x] The `floorCount >= 1` Correction-note guard, the empty-algorithm guard, and the NaN-field
      guard all produce a clear inline message without touching `AppState.run` or crashing.
- [x] A lower-layer thrown error (`doorDwellBaseMs <= 0`) is caught and rendered as a plain error
      paragraph, not a crash or blank page.
- [x] The production build, served from the real `/L-vator/` base path, loads and runs correctly.
- [x] No console errors or uncaught page errors in any tested scenario.
- [x] `npm run lint`, `npm run format:check`, `npm run test`, and `npm run build` all pass.
