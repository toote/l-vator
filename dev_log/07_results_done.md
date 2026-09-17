# Unit 07: Results presentation - Completion Context

## What Was Implemented

Animated single-panel replay and an upgraded comparison dashboard, built on top of Unit 06's existing UI: `RunState['done']` now retains each trial's full `TrialRunResult[]` (previously discarded once metrics were computed) plus a snapshotted `BuildingConfig`; a new `AppState.replay` selection tracks which algorithm/trial/time/speed is being watched. The replay cross-section shows a building grid (floor rows × elevator-shaft columns) with cars positioned via reconstructed-from-log interpolation, door state, passenger-count badges, and hall-call indicators, driven by a `requestAnimationFrame` loop that never touches the outer app's `render()`. The dashboard table is sortable and highlights the best algorithm per metric.

## Key Decisions

- Side-by-side multi-algorithm replay (watching the same trial across algorithms simultaneously, made correctness-free by Unit 04's fairness guarantee) is deferred as a fast-follow, not baseline — single-panel replay only.
- Dashboard ships table-only; no bar charts in this unit.
- Default playback speed options: 1x/5x/10x/20x, 5x default.
- `RunState['done']` retaining full per-trial event logs in memory (not just aggregated metrics) is a deliberate, accepted tradeoff at this project's scale.

## Deviations from Plan

**A real bug in the plan itself, found and corrected during review, before implementation started.** The original draft's position-interpolation algorithm would linearly interpolate an elevator's position across the *entire* span between two `elevatorArrived` log entries — but when a stop occurred at the earlier one, that span includes the dwell time (`doorsOpened` to `doorsClosed`), not just travel time. Naive interpolation across the whole span would show the elevator visibly creeping during what should be a motionless door-open period, then creeping too slowly once actually moving. Corrected: interpolation anchors to the `doorsClosed` timestamp (not the `elevatorArrived` timestamp) whenever a stop occurred at the earlier arrival. Implemented verbatim from the corrected pseudocode; a regression test explicitly computes and asserts against the exact numeric value (2.875) the original buggy algorithm would have produced, versus the correct value (2.5) at the same probe time — confirmed by independent code review to be a genuine differentiating test.

No deviations from the approved (corrected) plan during actual implementation. One incidental note: the implementing agent's session was interrupted by a rate limit right after finishing all code, tests, and browser verification, before writing up the final two dev-log sections (AI Interactions, Files Modified) — those were completed directly by the reviewing session afterward, after independently re-verifying the interpolation fix and the full test suite.

## Files Modified

Created: `src/ui/replay/replayFrame.ts`, `replayClock.ts`, `replayCrossSection.ts`, `replayControls.ts`, `replayView.ts`, `replayFrame.test.ts`, `replayClock.test.ts`; `src/ui/dashboard/dashboardTable.ts`, `dashboardView.ts`, `dashboardTable.test.ts`; `dev_log/07_results_test.md`. Modified: `src/ui/types.ts`, `state.ts`, `app.ts`, `runControls.ts`, `resultsView.ts`, `validation.test.ts` (one-line fixture fix); `dev_log/07_results.md`.

## Integration Notes

This was the seventh and final unit in `00_main.md`'s original Planned Units list. After this unit, the project's baseline scope (per `00_main.md`'s "What This Is") is complete: config panel, three dispatch algorithms, seeded/reproducible call generation, eight-metric computation, and now a full config → run → animated replay → comparison dashboard pipeline. Re-confirmed none of `00_main.md`'s three Future Enhancements (manual/interactive mode, destination-dispatch algorithms, UI-authorable scripted scenarios) needed touching. Side-by-side replay and dashboard charts, both deferred here, are the clearest next candidates if the project continues past baseline scope.

## Lessons Learned

The interpolation bug caught during this unit's plan review is the project's clearest example yet of a subtle log-reconstruction error that would have shipped as a "looks fine at a glance, wrong on close inspection" defect — the animation would have played smoothly and looked plausible; only a frame-by-frame check against the actual dwell timing would reveal the elevator moving during a period it should have been stationary. This continues a pattern going back to Unit 05: reconstructing state from an event log rather than reading it directly is exactly the kind of code that warrants tracing by hand against a concrete example before trusting it, regardless of how confident the surrounding prose sounds.
