# Unit 09: Waiting-passenger counts in the replay

## Objective

Extend Unit 07's replay cross-section (`src/ui/replay/`) so each floor row's per-direction
hall-call indicator shows *how many* passengers are currently waiting there at the replay's
current simulated time, not just whether at least one is (the existing "active/inactive" glyph).
Per `00_main.md`'s Planned Units entry: "show, per floor (and direction), how many passengers are
currently waiting at any given point in the replay's simulated time, not just whether a hall call
is active there." Builds on Unit 07's replay (this unit changes nothing about playback mechanics,
interpolation, or the dashboard) and reuses Unit 05's batch-regeneration technique for recovering
per-passenger data the event log alone cannot provide — this unit's core problem is the same
category of data-availability gap Unit 05 already solved, applied per `(floor, direction)` instead
of per algorithm-wide passenger classification.

## Implementation

### The core data-availability gap, confirmed against the actual source

`SimEventLogEntry` (`src/engine/types.ts`) is a seven-variant union: `hallCallRegistered`,
`elevatorArrived`, `doorsOpened`, `passengerBoarded`, `passengerAlighted`, `doorsClosed`,
`hallCallCleared`. None carries a live waiting-count. Confirmed directly in
`simulation.ts`'s `handlePassengerArrival`:

```ts
function handlePassengerArrival(arrival: ScriptedInput[number], time: number): void {
  const wasActive = hasWaitingCallAt(state.waitingPassengers, arrival.originFloor, arrival.direction);
  const passenger: Passenger = { id: arrival.id, ... };
  state.waitingPassengers.push(passenger);
  if (!wasActive) {
    log.push({ type: 'hallCallRegistered', time, floor: arrival.originFloor, direction: arrival.direction });
    applyDecision(new Set(idleElevatorIds()), time);
  }
}
```

`hallCallRegistered` fires **only** on the inactive → active transition for a `(floor,
direction)` pair. A second (or third, ...) passenger arriving while that call is already active
pushes a `Passenger` into `state.waitingPassengers` but produces **no** log entry — exactly the
same silent-arrival gap Unit 05 already documented and solved for per-passenger arrival *time*
(`05_metrics.md`, "Per-passenger arrival time: a real gap..."; also independently confirmed in
`04_generation_done.md`'s fairness-test note about `hallCallRegistered` not being a reliable
"same arrival facts" signal). So the log alone can answer "is anyone waiting at floor F, direction
D, at time T" (Unit 07's existing indicator, correctly built from `hallCallRegistered`/
`hallCallCleared`) but cannot answer "**how many**" — that count is silently lost for every
arrival after the first at an already-active call.

