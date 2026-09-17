# Unit 06: UI - Completion Context

## What Was Implemented

The config-panel/run UI under `src/ui/`: building/fleet/timing/arrival config panel (all `00_main.md` fields, plus `durationMs`/`seed` with sensible defaults), a random-vs-scripted scenario toggle (loading examples from `src/scenarios/`), algorithm selection checkboxes, run controls, and a deliberately plain results table — enough to prove config → `runTrialBatch` → `computeMetrics` works end-to-end in a real browser, without building any part of Unit 07's polished dashboard/replay. Vanilla TS against the DOM, no framework — a single mutable `AppState` with a focus-preserving render strategy (direct `oninput`/`onchange` mutation for text fields, full re-render only for structural changes).

## Key Decisions

- Unit 06 ships a plain, unstyled results table (developer-confirmed) rather than zero visible output, since every prior unit has been validated by actually using it, not just type-checking.
- `generatingFloors` exported from Unit 04's `randomArrivals.ts` (small, additive, non-breaking) so the per-floor-rate panel reuses the real pattern-to-floors rule instead of duplicating it.
- A `floorCount: 0` config was found (during plan review) to crash mid-run with a cryptic engine error, since Unit 04's destination-selection helpers don't guard against it. Fixed at the UI layer (`min="1"` on the floors input plus a matching validation check) rather than touching Unit 04.
- Testing split: Vitest covers only pure logic (`buildScenario`, `validation`); DOM rendering, clicks, and focus behavior are verified manually in a real browser — no jsdom added.

## Deviations from Plan

Three implementation-level refinements, all documented in `06_ui.md`'s AI Interactions: `RunState` resolved to one consistent discriminated-union shape; the floor-count field's structural re-render trigger moved from `oninput` to `onchange` (an `oninput`-triggered re-render on a text field would itself cause the exact focus-loss problem the plan's state model was designed to avoid); the scripted-example dropdown is labeled positionally ("Example 1...") since `ScriptedScenario` carries no display-name field and adding one was judged out of scope for a UI-only unit.

## Files Modified

Created: `src/ui/types.ts`, `state.ts`, `buildScenario.ts`, `validation.ts`, `configPanel.ts`, `algorithmSelect.ts`, `runControls.ts`, `resultsView.ts`, `app.ts`, two test files, `dev_log/06_ui_test.md`. Modified: `src/main.ts` (mounts the new UI), `dev_log/06_ui.md`.

Also touched, as a small additive amendment to the already-completed Unit 04 (approved in the plan, committed together with this unit's implementation): `src/generation/randomArrivals.ts` (exported `generatingFloors`), `src/generation/index.ts` (re-exported it).

## Integration Notes

- **Unit 07** (results presentation) builds the polished dashboard/replay on top of this unit's `AppState`/results plumbing — the plain table here is explicitly a floor, not a ceiling, for what Unit 07 will present.
- Real browser verification (dev server and a production preview build under the actual `/L-vator/` base path) surfaced a real algorithm-layer bug — see below — that no prior unit's narrower testing had found, continuing this project's pattern of each unit's more-realistic exercise catching real issues in already-completed work.

## A significant finding, investigated and fixed during this unit's review

Real browser testing against the default scenario surfaced FCFS and nearest-car-directional catastrophically failing under realistic load (20-37% unserved passengers, max wait times near the safety cutoff) while SCAN/LOOK handled the identical batch fine. This was **not** a Unit 06 defect — the UI correctly displayed exactly what the algorithms computed — but the finding was investigated to completion during this unit's review rather than merely logged. Root cause: two compounding bugs in `fcfsNearestCar.ts`'s/`nearestCarDirectional.ts`'s shared assignment logic (a full elevator never actually departed to deliver its passengers, and an assignment was permanent for as long as its call stayed active regardless of the assigned elevator's real position, permanently excluding every other elevator from helping). Fixed as a Unit 03 amendment (commit `778eb12`; full writeup in `03_algorithms_done.md`). Verified against the exact scenario that surfaced it: FCFS went from 21.9% unserved to 0%, and max wait from ~5.9 million ms to 37,016ms.

## Lessons Learned

This is the sixth consecutive unit where more realistic exercise (here: a real browser, clicking through actual user flows) found a real bug — and the most consequential one yet, since it affected two of the three algorithms' core comparative behavior, the exact thing this whole project exists to demonstrate. The bug had been present since Unit 03's original implementation and had passed all of that unit's own tests, Unit 04's fairness tests, and Unit 05's metrics tests, because none of them happened to construct a scenario with sustained per-floor demand exceeding one elevator's throughput — the UI's default scenario, picked purely for being a reasonable-looking demo, was the first thing in six units to actually do that. A UI unit's "plain results table, just to prove the pipeline works" requirement — itself a scope-boundary decision that could have been skipped — is what surfaced this; shipping zero visible output in Unit 06 (the alternative considered during planning) would have deferred this discovery to Unit 07 at the earliest, or to a real user, at the latest.

## Amendment (post-implementation, at developer request): default timing values changed

`defaultConfig()`'s `building.floorTravelTimeMs` changed from 2000 to 5000, and `doorDwellBaseMs` from 3000 to 1000 (`doorDwellPerPassengerMultiplier` was already 0.5/50%, unchanged) — slower travel between floors, faster base door time, at the developer's explicit request. This unit's plan table in `06_ui.md`, "Config panel fields and defaults" now reads stale (left as a historical record, per this project's convention of not rewriting completed plan files); this file and the live default in `state.ts` are authoritative. No test asserted the old values (no dedicated `state.test.ts` exists); `npm run lint`/`test`/`build` re-verified clean.
