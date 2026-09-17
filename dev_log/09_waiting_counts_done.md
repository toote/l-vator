# Unit 09: Waiting-passenger counts - Completion Context

## What Was Implemented

A per-(floor, direction) waiting-passenger count, shown live in the replay's hall-call indicators: `src/ui/replay/waitingCounts.ts` (`groupWaitingCounts`/`computeWaitingCounts`, a sibling to `replayFrame.ts` reusing its `countAtOrBefore` binary-search primitive) reconstructs, from a trial's regenerated arrivals and event log, how many people are waiting at each (floor, direction) pair at any simulated time T — `arrivals with arrivalTime <= T` minus `those already boarded by T`. `replayCrossSection.ts`'s hall indicators extend the existing bare ▲/▼ glyph with a count badge (`▲ 3`) once one or more passengers are waiting, an `.overloaded` bold treatment once a count exceeds building capacity, and an extended tooltip (`"Floor N, direction — K waiting"`).

## Key Decisions

- **Per-direction counts, not combined per-floor** — the developer's explicit correction mid-session (an initial "combined per floor" answer was immediately superseded): up and down queues at the same floor are shown as two independent numbers, matching the project's existing direction-aware hall-call model rather than collapsing it.
- `waitingCounts.ts` is a sibling module to `replayFrame.ts`, not an extension of it — it needs one extra input (`ScriptedInput`, the regenerated per-trial arrivals) that `replayFrame.ts`'s already-shipped, already-tested shapes don't carry.
- A (floor, direction) pair with zero arrivals in the whole trial is simply absent from `GroupedWaitingCounts.groups` — consumers default an absent key to a count of 0, mirroring `replayCrossSection.ts`'s existing `activeHallCalls`-lookup convention.
- Bare glyph (no "0" badge) at count 0 — the existing dimmed/inactive opacity styling already communicates "nothing here"; a literal "▲ 0" next to an already-dimmed glyph would be redundant.
- `.overloaded` (count > capacity) is the *only* thing that bolds a badge — see Deviations below for why this needed a one-line fix to a pre-existing Unit 07 rule.

## Deviations from Plan

None in scope or architecture. One real bug found and fixed via real browser testing (`getComputedStyle` measurement across the active/overloaded boundary, not visible from code review alone): Unit 07's pre-existing `.replay-hall-indicator.active` rule also set `font-weight: bold`, which made the new `.overloaded` treatment invisible in practice — a badge went bold the moment it became active (almost immediately after any arrival), long before its count actually exceeded capacity, directly undermining the plan's own success condition that overloaded be visually distinct. Fixed by removing the redundant `font-weight: bold` from `.active` (its `opacity: 1` alone still fully conveys active/inactive); `.overloaded` is now the only rule that bolds. Re-verified all three states (inactive, active-under-capacity, overloaded) are visually and programmatically distinct in both light and dark mode. Full detail in `09_waiting_counts.md`'s AI Interactions and `09_waiting_counts_test.md`.

## Files Modified

Created: `src/ui/replay/waitingCounts.ts`, `waitingCounts.test.ts`, `dev_log/09_waiting_counts_test.md`. Modified: `src/ui/types.ts` (`RunState['done']` gains `scenario: Scenario`, needed to re-derive per-trial arrivals via `generateTrialBatch`), `src/ui/runControls.ts` (stores `scenario` on run completion), `src/ui/replay/replayView.ts` (regenerates the trial batch and groups waiting counts once per trial/algorithm selection), `src/ui/replay/replayControls.ts` (frame loop computes and passes waiting counts alongside the replay frame every frame), `src/ui/replay/replayCrossSection.ts` (badge rendering, `.overloaded` styling, extended tooltips; the `.active` bold-removal fix above), `dev_log/09_waiting_counts.md`.

## Integration Notes

`groupWaitingCounts` is matched strictly to `replay.trialIndex` via `batch[replay.trialIndex]` — the same trial-index-scoping discipline Unit 05's `computeMetrics.ts` established, since `generateTrialBatch` reuses passenger ids (e.g. `"arrival-0"`) across different trial indices. A dedicated regression test (mirroring `computeMetrics.test.ts`'s own) proves scoping to the wrong trial produces a different, wrong population.

## Lessons Learned

The `.active`/`.overloaded` CSS collision is this project's second instance (after Unit 08's label-wrapping bug) of a rule that reads correctly in isolation but silently breaks once layered against a pre-existing rule from an earlier unit — reinforcing that real-browser verification of the *combined*, not just the new, styling is necessary whenever a unit extends a shared visual component rather than adding an isolated one. Separately, this unit's implementation ran concurrently with an unrelated live bug investigation (SCAN/LOOK capacity gating, then FCFS dispatch concurrency) touching adjacent files in `src/algorithms/`; the implementing agent correctly noted the in-progress, out-of-scope change in `scanLook.ts` as "pre-existing, unrelated" without touching it — worth calling out as a case where background parallel work stayed cleanly isolated.

## Amendment (post-implementation, during developer review): replay interpolation showed idle elevators moving early

While reviewing this unit's replay changes alongside a live FCFS dispatch-concurrency investigation, the developer reported watching an idle elevator "slowly moving down" in the replay well before it was actually dispatched. This turned out to be a real bug in `replayFrame.ts`'s `positionAtTime` (Unit 07's original interpolation logic, not new to this unit) — full root cause and fix documented as its own amendment in `dev_log/07_results_done.md`. Fixed and committed separately, since it's a Unit 07 file this unit's own scope didn't touch.

## Amendment (post-implementation, at developer request): count badges reserved layout space

Developer-reported: passenger-count badges should always show a number, or otherwise reserve space, so the floor row doesn't shift when a count appears/disappears or changes digit count. This directly reverses this unit's original "bare glyph at count 0" decision (above) — the redundancy argument that motivated it didn't account for the layout-stability cost of text appearing/disappearing and changing width.

Fixed in `replayCrossSection.ts`: each hall indicator's count is now its own child `<span class="replay-hall-count">`, always rendered (including `0`), with `min-width: 1.5ch`, `text-align: left`, and `font-variant-numeric: tabular-nums` — reserving fixed, equal-digit-width space for up to 2 digits so 0→1, 1-digit→2-digit, and count-disappears transitions never reflow the row. `createHallIndicator` factored out to avoid duplicating the up/down indicator construction now that each needs two child elements instead of one text node. `labelFor` (string-concatenation approach) removed in favor of setting the count span's `textContent` directly in `update()`.

No dedicated unit test — `replayCrossSection.ts` is a DOM-rendering file with no automated tests in this project (consistent with `dashboardCharts.ts`'s precedent from Unit 08), verified by browser inspection instead. **Not yet verified in a live browser** (Chrome extension unavailable both times this session) — `npm run lint`/`test`/`build` all pass, but the actual layout stability and `1.5ch` sizing should get a real visual check before considering this fully closed.

## Status: Complete