**Resolution: the same technique Unit 05 already proved out, not a new mechanism.**
`generateTrialBatch(scenario)` (`src/generation/trialBatch.ts`) is deterministic and pure
(Unit 04's `trialBatch.test.ts`), so regenerating it for the trial currently being replayed
reproduces the exact `ScriptedInput` (`PassengerArrival[]`) originally fed to the engine for that
trial — full per-passenger identity (`id`, `originFloor`, `direction`, `arrivalTime`), matched to
the log via `PassengerArrival.id === passengerBoarded.passengerId` (same string, by construction —
`handlePassengerArrival` sets `passenger.id = arrival.id`).

**Counting rule** — a passenger is "waiting" at time T iff:

```
arrival.arrivalTime <= T   AND   no passengerBoarded log entry for arrival.id at or before T
```

This is deliberately *not* the `served` / `boardedOnly` / `neverBoarded` classification from
`passengerRecords.ts` — waiting-or-not only cares about the boarding transition, not alighting, so
it's simpler than Unit 05's three-way status. It naturally and correctly handles a passenger who
never boards at all: they satisfy the rule for every `T >= arrivalTime` through the end of the
trial, so they're counted as waiting indefinitely — consistent in spirit with Unit 05's
`neverBoarded`/censored treatment, though no censoring arithmetic is needed here since this is a
live count at a specific T, not a summary wait-time statistic.

### Direction-aware, not floor-aggregated — resolved by developer: per direction

**Resolved: per `(floor, direction)`, matching the existing hall-call indicator's own grain
exactly.** This isn't cosmetic — the engine itself treats `(floor, direction)` as the unit of queue
identity throughout: `hasWaitingCallAt`, the boarding-candidate filter in `handleStop`
(`servicedDirections`), and `getActiveHallCalls`'s dedup key are all keyed on the pair, never on
floor alone. Two passengers waiting at the same floor for opposite directions are served by
different stops, board under different conditions, and are already shown as two independent
glyphs (`▲`/`▼`) in `replayCrossSection.ts`. Combining them into one number would conflate two
genuinely independent queues and wouldn't line up with the indicator it's meant to annotate.

### Where the `Scenario` needed for `generateTrialBatch` comes from

**Confirmed by reading the current source directly: `RunState['done']` does NOT retain the
`Scenario`.** `src/ui/types.ts`'s current shape:

```ts
| {
    status: 'done';
    metrics: AlgorithmMetrics[];
    trialResults: TrialRunResult[];
    building: BuildingConfig;   // only the building, not the full Scenario
  }
```

`runControls.ts`'s run handler computes `scenario = buildScenario(state.config)` locally, passes
it to `runTrialBatch(scenario, selectedAlgorithms)` and `computeMetrics(trialResults, scenario)`,
then stores only `building: { ...scenario.building }` into `state.run`. The `scenario` local
(the full `RandomScenario`/`ScriptedScenario` — `arrivals`, `durationMs`, `seed`, or `script`) goes
out of scope and is discarded once the `setTimeout` callback returns. Worth noting for completeness
that `runTrialBatch` itself already calls `generateTrialBatch(scenario)` internally
(`trialRunner.ts`) but doesn't return or expose that batch either — nothing downstream of a
completed run currently has access to either the `Scenario` or the batch it produced.

This is exactly the same "gap Unit 06 correctly didn't need to close but a later unit does"
pattern Unit 07 hit for `trialResults`/`building`. **Recommendation: extend `RunState['done']`
additively**, mirroring Unit 07's own precedent:

```ts
// src/ui/types.ts
import type { Scenario } from '../generation'; // new import

export type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | {
      status: 'done';
      metrics: AlgorithmMetrics[];
      trialResults: TrialRunResult[];
      building: BuildingConfig;
      scenario: Scenario; // NEW — the exact Scenario this run used; needed to re-derive
                           // per-passenger arrival data via generateTrialBatch for the replay's
                           // waiting-count computation (see 09_waiting_counts.md).
    }
  | { status: 'error'; message: string };
```

`runControls.ts`'s change is one line, in the same object literal that already snapshots
`building`:

```ts
state.run = { status: 'done', metrics, trialResults, building: { ...scenario.building }, scenario };
```

`scenario` itself needs no defensive copy beyond what already happens: `buildScenario` returns a
freshly constructed object each call (random mode spreads `{...draft.building}` and builds a new
`arrivals` object; scripted mode returns `{...draft.scriptedScenario, trialCount}}`, a fresh
top-level object). It is not a live reference into the mutable `ConfigDraft` the user keeps
editing — the same property Unit 07 required of `building` and confirmed by the same reasoning.

**Alternative considered and rejected, for the same reason Unit 05 rejected its analogous
alternative:** storing the already-generated `ScriptedInput[]` batch instead of `Scenario` (e.g.
by widening `runTrialBatch`'s return shape to also expose the batch it computes internally) would
save one redundant `generateTrialBatch` call, but requires touching `generation/trialRunner.ts`'s
public signature — a cross-unit change this project's units have consistently avoided when a
same-layer alternative exists. Storing `Scenario` and calling `generateTrialBatch(scenario)` again
(cheap, pure, no I/O — the same cost Unit 05's `computeMetrics` already pays once per `Scenario`)
keeps this unit entirely inside `src/ui/`, touching no other layer.

### Architecture: a sibling module mirroring `replayFrame.ts`'s exact shape

**Recommendation: a new file, `src/ui/replay/waitingCounts.ts`**, rather than extending
`replayFrame.ts` itself. Reasoning: `replayFrame.ts`'s existing functions
(`groupReplayLog`/`computeReplayFrame`) depend on nothing but a trial's `log` — that's what makes
them cleanly testable and already covered by `replayFrame.test.ts`. Waiting counts need one
additional input replayFrame.ts's functions don't (`ScriptedInput`, the regenerated arrivals for
this trial), and there's no need to widen an already-tested, already-correct module's dependencies
or its `ReplayFrame`/`GroupedLog` public shapes just to fold in a second, independently-sourced
computation. A sibling module keeps the blast radius additive-only, exactly as Unit 07 kept its
own extensions additive to Unit 06.

`waitingCounts.ts` reuses `replayFrame.ts`'s exported `countAtOrBefore` binary-search primitive
directly (imported, not duplicated) — same pattern, same guarantee (sorted-ascending array, count
of entries with `time <= t`).

```ts
// src/ui/replay/waitingCounts.ts

import type { Direction, FloorIndex, ScriptedInput, SimEventLogEntry } from '../../engine';
import { countAtOrBefore } from './replayFrame';

interface Timed {
  time: number;
}

export interface WaitingCountGroup {
  floor: FloorIndex;
  direction: Direction;
  /** Every arrival's arrivalTime for this (floor, direction) pair, ascending. */
  arrivals: Timed[];
  /** Same passengers' passengerBoarded times, ascending — only entries for passengers who
   * eventually board at all (a never-boarding passenger has no entry here, by construction). */
  boarded: Timed[];
}

export interface GroupedWaitingCounts {
  /** One entry per (floor, direction) pair with at least one arrival in this trial. A pair
   * with zero arrivals simply has no entry — callers default absent keys to a count of 0,
   * mirroring replayCrossSection.ts's existing activeHallCalls-lookup pattern. */
  groups: WaitingCountGroup[];
}

export interface WaitingCountFrame {
  floor: FloorIndex;
  direction: Direction;
  count: number;
}

function key(floor: FloorIndex, direction: Direction): string {
  return `${floor}:${direction}`;
}

/**
 * Groups one trial's regenerated arrivals (ScriptedInput for the selected trialIndex — see
 * "Where the Scenario needed for generateTrialBatch comes from") by (floor, direction), once,
 * ahead of any per-frame lookups — same "group once per selection change" shape as
 * replayFrame.ts's groupReplayLog.
 *
 * UNLIKE groupReplayLog: `arrivals` is authoring-order ScriptedInput, not the simulation's own
 * time-ordered log — nothing guarantees it (or the matched passengerBoarded entries pulled from
 * `log`) is already sorted by time within a (floor, direction) bucket. Each group's `arrivals`/
 * `boarded` arrays are explicitly sorted ascending by time here, which groupReplayLog does not
 * need to do (its source log is already globally time-ordered by construction).
 */
export function groupWaitingCounts(
  arrivals: ScriptedInput,
  log: readonly SimEventLogEntry[],
): GroupedWaitingCounts {
  const boardedAt = new Map<string, number>();
  for (const entry of log) {
    if (entry.type === 'passengerBoarded') boardedAt.set(entry.passengerId, entry.time);
  }

  const groupMap = new Map<string, WaitingCountGroup>();
  for (const arrival of arrivals) {
    const k = key(arrival.originFloor, arrival.direction);
    let group = groupMap.get(k);
    if (!group) {
      group = { floor: arrival.originFloor, direction: arrival.direction, arrivals: [], boarded: [] };
      groupMap.set(k, group);
    }
    group.arrivals.push({ time: arrival.arrivalTime });
    const boardedTime = boardedAt.get(arrival.id);
    if (boardedTime !== undefined) group.boarded.push({ time: boardedTime });
  }

  const groups = Array.from(groupMap.values());
  for (const group of groups) {
    group.arrivals.sort((a, b) => a.time - b.time);
    group.boarded.sort((a, b) => a.time - b.time);
  }
  return { groups };
}

/** count(floor, direction, T) = arrivals with arrivalTime <= T, minus those already boarded by T.
 * Same binary-search shape as replayFrame.ts's hallCallActiveAtTime, counting instead of
 * booleans. */
export function computeWaitingCounts(grouped: GroupedWaitingCounts, time: number): WaitingCountFrame[] {
  return grouped.groups.map((group) => ({
    floor: group.floor,
    direction: group.direction,
    count: countAtOrBefore(group.arrivals, time) - countAtOrBefore(group.boarded, time),
  }));
}
```

**Wiring** (mirrors exactly how `groupReplayLog`/`computeReplayFrame` are wired today):

- `replayView.ts` — once per trial/algorithm selection (the same point `groupReplayLog` is
  already called): `const batch = generateTrialBatch(run.scenario); const arrivals =
  batch[replay.trialIndex]; const groupedWaitingCounts = groupWaitingCounts(arrivals,
  trialResult.result.log);` — matched strictly to `replay.trialIndex`, the same
  trial-index-scoping precision Unit 05's `computeMetrics.ts` established as load-bearing (see
  "What gets tested" below). `groupedWaitingCounts` is passed into `renderReplayControls` as a new
  option, alongside the existing `groupedLog`.
- `replayControls.ts`'s `frameLoop` — once per frame, alongside the existing
  `computeReplayFrame(groupedLog, replay.simTimeMs)` call: `computeWaitingCounts(groupedWaitingCounts,
  replay.simTimeMs)`. Both results are passed to `crossSection.update(frame, waitingCounts)` — the
  `CrossSectionHandle.update` signature widens from `(frame: ReplayFrame) => void` to `(frame:
  ReplayFrame, waitingCounts: WaitingCountFrame[]) => void`, an additive parameter, not a
  restructuring of the existing frame shape.

**Performance note, flagged rather than silently accepted:** `generateTrialBatch` regenerates
*every* trial in the batch, not just the one selected for replay — the same cost
`computeMetrics.ts` already accepts (it calls `generateTrialBatch(scenario)` exactly once per
`Scenario`, never once per trial). At this project's established scale (moderate arrival rates,
runs on the order of minutes, per `00_main.md`) this is cheap, pure array/RNG computation with no
I/O, and it only re-runs on a *structural* selection change (switching trial or algorithm), not
per frame — well inside the "toy project, not over-engineered" tolerance this project has applied
consistently since Unit 07's own performance section. Not treated as an open question; noted so
it isn't rediscovered as a surprise later.

### Visual representation

The `dataviz` skill was loaded and checked against this specific case. Its form-selection guidance
(`choosing-a-form.md`) directly classifies "a single current value" as a **stat tile**, not a
chart — which is exactly what a waiting-count badge is: one number, attached to an existing
indicator, not a new mark type or a new chart. Most of the skill's machinery (mark specs, the
categorical color formula, the six-check palette validator, legends) is built for actual charts
with data-driven series and doesn't apply here — there is no "series" in a waiting-count badge, no
identity to color-encode (this is per-floor/per-direction data, unrelated to Unit 08's
per-algorithm color identity, which stays untouched by this unit). Two things from the skill *do*
apply directly and shape the concrete design below:

