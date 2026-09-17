# Project Plan and Dev Log

An interactive tool for exploring elevator dispatch algorithms: configure a building and a call scenario, run it against multiple algorithms, and compare how they perform. Built teaching-first (should be usable by someone other than the author to build intuition about dispatch algorithms) with rigorous benchmarking as a first-class concern, not an afterthought.

Development follows MMDD (see `00_mmdd.md`): small approved units, documented chronologically in this directory.

## Structure

Units and subunits follow the MMDD convention described in `00_mmdd.md`. The seven units actually built, in order: scaffolding → simulation engine core → algorithms → call generation → metrics → UI/config panel → replay & dashboard (see Units Implemented below for links to each unit's plan and completion record).

## About the Project

### What This Is

A single-page, static web app (deployed to GitHub Pages) where a user configures a building, an elevator fleet, and a call-generation scenario, then runs the scenario as N seeded trials against one or more dispatch algorithms. Results are shown two ways: an animated replay of a selected individual run, and a dashboard aggregating metrics across all runs for comparison.

The initial interaction mode is **configured batch simulation** (set parameters, run, inspect results). A **manual mode** — clicking hall-call buttons and watching a single algorithm respond live — is an explicit planned future enhancement, not part of the baseline build.

### Architecture

- **Simulation engine**: discrete-event, decoupled from the UI (plain TS module, importable headlessly by tests or any future non-browser consumer). The atomic event is *floor-to-floor movement* — an elevator's decision function is re-invoked whenever it arrives at any floor or a new call occurs, whichever is sooner. This lets algorithms redirect an elevator mid-route (required for LOOK/SCAN to stop at intermediate floors) and correctly interleaves new passenger-arrival events with in-flight elevator movement.
- **Call model**: two-stage/realistic. A hall call reveals only floor + direction (up/down) — **presence only, no passenger count**. The destination is unknown to the dispatcher until the passenger boards and presses a car button. Because hall calls don't carry a count, an elevator can decide to stop with some free capacity and still find more people waiting than it can take — partial boarding / leaving passengers behind is expected, realistic behavior, not an engine defect. It's measured, not prevented.
- **Algorithms**: each dispatch algorithm lives in its own file/module, implementing a common interface, so new algorithms can be added without touching existing ones.
- **Fairness/reproducibility**: a batch comparison run is N seeded trials (N is a user-adjustable fixed count, not adaptive-stopping). The same seed sequence is reused across every algorithm under comparison, so metric differences reflect the algorithm, not random variance. Each trial's event log is recorded to support replay.
- **Call generation**: random arrivals and/or hand-authored scripted scenarios (stored as plain data files in-repo, not UI-authorable yet). Random generation is configurable by: arrival rate, origin/destination pattern (fixed-from-floor-0 / fixed-to-floor-0 / random), and whether the rate is uniform across floors or custom per floor.
- **Timing model**: floor-travel time and door dwell time are both UI-configurable. Door dwell time = a configurable base (enough for one passenger to board or alight) plus a configurable per-additional-passenger multiplier (default 50%), applied to the **combined total** of everyone boarding + alighting at that stop (no separate alight/board phases).
- **Capacity**: elevator capacity is UI-configurable, alongside floor count and elevator count.

### Technical Stack

- Vanilla TypeScript + Vite (no UI framework) — the app is thin; the simulation engine is the substantive part and should stay framework-independent.
- Vitest for unit tests.
- ESLint + Prettier for lint/format.
- GitHub Actions workflow: build and deploy to GitHub Pages on push to main.

## Project Status

### Overall Completion

**All seven originally planned units, plus Unit 08 (dashboard charts) and Unit 09 (waiting-passenger counts), are complete.** The baseline scope described in "What This Is" above is fully implemented: configure a building/fleet/scenario, run N seeded trials against one or more dispatch algorithms, and see results as both an animated replay (now showing live per-floor, per-direction waiting counts) and a comparison dashboard with charts. No units remain planned; only the Future Enhancements below are out of scope.

### Completed Features

- Working Vite + TS project shell: dev server, static build (base `/L-vator/`), ESLint + Prettier, Vitest, GitHub Actions Pages deploy pipeline (untested end-to-end — not yet pushed to a remote).
- Headless discrete-event simulation engine (`src/engine/`): event queue, elevator state machine, floor-to-floor movement, capacity/overflow, presence-only hall calls, door-dwell timing, event log, and the `DispatchHook` seam for algorithms to plug into.
- Three dispatch algorithms (`src/algorithms/`): FCFS/naive nearest-car, SCAN/LOOK, nearest-car with directional matching — auto-discovered via `import.meta.glob`, including overflow-handoff logic so a second elevator can help when one can't keep up with demand alone.
- Call generation (`src/generation/`, `src/scenarios/`): seeded random arrivals (up-peak/down-peak/random patterns), scripted scenarios, and the fairness-guaranteed trial batch/runner every algorithm comparison runs through.
- Metrics (`src/metrics/`): eight headline metrics per algorithm (wait/travel time, max wait, distance, throughput, occupancy, deadhead %, unserved count/%), pooled correctly across N seeded trials.
- UI (`src/ui/`): config panel (building/fleet/timing/arrival, random or scripted scenarios), algorithm selection, run controls, an animated single-panel replay of any selected trial (with live per-floor, per-direction waiting-passenger counts on each hall indicator), and a comparison dashboard with a sortable/highlighted table plus four bar charts (average wait, max wait, throughput, unserved%) sharing a stable per-algorithm color identity.

## Units Implemented

### Completed Units

* **[01](01_scaffolding.md)**: Scaffolding - Vite + TS project setup, ESLint/Prettier, Vitest, GitHub Actions Pages deploy pipeline. See [01_scaffolding_done.md](01_scaffolding_done.md) for completion details.
* **[02](02_engine.md)**: Engine - discrete-event simulation core (event queue, elevator state machine, movement, capacity/overflow, presence-only hall calls, door-dwell formula, event log, dispatch-hook seam). See [02_engine_done.md](02_engine_done.md) for completion details.
* **[03](03_algorithms.md)**: Algorithms - FCFS/naive nearest-car, SCAN/LOOK, nearest-car with directional matching; auto-discovered via `import.meta.glob`. See [03_algorithms_done.md](03_algorithms_done.md) for completion details.
* **[04](04_generation.md)**: Generation - seeded random arrival generation, scripted scenarios, fairness-guaranteed trial batch/runner. See [04_generation_done.md](04_generation_done.md) for completion details.
* **[05](05_metrics.md)**: Metrics - eight headline metrics per algorithm, pooled correctly across N seeded trials. See [05_metrics_done.md](05_metrics_done.md) for completion details.
* **[06](06_ui.md)**: UI - config panel, algorithm selection, run controls, plain results table. See [06_ui_done.md](06_ui_done.md) for completion details.
* **[07](07_results.md)**: Results presentation - animated single-panel replay with corrected event-log interpolation, sortable/highlighted comparison dashboard. See [07_results_done.md](07_results_done.md) for completion details.
* **[08](08_charts.md)**: Dashboard charts - four small-multiple bar charts with stable per-algorithm color identity, per the `dataviz` skill. See [08_charts_done.md](08_charts_done.md) for completion details.
* **[09](09_waiting_counts.md)**: Waiting-passenger counts - live per-floor, per-direction waiting-passenger counts on the replay's hall indicators. See [09_waiting_counts_done.md](09_waiting_counts_done.md) for completion details.

### Units In Progress

None.

## Planned Units

None.

### Future Enhancements (explicitly out of baseline scope)

* Manual/interactive mode — click hall-call buttons and watch a single algorithm respond in real time.
* Destination-dispatch-style algorithms (requires a different call model — bank of buttons per floor — deferred because it changes the call model assumed above).
* UI-authorable scripted scenarios (currently plain data files, not editable via UI).
* Side-by-side multi-algorithm replay of the same trial (deferred from Unit 07 — correctness-free per the fairness guarantee, but not built).
* A stable, hand-maintained algorithm→color-slot mapping (Unit 08's color identity currently derives from `import.meta.glob`'s file order, which can shift an existing algorithm's color if a new algorithm file sorts earlier alphabetically — see `08_charts.md`/`algorithmColor.ts` for the full note; only matters once a 4th algorithm is added).
