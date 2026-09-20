# L-vator

An interactive tool for exploring elevator dispatch algorithms: configure a building and a call scenario, run it against multiple algorithms side by side, and compare how they perform.

**Live demo:** https://toote.github.io/l-vator/

## What it does

Configure a building (floor count, elevator count, capacity), a timing model (floor travel time, door dwell), and a call-generation scenario (seeded random arrivals with several origin/destination patterns, or a hand-authored scripted scenario). Run it as N seeded trials against one or more of twelve dispatch algorithms, then compare results two ways:

- An **animated replay** of any individual trial, showing each elevator's position and live status, plus per-floor/per-direction waiting-passenger counts.
- A **comparison dashboard**: a sortable metrics table (average/max wait, travel time, throughput, occupancy, deadhead %, unserved %) and bar charts, all sharing a stable per-algorithm color identity.

The same seed sequence is reused across every algorithm in a comparison run, so differences in the results reflect the algorithm, not random variance.

### Dispatch algorithms

Each algorithm auto-discovers into the UI with a plain-language description of its real behavior, and most have a "returns to lobby when idle" homing variant:

- **Nearest Car (Directional)** — sends the nearest compatible car, filtering out any car already committed to a conflicting direction.
- **SCAN/LOOK** — elevators sweep in one direction, serving calls along the way, reversing only at the end of their travel.
- **Zoning** / **Zoning (With Fallback)** — floors are partitioned into per-elevator zones (the lobby is shared by all); the strict variant waits for its own zone's car, the fallback variant reaches for any available car once its zone is saturated.
- **ETA-Based** — every available car gets a cost estimate (travel time plus dwell for intermediate stops, with a turnaround penalty for a wrong-direction car); the lowest-cost car wins.
- **Random** — a deliberately dumb baseline, picking uniformly among available cars via a deterministic, seed-reproducible choice (not `Math.random()`, so it stays fair across a seeded batch).

## Getting started

Requires Node (version pinned in `.nvmrc`).

```bash
npm install
npm run dev       # start the dev server
npm run test      # run the test suite
npm run build     # type-check and produce a static build
npm run lint       # eslint
npm run format     # prettier --write
```

Pushing to `main` builds and deploys to GitHub Pages automatically (see `.github/workflows/deploy.yml`).

## Architecture

- **Simulation engine** (`src/engine/`) — a headless, discrete-event simulation, decoupled from the UI. The atomic event is floor-to-floor movement, so algorithms can redirect an elevator mid-route.
- **Call model** — two-stage/realistic: a hall call reveals only floor + direction, never a passenger count or destination; the destination is only known once a passenger actually boards. Partial boarding when an elevator runs out of capacity is expected, measured behavior, not a bug.
- **Algorithms** (`src/algorithms/`) — each lives in its own self-contained file implementing a common `Algorithm`/`DispatchHook` interface, auto-discovered via `import.meta.glob`. No shared base class between algorithms, by design — each stays independently readable.
- **Call generation** (`src/generation/`) — seeded random arrivals (multiple origin/destination patterns) and scripted scenarios, run through a fairness-guaranteed trial batch/runner shared by every algorithm in a comparison.
- **Metrics** (`src/metrics/`) — pooled correctly across N seeded trials per algorithm.
- **UI** (`src/ui/`) — vanilla TypeScript against the DOM, no framework.

Built with Vite + TypeScript, tested with Vitest, linted with ESLint + Prettier.

## Development process

This project was built using MMDD (micromanaged-driven development): small, explicitly approved units of work, each documented as it's built. The full plan and unit-by-unit history live in [`dev_log/`](dev_log/), starting from [`dev_log/00_main.md`](dev_log/00_main.md).

## License

[GNU Affero General Public License v3.0](LICENSE) — see the `LICENSE` file for the full text.