- **"Text wears text tokens, never the series color"** — the count number should render in
  `var(--text)`, exactly like the existing `▲`/`▼` glyphs already do (no `color` override, no new
  custom property). There is nothing here that plays the role of "series" needing a distinguishing
  hue.
- **Status colors are reserved for actual state semantics and ship with icon + label, never color
  alone** — this directly informs (and constrains) the "large counts" treatment immediately below:
  a severity color is available in principle but the skill explicitly discourages reaching for one
  casually, which supports keeping the large-count treatment to a single, simple, non-color cue.

**Concrete placement:** extend the existing `up`/`down` indicator spans in
`replayCrossSection.ts` (currently static `▲`/`▼` textContent, toggled only via the `.active`
class) so `update()` also sets their text to include the count when non-zero:

```ts
function labelFor(direction: Direction, count: number): string {
  const glyph = direction === 'up' ? '▲' : '▼';
  return count > 0 ? `${glyph} ${count}` : glyph;
}
```

At `count === 0`, the glyph renders bare (no `0` badge) — the existing dimmed/inactive opacity
styling (`.replay-hall-indicator` vs. `.active`) already communicates "nothing here"; a literal
`▲ 0` next to an already-dimmed glyph would be redundant clutter, not new information. The
existing per-indicator `title` attribute (already used for `"Floor {floor}, up"`) extends to
include the count, e.g. `"Floor 4, up — 3 waiting"`, reusing the tooltip mechanism already in
place rather than introducing a new one.

