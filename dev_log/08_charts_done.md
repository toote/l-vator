# Unit 08: Dashboard charts - Completion Context

## What Was Implemented

Four small-multiple bar-chart panels (average wait time, max wait time, throughput, unserved%) added to the results dashboard, above the existing Unit 07 comparison table: `src/ui/dashboard/algorithmColor.ts` (stable per-algorithm color identity), `dashboardChartData.ts` (pure bar-data computation with correct null/zero handling), and `dashboardCharts.ts` (DOM rendering, hover/focus tooltips, scoped styling matching the replay grid's established pattern). The table gained a small color swatch beside each algorithm name for cross-view identity consistency. New `--series-1/2/3` CSS custom properties, validated against this project's actual light/dark surface colors via the `dataviz` skill's palette validator.

## Key Decisions

- Four charts, not the three Unit 07 originally proposed — max wait time added since it's this project's specific worst-case/starvation metric (Unit 05).
- Color slots are keyed to each algorithm's fixed index in the `algorithms` registry, never to its position in a run's (possibly-filtered) `AlgorithmMetrics[]` — the direct fix for the dataviz skill's "recolor-on-filter" anti-pattern, since `selectedAlgorithmIds` means a run can include any subset.
- A `null` metric value renders as "n/a" with no bar; a real `0` still renders as an actual zero-length bar — the same distinction `dashboardTable.ts`'s `formatNumber` already made, extended to a visual form.
- No best-per-metric highlighting on the charts themselves (the table already does this); charts render above the table, no tabs/toggle.
- Continued the project's zero-new-runtime-dependency track: sized DOM elements + CSS custom properties, no canvas, no charting library.

## Deviations from Plan

None in design or scope. Two implementation-level refinements, both documented in `08_charts.md`'s AI Interactions: `algorithmRegistryIndex` was factored out and exported from `algorithmColor.ts` for reuse by `dashboardChartData.ts`'s fixed-row-ordering logic, rather than duplicating the registry lookup; and the chart row layout was changed from the plan's illustrative grid to a stacked flex layout after manual browser testing revealed mid-word label wrapping ("Neares"/"t Car") at narrow widths — a real, found-and-fixed rendering bug, not a scope change.

A genuine gap in the plan's color-assignment scheme was found and precisely documented (not fixed, correctly out of this unit's scope) during plan review, before implementation started: `algorithms`' order comes from `import.meta.glob`'s file-glob key order, not a hand-assigned stable index, so adding a future algorithm whose filename sorts alphabetically before an existing one would silently recolor that existing algorithm too — not just need a new color slot. Documented in both `08_charts.md` and `algorithmColor.ts`'s own header comment for whichever future unit adds a 4th algorithm.

## Files Modified

Created: `src/ui/dashboard/algorithmColor.ts`, `algorithmColor.test.ts`, `dashboardChartData.ts`, `dashboardChartData.test.ts`, `dashboardCharts.ts`, `dev_log/08_charts_test.md`. Modified: `src/style.css` (new `--series-N` custom properties), `src/ui/dashboard/dashboardTable.ts` (color swatch addition, `bestAlgorithmId`/highlight logic untouched), `src/ui/dashboard/dashboardView.ts` (renders charts above table), `dev_log/08_charts.md`.

## Integration Notes

This unit's color-identity mechanism (`algorithmColorVar`) is the natural reuse point for Unit 07's deferred side-by-side-replay feature, should that ever be picked up — a shared color-swatch legend across replay panels would follow the exact same pattern established here.

## Lessons Learned

This unit is the project's first to apply the `dataviz` skill in full, and the skill's own anti-pattern catalog (recolor-on-filter, dual-axis mixing, zero-height-bar-as-missing-data) mapped directly onto real, specific risks in this project's actual data shape (`selectedAlgorithmIds` filtering, four differently-scaled metrics, `number | null` fields) rather than being generic advice — worth remembering that a design-guidance skill's abstract rules are worth checking against the concrete data model early, not just at the visual-polish stage. Separately: the mid-word label-wrapping bug found during manual testing is a reminder that even a plan reviewed as carefully as this one's color/null-handling logic can still ship an illustrative CSS sketch that doesn't survive contact with real content at real viewport widths — exactly why this project's UI units have kept real-browser verification as a hard requirement rather than trusting code review alone.
