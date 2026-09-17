# Project Plan and Dev Log

An interactive tool for exploring elevator dispatch algorithms: configure a building and a call scenario, run it against multiple algorithms, and compare how they perform. Built teaching-first (should be usable by someone other than the author to build intuition about dispatch algorithms) with rigorous benchmarking as a first-class concern, not an afterthought.

Development follows MMDD (see `00_mmdd.md`): small approved units, documented chronologically in this directory.

## Structure

Units and subunits follow the MMDD convention described in `00_mmdd.md`. Anticipated early units (see Planned Units below) roughly track: project scaffolding → simulation engine core → algorithms → call generation → UI/config panel → replay & dashboard → metrics → deploy pipeline. Exact sequencing and splitting into subunits will be decided unit-by-unit as complexity warrants.

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

Unit 01 (scaffolding) complete. Design/requirements phase complete (captured via grilling session, see below). No application logic written yet.

### Completed Features

- Working Vite + TS project shell: dev server, static build (base `/L-vator/`), ESLint + Prettier, Vitest, GitHub Actions Pages deploy pipeline (untested end-to-end — not yet pushed to a remote).
- Headless discrete-event simulation engine (`src/engine/`): event queue, elevator state machine, floor-to-floor movement, capacity/overflow, presence-only hall calls, door-dwell timing, event log, and the `DispatchHook` seam for algorithms to plug into.
- Three dispatch algorithms (`src/algorithms/`): FCFS/naive nearest-car, SCAN/LOOK, nearest-car with directional matching — auto-discovered via `import.meta.glob`, ready for Units 04/05/06 to run and compare.

## Units Implemented

### Completed Units

* **[01](01_scaffolding.md)**: Scaffolding - Vite + TS project setup, ESLint/Prettier, Vitest, GitHub Actions Pages deploy pipeline. See [01_scaffolding_done.md](01_scaffolding_done.md) for completion details.
* **[02](02_engine.md)**: Engine - discrete-event simulation core (event queue, elevator state machine, movement, capacity/overflow, presence-only hall calls, door-dwell formula, event log, dispatch-hook seam). See [02_engine_done.md](02_engine_done.md) for completion details.
* **[03](03_algorithms.md)**: Algorithms - FCFS/naive nearest-car, SCAN/LOOK, nearest-car with directional matching; auto-discovered via `import.meta.glob`. See [03_algorithms_done.md](03_algorithms_done.md) for completion details.

### Units In Progress

None yet.

## Planned Units

* **04**: Call generation — random arrival process (rate, origin/destination pattern, per-floor rate variation) and scripted scenario loading; seeded/reproducible multi-run trial generation shared across algorithms.
* **05**: Metrics — average wait time, average travel time, max wait time, total distance traveled, throughput, average occupancy while moving, empty/deadhead-travel percentage; aggregation across N trial runs.
* **06**: UI — building/fleet/timing config panel (floors, elevators, capacity, floor-travel time, door-dwell base + multiplier, arrival rate, origin/destination pattern, per-floor rate, trial count), run controls, algorithm selection for comparison.
* **07**: Results presentation — animated replay of a selected run (e.g. "Run 7 of 20") plus a dashboard aggregating metrics across all runs and algorithms.

### Future Enhancements (explicitly out of baseline scope)

* Manual/interactive mode — click hall-call buttons and watch a single algorithm respond in real time.
* Destination-dispatch-style algorithms (requires a different call model — bank of buttons per floor — deferred because it changes the call model assumed above).
* UI-authorable scripted scenarios (currently plain data files, not editable via UI).