### What happens at large counts

Recommendation, deliberately simple per the task's own framing (a concrete rule, not a general
severity system): render the literal number at any size — no truncation, no `"40+"` formatting is
needed at this project's scale (a toy project; even the catastrophic-overload scenario this
project's own history demonstrates — `00_main.md`'s Completed Features / Unit 02–03 amendment
history — tops out in the tens of passengers, not thousands). The one addition: when a
`(floor, direction)` count exceeds `building.capacity` (already available to
`replayCrossSection.ts`, which is passed `building: BuildingConfig`) — a real, non-arbitrary
threshold, since it means at least one full elevator load won't clear the queue — apply
`font-weight: bold` to that badge's text, still in `--text` (no new color, per the dataviz skill
note above). A single boolean condition, one CSS class toggle (e.g. `.replay-hall-indicator.overloaded`),
not a multi-tier severity scale.

### What gets tested

Consistent with every prior unit's Vitest-for-pure-logic / manual-browser-verification-for-DOM
split:

**Vitest, exact hand-computed fixtures (mirroring `replayFrame.test.ts`'s and
`passengerRecords.test.ts`'s style):**
- `groupWaitingCounts`/`computeWaitingCounts`: a hand-built `arrivals` array + hand-built log.
  - **Direction-aware**: two passengers at the same floor, opposite directions — assert two
    independent counts, not one combined number.
  - **Never-boarded passenger**: counted as waiting for every `T >= arrivalTime` through the end of
    the trial (no upper bound/censoring arithmetic — just confirm the count never drops).
  - **Boarding transition, exact-timestamp edge case**: assert the count decrements exactly at a
    boarding passenger's `passengerBoarded` timestamp (still counted at `T` just before it,
    excluded at `T ===` the boarding time) — mirrors `replayFrame.test.ts`'s established precedent
    of explicitly testing "T exactly on an event timestamp" rather than only interior values.
  - **All-zero / absent group**: a `(floor, direction)` pair with zero arrivals in the whole trial
    is absent from `GroupedWaitingCounts.groups` entirely; a consuming test (or the DOM layer)
    defaults absent keys to a count of 0 — same convention `replayCrossSection.ts` already uses for
    `activeHallCalls`.
  - **Unsorted-input regression**: an `arrivals` array deliberately NOT in time order (unlike
    `groupReplayLog`'s log input, `ScriptedInput`'s authoring order is not guaranteed
    chronological) — assert `groupWaitingCounts` still produces correctly time-sorted groups and
    therefore correct binary-search results, not just "happens to look right" on already-sorted
    fixtures.
  - **Trial-index-scoping regression**, mirroring `computeMetrics.test.ts`'s dedicated regression
    test from Unit 05 exactly: a real `RandomScenario` with confirmed colliding ids (e.g.
    `"arrival-0"`) across different trial indices — assert that waiting counts computed for trial
    K using trial K's own regenerated arrivals differ from (and are correct, unlike) counts
    computed by accidentally using a different trial index's arrivals. This is the single sharpest
    correctness risk in this unit's design, per Unit 05's own precedent, and gets the same
    dedicated regression coverage.
- Large-count threshold logic (`count > building.capacity`) as a small pure predicate, if extracted
  as one (see Open Questions) — trivial boundary cases (`count === capacity`, `count === capacity + 1`).

**Manual/browser verification (no jsdom, per Units 06/07's precedent):**
- Badge legibility and placement in the cross-section at a few building sizes, in both light and
  dark mode.
- The bold/large-count treatment actually renders distinctly and isn't mistaken for a different UI
  element (per the dataviz skill's "look at it" step).
- Tooltip text correctness on hover.
- End-to-end: run the default up-peak scenario against an algorithm known (per this project's own
  history) to struggle under load, confirm the badge visibly climbs as passengers accumulate and
  visibly drops as an elevator picks people up — a live check against the exact "40 people piled up
  at one floor" scenario `00_main.md`'s own history describes.

### Scope check against `00_main.md`'s Future Enhancements

None of the three remaining Future Enhancements (manual/interactive mode, destination-dispatch
algorithms, UI-authorable scripted scenarios) are touched — this unit is purely an additive
replay-display change consuming data already produced by existing layers, the same scope shape as
Unit 07 itself.

## Open questions for developer sign-off

1. ~~**Per-floor combined count vs. per-direction counts**~~ — **Resolved by developer: per
   `(floor, direction)`**, as recommended.
2. ~~**Zero-count display**~~ — **Accepted as proposed (no objection raised):** bare glyph, no
   number shown when the count is 0.
3. ~~**Large-count threshold**~~ — **Accepted as proposed:** `count > building.capacity`.
4. **New file (`waitingCounts.ts`) vs. extending `replayFrame.ts` directly.** **Recommendation:
   new sibling file** — keeps `replayFrame.ts`'s existing, already-tested pure log-only functions
   and public shapes (`ReplayFrame`, `GroupedLog`) untouched; the new computation has a genuinely
   different dependency (regenerated `ScriptedInput`, not just the log) that doesn't belong folded
   into an already-shipped, already-tested module.
5. ~~**`RunState['done']` gains a `scenario: Scenario` field vs. storing the pre-generated
   `ScriptedInput[]` batch instead**~~ — **Accepted as proposed:** store `Scenario`, keeping the
   change entirely inside `src/ui/`.

## AI Interactions

Implemented per the approved plan, including `groupWaitingCounts`/`computeWaitingCounts`
implemented verbatim from the plan's "Architecture" code block (imports `countAtOrBefore` from
`replayFrame.ts` rather than duplicating it, per the plan's explicit instruction). `RunState['done']`
gained exactly the one field the plan specified (`scenario: Scenario`), and `runControls.ts`'s
object literal gained exactly the one line the plan specified. Wiring in `replayView.ts` /
`replayControls.ts` / `replayCrossSection.ts` follows the plan's "Wiring" subsection: `replayView.ts`
calls `generateTrialBatch(run.scenario)` once per trial/algorithm selection (same point
`groupReplayLog` is already called) and indexes `batch[replay.trialIndex]` — matched strictly to
the trial currently selected for replay, never `run.trialResults`' own array position — before
calling `groupWaitingCounts`. `replayControls.ts`'s frame loop calls `computeWaitingCounts`
alongside (not instead of) `computeReplayFrame` every frame and passes both to
`crossSection.update(frame, waitingCounts)`, an additive widening of `CrossSectionHandle.update`'s
signature. `replayCrossSection.ts`'s `labelFor` helper and the extended `title` tooltip are
implemented exactly as specified (bare glyph at count 0, `"Floor N, direction — K waiting"`
otherwise).

**One deviation from the plan's literal CSS, found and fixed via real browser testing (see
`09_waiting_counts_test.md`, Manual Test 2 for full detail):** the plan's `.overloaded` rule
(`font-weight: bold`) was, as specified, added alongside Unit 07's pre-existing
`.replay-hall-indicator.active` rule — which *also* already set `font-weight: bold`. Real browser
measurement (`getComputedStyle`) during manual verification showed this made the overloaded
treatment invisible in practice: the moment any passenger is waiting, the hall call goes active
almost immediately, so the badge was already bold long before the count actually exceeded
capacity — directly contradicting the plan's own success condition ("the bold/large-count
treatment actually renders distinctly and isn't mistaken for a different UI element", from "What
gets tested"). This was not something code review would have caught — both rules read correctly in
isolation; only measuring the actual computed style across the active/overloaded boundary revealed
the collision. **Fix:** removed `font-weight: bold` from `.replay-hall-indicator.active` (its
`opacity: 1` alone still fully conveys active vs. inactive, unchanged from Unit 07's original
dim/full-opacity distinction) so `.overloaded` is now the only rule that bolds a badge. Re-verified
afterward that all three states (inactive: dim + normal weight; active-under-capacity: full opacity
+ normal weight; overloaded: full opacity + bold) are programmatically and visually distinct in
both light and dark mode. This is a one-line CSS change to a pre-existing Unit 07 rule inside
`replayCrossSection.ts` — a file this unit's plan explicitly extends — not a change to this unit's
own new code or to any other unit's file.

No other deviations. The `dataviz`-skill-informed constraints (text in `var(--text)`, no new color,
a single boolean condition rather than a severity scale) were followed as specified; the fix above
is a same-token, same-mechanism correction (still `font-weight: bold`, still no color), not a
departure from them.

Real browser verification (Playwright driving actual installed Chrome, `claude-in-chrome`
unavailable this session — its mandated `AskUserQuestion` browser-selection step is not available
here, consistent with Units 06-08's precedent) was performed in dev, in a production
build/preview, and in both light and dark mode, under the default up-peak scenario against an
algorithm known (per this project's own history) to struggle under load — see
`dev_log/09_waiting_counts_test.md` for full detail, including the climb/drop badge progression
table and the active-vs-overloaded state table that caught the bug above. No new runtime dependency
was added (confirmed via `git diff --stat package.json package-lock.json` showing no diff, after
reverting an unrelated, pre-existing `package-lock.json` "name" field drift — `"vite-scaffold"` ->
`"elevator"` — that running `npm run lint`/`test`/`build` triggered npm to auto-heal, nothing to do
with the scratch Playwright install); no stray scratch files or processes were left behind.

## Files Modified

Created: `src/ui/replay/waitingCounts.ts`, `src/ui/replay/waitingCounts.test.ts`,
`dev_log/09_waiting_counts_test.md`.

Modified: `src/ui/types.ts` (`RunState['done']` gains `scenario: Scenario`), `src/ui/runControls.ts`
(one line: `state.run`'s object literal now also stores `scenario`), `src/ui/replay/replayView.ts`
(regenerates the trial batch and groups waiting counts once per trial/algorithm selection, passes
`groupedWaitingCounts` into `renderReplayControls`), `src/ui/replay/replayControls.ts`
(`ReplayControlsOptions` gains `groupedWaitingCounts`; the frame loop computes and passes waiting
counts alongside the replay frame every frame), `src/ui/replay/replayCrossSection.ts`
(`CrossSectionHandle.update` widened to accept `WaitingCountFrame[]`; hall indicators now render a
count badge via `labelFor`, an extended tooltip, and an `.overloaded` bold treatment; the
pre-existing `.active` rule's redundant `font-weight: bold` was removed — see "AI Interactions"
deviation note above), `dev_log/09_waiting_counts.md` (this file).

No files under `src/engine/`, `src/algorithms/`, or `src/generation/` were touched, and no Unit
01-08 file was touched beyond `src/ui/types.ts`, `src/ui/runControls.ts`, and the `src/ui/replay/*`
files this unit's plan explicitly extends — per this unit's stated scope. `src/ui/state.ts` did not
need a change (`initialState()` only ever constructs `run: { status: 'idle' }`, which doesn't
include the new `scenario` field).

## Status: Implemented — awaiting developer validation
