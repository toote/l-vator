# Unit 05: Metrics

## Objective

Deliver the metrics-computation layer named in `00_main.md`'s Planned Units list: the seven agreed passenger-experience/utilization metrics — average wait time, average travel time, max wait time, total elevator distance traveled, throughput, average occupancy while moving, and empty/deadhead-travel percentage — plus an eighth metric (unserved passenger count/percentage) added during this unit's plan review, promoted from supporting detail to a first-class number. All eight are computed per algorithm and aggregated across all N seeded trials in a batch, so a comparison across algorithms is fair and direct (per `00_main.md`'s fairness/reproducibility requirement, already guaranteed at the data-generation level by Unit 04).

This unit consumes exactly what Unit 04's `runTrialBatch` produces (`TrialRunResult[]`, `{algorithmId, trialIndex, result: RunSimulationResult}`, where `RunSimulationResult = {finalState: BuildingState, log: SimEventLogEntry[]}`) plus the `Scenario` that produced it. It is pure computation over already-produced simulation results: no engine changes, no algorithm changes, no UI (Unit 06), no replay (Unit 07) — though Unit 07's replay view and Unit 06's comparison dashboard are this unit's direct downstream consumers, and the API surface below is shaped with both in mind.

**A real data-availability gap was found while planning this unit** (see "Per-passenger arrival time: a real gap, and how this unit closes it without touching other layers" below) — it does not require touching the engine or generation layers, but it does shape this unit's design non-trivially, so it's called out up front rather than buried in implementation detail.

## Implementation

### Directory/file layout

```
src/metrics/
├── types.ts                # TrialMetrics, AlgorithmMetrics, PassengerRecord, ServedCounts — the
│                             # public data shapes
├── passengerRecords.ts     # builds a per-passenger {status, waitTimeMs, travelTimeMs} record set
│                             # for one trial, from its log + the regenerated arrivals for that trial
├── distanceOccupancy.ts    # reconstructs per-hop {occupancy} records per elevator from one
│                             # trial's log; derives total distance / avg occupancy / deadhead %
├── throughput.ts           # per-trial throughput calculation
├── trialMetrics.ts         # computeTrialMetrics(result, arrivals, building): TrialMetrics —
│                             # combines the three modules above for one trial
├── aggregate.ts            # aggregateTrialMetrics(trialMetrics[]): AlgorithmMetrics — pooled
│                             # cross-trial aggregation (see "Aggregation across trials" below)
├── computeMetrics.ts       # computeMetrics(trialResults, scenario): AlgorithmMetrics[] — the
│                             # public entry point: groups by algorithmId, regenerates arrivals
│                             # once, computes + aggregates
├── index.ts                 # barrel export
├── passengerRecords.test.ts
├── distanceOccupancy.test.ts
├── throughput.test.ts
├── aggregate.test.ts
└── computeMetrics.test.ts   # end-to-end, hand-traceable scenario (see "What gets unit-tested")
```

All files plain data + pure functions, no classes, one-concern-per-file — consistent with `src/engine`, `src/algorithms`, `src/generation`. `src/metrics/*` imports only from `src/engine` (types), `src/generation` (`Scenario`, `TrialRunResult`, `generateTrialBatch`) — it does not import from or modify `src/algorithms`.

### Per-passenger arrival time: a real gap, and how this unit closes it without touching other layers

Average/max wait time need, per passenger, the time they *started waiting* ("call → pickup"). The obvious source would be `hallCallRegistered` log entries, but — confirmed against `simulation.ts`'s `handlePassengerArrival` — that entry is logged only when a `(floor, direction)` call transitions inactive → active; a second passenger arriving at an already-active call produces no second entry (already documented as a real subtlety in `04_generation_done.md`). So `hallCallRegistered` cannot identify individual passengers' arrival times, even in principle.

The natural fallback — each passenger's own `waitingSince` field, set once at creation in `handlePassengerArrival` (`waitingSince: time`) — turns out to be **unrecoverable for the majority case** by the time `runSimulation` returns. Tracing the actual code (`simulation.ts`, `handleStop`):

- A passenger still waiting at simulation end remains in `finalState.waitingPassengers` — full `Passenger` object, `waitingSince` intact. Recoverable.
- A passenger who boarded but hadn't alighted by simulation end remains in `finalState.elevators[].onboard` — full `Passenger` object, `waitingSince` **and** `boardedAt` intact. Recoverable (wait time is even directly computable; only travel time is missing, correctly, since they haven't finished).
- A passenger who **both boarded and alighted** before simulation end — the common, "fully served" case, and the one that matters most for a meaningful average — is dropped entirely: `handleStop`'s alighting loop does `staying.push(...)` / `elevator.onboard = staying`, discarding the alighted `Passenger` object. Nothing in `finalState` retains it. The log's `passengerBoarded`/`passengerAlighted` entries for that passenger carry `time`, `elevatorId`, `floor`, `passengerId` — but not `waitingSince`.

So: **per-passenger wait time cannot be computed from `TrialRunResult` alone for fully-served passengers**, which is a real gap, not an oversight to design around silently.

**Resolution chosen (no engine or generation changes needed):** Unit 04's `generateTrialBatch(scenario)` is already proven pure and deterministic (`trialBatch.test.ts`: same scenario → deep-equal batch across repeated calls). `computeMetrics` calls it once per `Scenario` it's given, reconstructing the exact same `ScriptedInput[]` (one per `trialIndex`) that `runTrialBatch` originally generated and fed to every algorithm — each `PassengerArrival` carries `id` and `arrivalTime` together. Matching `PassengerArrival.id` to a log entry's `passengerId` (they're the same string, by construction — `handlePassengerArrival` sets `passenger.id = arrival.id`) recovers each passenger's true wait-start time for every passenger, in every status category, uniformly — without importing anything from `src/algorithms`, without changing `TrialRunResult`'s shape, and without touching the engine's log format.

This is called out explicitly (rather than just implemented silently) because it's a real design decision with a rejected alternative worth recording: an engine amendment (add `waitingSince` to the `passengerBoarded` log entry in `src/engine/types.ts`/`simulation.ts`, mirroring the project's established pattern of amending earlier units when later ones find real gaps) would also work and would make the log self-sufficient. It was **not** chosen here because the batch-regeneration approach achieves the same result with zero cross-unit changes, and this unit's stated scope is "does not touch the engine/algorithms/generation layers." Flagged for developer awareness, not sign-off, since it's a real alternative that a future refactor might still prefer (see Open Questions below).

### Wait/travel time and passenger status (`passengerRecords.ts`)

For one trial: given `arrivals: ScriptedInput` (the regenerated batch for that `trialIndex`) and `log: SimEventLogEntry[]`:

1. Build `boardedAt: Map<passengerId, time>` and `alightedAt: Map<passengerId, time>` from the log's `passengerBoarded`/`passengerAlighted` entries (exactly one of each per id that reaches that stage — a passenger boards at most once, alights at most once, by construction).
2. For every `arrival` in `arrivals` (the full population, including never-served passengers), classify:
   - `alightedAt` present → `status: 'served'`, `waitTimeMs = boardedAt - arrival.arrivalTime`, `travelTimeMs = alightedAt - boardedAt`.
   - `boardedAt` present, `alightedAt` absent → `status: 'boardedOnly'`, `waitTimeMs = boardedAt - arrival.arrivalTime`, `travelTimeMs = undefined`.
   - neither present → `status: 'neverBoarded'`, `waitTimeMs = undefined`, `censoredWaitMs = finalState.time - arrival.arrivalTime` (a lower bound — see "Never-served passengers" below).
3. (Consistency check, exercised as a test, not shipped as runtime validation): the `neverBoarded` set's ids should exactly match `finalState.waitingPassengers`' ids, and the `boardedOnly` set's ids should exactly match the union of `finalState.elevators[].onboard`'s ids — both are ground-truth cross-checks on the log-derived classification.

### Total distance traveled and occupancy (`distanceOccupancy.ts`)

`elevatorArrived` log entries are confirmed (per `handleTravel`/`handleElevatorArrived` in `simulation.ts`) to fire exactly once per floor-to-floor hop — an elevator never jumps multiple floors in one event. So **total distance traveled = count of `elevatorArrived` entries**, summed across elevators.

Occupancy-per-hop is not logged directly, but is fully reconstructible: boarding/alighting only ever happens between a `doorsOpened` and the following `doorsClosed`, never while `moving` — so an elevator's onboard count is constant for the entire duration of any single hop. Per elevator, replaying that elevator's own log entries in order (already globally time-ordered, and an elevator's own entries are necessarily in true chronological order within that global order):

```
onboard = 0
hops = []
for entry in log.filter(e => e.elevatorId === thisElevatorId):
  if entry.type === 'passengerBoarded': onboard += 1
  if entry.type === 'passengerAlighted': onboard -= 1
  if entry.type === 'elevatorArrived': hops.push({ occupancy: onboard })
    # `onboard` here reflects everyone who boarded/alighted at the PREVIOUS stop, which is
    # exactly who was actually carried across the hop that just completed.
```

From `hops` (pooled across all elevators for the trial):
- `totalDistanceFloors = hops.length`
- `averageOccupancyWhileMovingPct = mean(hops.map(h => h.occupancy / capacity)) * 100` — a simple mean over hops is correct (not just an approximation) because every hop has the same fixed duration (`BuildingConfig.floorTravelTimeMs`), so hop-count-weighted averaging *is* time-weighted averaging.
- `deadheadTravelPct = (hops.filter(h => h.occupancy === 0).length / hops.length) * 100`

Both are `null` for a trial with zero hops (e.g. a degenerate/empty scenario) rather than `0` or `NaN` — a trial where nothing ever moved has no occupancy data, not zero occupancy.

### Throughput (`throughput.ts`)

`throughputPerHour = servedCount / (finalState.time / 3_600_000)`, where `servedCount` is the count of passengers with `status === 'served'` (boarded **and** alighted — see "Never-served passengers" below for why this, not `boardedOnly` or total arrivals, is the right numerator) and `finalState.time` is the trial's actual elapsed simulated time (the last event timestamp processed, whether the run quiesced naturally or hit the `maxTimeMs` cutoff). `null` if `finalState.time === 0`.

Using the trial's own elapsed time (rather than, say, `scenario.durationMs`, the arrival-generation window) is deliberate: it measures "calls processed per hour of this run," so an algorithm that struggles under load and needs the full `maxTimeMs` safety cutoff to finish (or doesn't finish at all) is correctly penalized with a lower throughput, not flattered by a denominator that ignores how long it actually took.

**Naming clarification**: `00_main.md` calls this "calls served per simulated hour," but a "call" (`hallCallRegistered`) is a deduplicated floor+direction presence event, not a countable unit of service — the countable unit is always a passenger throughout this design (wait/travel time are inherently per-passenger). Throughput here means **passengers served per simulated hour**, which is the only interpretation consistent with the other six metrics and with the two-stage call model's own "presence only, no count" design. Not treated as an open question needing sign-off — there's no coherent alternative — but flagged since the wording differs from `00_main.md`'s literal phrase.

### Never-served passengers: explicit policy (flagged for developer sign-off — see Open Questions)

Every trial can end (naturally or at `maxTimeMs`) with passengers in one of the two incomplete states above. Getting their treatment wrong risks exactly the failure mode this project has repeatedly caught in other units: a silently-misleading number that flatters an algorithm which is actually failing to keep up with demand (e.g., an algorithm that abandons its slowest cases would show an artificially good average wait time if those cases are simply dropped from the average with no visible trace).

**Recommended policy** (asymmetric between "average" and "max" metrics, deliberately):

- **Average wait time / average travel time**: computed only over passengers who completed the relevant leg (`boarded` for wait time, `served` for travel time). Never-completing passengers are excluded from the average itself — **but** every `TrialMetrics`/`AlgorithmMetrics` always carries a `ServedCounts` breakdown (`total`, `served`, `boardedOnly`, `neverBoarded`) alongside the averages, so a comparison can never be read in isolation from how many passengers an algorithm actually failed to fully serve. This is why `ServedCounts` is part of the public shape, not an internal-only detail.
- **Max wait time**: computed over **all** passengers, including still-waiting-at-cutoff ones, using their `censoredWaitMs` (`finalState.time - arrivalTime`) as a lower-bound wait. Rationale: a metric whose entire purpose is catching worst-case/starvation behavior is the one place where *excluding* the passengers most likely to represent that failure would be actively wrong — an algorithm that strands someone forever should show that in its max wait time, not have it silently excluded because they never got a "real" pickup timestamp. (A censored lower bound can only *understate* the true worst case, never overstate it, so this can't manufacture a worse number than reality.)

This asymmetry — average excludes, max includes (via censoring) — is a real judgment call, not dictated by `00_main.md`, and is called out explicitly for sign-off rather than picked silently.

**Resolved by developer, with an addition**: the asymmetric policy above is approved. In addition, the "how many were left unserved" fact is promoted from `ServedCounts`-only supporting detail to an explicit, top-level **eighth metric** — `unservedCount` and `unservedPct` (alongside `servedCounts.total`, "total passengers") — so it's visible as a first-class comparison number, not something a reader has to notice buried in a breakdown object. `ServedCounts` is kept as-is underneath (it's what `unservedCount`/`unservedPct` are computed from, and Unit 07 may still want the full `served`/`boardedOnly`/`neverBoarded` split), but the headline shape now surfaces this directly. See "Public API" below.

### Aggregation across trials (`aggregate.ts`)

**General policy for every ratio/average-shaped metric** (average wait time, average travel time, throughput, average occupancy %, deadhead %): aggregate by **pooling** — sum the numerator and denominator across all trials, then divide once — rather than averaging each trial's already-computed ratio. E.g. algorithm-level average wait time = `(sum of every served/boarded passenger's wait time, across all trials) / (total count of such passengers, across all trials)`, not `mean(trial1.avgWait, trial2.avgWait, ...)`. This is the statistically standard way to combine ratios from unequal-sized samples (a "mean of per-trial averages" implicitly gives a trial with 3 passengers the same weight as one with 300, which is wrong when trial sizes vary — plausible for `RandomScenario`, where trial-to-trial passenger counts differ even under the same seeded-fairness guarantee, since fairness guarantees identical arrivals *across algorithms for the same trial index*, not identical counts *across trial indices*). Total distance traveled is a genuine total, not a ratio, so its aggregate is a simple mean of each trial's total (mean elevator-distance per run) — the "obvious default," no pooling concept applies.

**Max wait time is the one metric that is not a ratio and has a genuine two-way ambiguity**, flagged explicitly per the task brief (see Open Questions): "mean of each trial's max" and "max across all trials" are both defensible and give different numbers. **Resolved by developer: true max-across-all-trials as the headline `maxWaitTimeMs`**, with `meanOfPerTrialMaxWaitTimeMs` shipped alongside as a supporting stat.

**Resolved by developer: pooling, as recommended**, for every ratio/average-shaped metric.

### Public API (`index.ts`)

```ts
// Illustrative — not final until approved.

export type PassengerStatus = 'served' | 'boardedOnly' | 'neverBoarded';

export interface ServedCounts {
  total: number;
  served: number;       // boarded AND alighted
  boardedOnly: number;   // boarded, not yet alighted at trial end
  neverBoarded: number;
}

export interface TrialMetrics {
  algorithmId: string;
  trialIndex: number;
  simulatedDurationMs: number;           // finalState.time
  averageWaitTimeMs: number | null;      // over served + boardedOnly; null if none
  maxWaitTimeMs: number | null;          // over ALL passengers, censored for neverBoarded
  averageTravelTimeMs: number | null;    // over served only; null if none
  totalDistanceFloors: number;
  throughputPerHour: number | null;
  averageOccupancyWhileMovingPct: number | null;
  deadheadTravelPct: number | null;
  unservedCount: number;                 // boardedOnly + neverBoarded — 8th headline metric,
                                          // promoted from ServedCounts per developer request
  unservedPct: number | null;            // unservedCount / servedCounts.total * 100; null if total 0
  servedCounts: ServedCounts;            // full breakdown retained underneath
}

export interface AlgorithmMetrics {
  algorithmId: string;
  trialCount: number;
  averageWaitTimeMs: number | null;         // pooled across trials
  maxWaitTimeMs: number | null;              // max across ALL trials (see recommendation)
  meanOfPerTrialMaxWaitTimeMs: number | null; // supporting stat, alternate definition
  averageTravelTimeMs: number | null;         // pooled
  totalDistanceFloors: number;                // mean per-trial total
  throughputPerHour: number | null;           // pooled
  averageOccupancyWhileMovingPct: number | null; // pooled
  deadheadTravelPct: number | null;              // pooled
  unservedCount: number;                      // summed across trials
  unservedPct: number | null;                 // unservedCount / servedCounts.total * 100
  servedCounts: ServedCounts;                 // summed across trials
  perTrial: TrialMetrics[];                    // retained in full for Unit 07's per-run detail
}

export function computeMetrics(
  trialResults: TrialRunResult[],
  scenario: Scenario,
): AlgorithmMetrics[];
```

`computeMetrics` groups `trialResults` by `algorithmId` (not assumed pre-grouped/ordered, even though `runTrialBatch`'s current implementation happens to emit them grouped), calls `generateTrialBatch(scenario)` **once** (not once per trial result — it's deterministic and identical for every algorithm, per Unit 04's fairness guarantee, so one call suffices and avoids redundant regeneration work), and returns one `AlgorithmMetrics` per distinct `algorithmId`, each carrying its full `perTrial: TrialMetrics[]` for Unit 07's replay/inspection needs (a replay view showing "Run 7 of 20" needs that specific trial's own numbers, not just the algorithm-wide aggregate). `computeMetrics` does not need `Algorithm[]`/display names — Unit 06 maps `algorithmId → name` itself via `src/algorithms`'s own discovery list, which this unit doesn't need to import.

### What gets unit-tested

- **`passengerRecords.test.ts`**: a hand-built `arrivals` array + hand-built log covering all three statuses (one served passenger with known wait/travel times, one boarded-not-alighted, one never-boarded) — assert exact classification and exact `waitTimeMs`/`travelTimeMs`/`censoredWaitMs` values, not just "plausible numbers." A consistency test asserting the classification matches a hand-built `finalState`'s `waitingPassengers`/`onboard` ground truth.
- **`distanceOccupancy.test.ts`**: a hand-built log for 1–2 elevators with a known hop sequence and known boarding/alighting at each stop — assert exact `totalDistanceFloors`, `averageOccupancyWhileMovingPct`, `deadheadTravelPct` computed by hand. A dedicated zero-hops case asserting `null`, not `NaN`/`0`.
- **`throughput.test.ts`**: exact division check against a hand-computed case; a `finalState.time === 0` edge case asserting `null`.
- **`aggregate.test.ts`**: a fixture with deliberately different-sized trials (e.g. trial A: 2 served passengers; trial B: 20) proving the pooled aggregate differs from — and is more correct than — a naive mean-of-per-trial-averages on the same data (assert the actual pooled number, not just inequality). A max-wait fixture asserting `maxWaitTimeMs` (max-of-maxes) and `meanOfPerTrialMaxWaitTimeMs` are both computed correctly and are the different numbers the fixture is constructed to produce. A fixture asserting `unservedCount`/`servedCounts.total` sum correctly across trials (not averaged) and `unservedPct` is recomputed from the summed totals, not averaged from per-trial percentages (same pooling principle as the other ratio metrics).
- **`computeMetrics.test.ts`** (end-to-end, the "hand-traceable small scenario" style established in Units 02–04): a small hand-authored `ScriptedScenario` (2–3 floors, 1 elevator, a handful of passengers with at least one deliberately left unserved — e.g. via a tight `maxTimeMs` or an intentionally-incomplete test dispatch hook, reusing the style of Unit 02/03's hand-written hooks rather than a real algorithm, to keep the scenario fully hand-traceable) run through `runSimulation`/`runTrialBatch` for 2 trials, then through `computeMetrics` — every one of the eight headline metrics (including `unservedCount`/`unservedPct`) plus `ServedCounts` asserted against hand-computed exact values. The deliberately-unserved passenger(s) in this scenario are what make `unservedCount`/`unservedPct` non-trivial to assert here (not just `0`/`null`).
- **Regenerated-batch correctness**: a dedicated test confirming `computeMetrics`'s internal call to `generateTrialBatch(scenario)` reproduces arrival times that correctly line up with the log's `passengerBoarded` timestamps (i.e., `boardedTime >= arrivalTime` for every passenger, and the recovered `arrivalTime` matches what a hand-authored `ScriptedScenario`'s script literally specified) — a direct regression guard on the core design decision in this unit.

### Open questions for the developer

Flagging these explicitly for sign-off rather than deciding silently, per this project's established pattern (and per this unit's own stated risk: a silent wrong choice here could produce misleading comparison numbers, undermining the project's central purpose):

1. ~~**Never-served passenger treatment**~~ — **Resolved: asymmetric policy approved as proposed, plus an addition.** Average wait/travel time excludes never-completing passengers; max wait time includes everyone via censored lower bound. **Addition per developer request**: the unserved count is promoted to an explicit eighth headline metric (`unservedCount`/`unservedPct`, alongside `servedCounts.total`), not left as supporting-only detail — see "Public API" above.
2. ~~**Max wait time aggregation**~~ — **Resolved: true max-across-all-trials as the headline metric**, with `meanOfPerTrialMaxWaitTimeMs` as a secondary supporting stat.
3. ~~**Pooled vs. per-trial-averaged aggregation**~~ — **Resolved: pooling**, as recommended, for every ratio/average-shaped metric.
4. **Batch-regeneration vs. engine amendment for recovering per-passenger arrival time (see "Per-passenger arrival time" above).** Recommended: regenerate via `generateTrialBatch(scenario)` inside `computeMetrics`, touching no other layer. Flagged for awareness (not urgent sign-off) since the alternative — adding `waitingSince` to the `passengerBoarded` log entry — is a legitimate, arguably more architecturally clean fix that a future unit could still prefer; recorded here so it isn't rediscovered from scratch later. Proceeding with batch-regeneration as no objection was raised.

## AI Interactions

Implemented exactly as specified in this approved plan, including the developer-requested addition (`unservedCount`/`unservedPct` as first-class fields on both `TrialMetrics` and `AlgorithmMetrics`, per the "Public API" section above). No deviations from the approved design were needed. Summary of implementation choices made while filling in details the plan left to implementation:

- **`PassengerRecord` typed as a discriminated union on `status`** (`served` / `boardedOnly` / `neverBoarded`, each with exactly its own valid fields), rather than one shape with optional `waitTimeMs?`/`travelTimeMs?`/`censoredWaitMs?` fields. This was not spelled out in the plan's Public API code block (which only listed `PassengerStatus`, `ServedCounts`, `TrialMetrics`, `AlgorithmMetrics`, `computeMetrics`) but the directory-layout comment names `PassengerRecord` as one of `types.ts`'s public shapes. The discriminated-union form was chosen specifically to satisfy the "no `any`, no unjustified non-null assertions" constraint: every consumer narrows via a `status` check or type predicate instead of a `!` assertion.
- **`aggregate.ts`'s pooling implementation detail**: `aggregateTrialMetrics` receives only `TrialMetrics[]` (per-trial summaries), not raw passenger records, so true pooling (sum of raw numerators/denominators) isn't directly available for the ratio metrics that `TrialMetrics` stores only as an already-computed average (`averageWaitTimeMs`, `averageTravelTimeMs`, `averageOccupancyWhileMovingPct`, `deadheadTravelPct`). These are pooled by reconstructing each trial's numerator as `(that trial's stored ratio) * (that trial's own weight/count)` — mathematically exact recovery of the trial's summed value, not an approximation — then summing across trials and dividing once, exactly matching the plan's "sum numerator/denominator, divide once" policy. `throughputPerHour` uses the same pooling helper, weighted by each trial's elapsed hours (`simulatedDurationMs / 3_600_000`), which is equivalent to (and simpler than) separately summing `servedCounts.served` and `simulatedDurationMs` — verified algebraically in `aggregate.ts`'s header comment. A defensive runtime check throws if a positive weight is ever paired with a `null` ratio (which `trialMetrics.ts`'s own logic guarantees can't happen), rather than silently producing `NaN`.
- **`computeMetrics.ts`'s trialIndex-scoping** (the sharpest correctness risk flagged in the implementation brief): each `TrialRunResult` is matched against `batch[trialResult.trialIndex]` and only that index, inside the loop that builds each trial's `TrialMetrics` — never against a merged/flattened arrivals set. This was verified with a dedicated regression test using a real `RandomScenario` (confirmed via actual generator output to produce colliding ids like `"arrival-0"` across trials with different underlying data) that deliberately computes one trial's metrics against a *different* trial's regenerated arrivals and shows the result differs from — and that `computeMetrics`'s real output matches only — the correctly-scoped computation. See `05_metrics_test.md` for full detail.
- **`computeDistanceOccupancy`'s hop-occupancy reconstruction**: implemented exactly per the plan's pseudocode (per-elevator log replay, `elevatorArrived` snapshots the running onboard count *before* that stop's own boarding/alighting is processed, since `elevatorArrived` is always logged before `doorsOpened`/`passengerBoarded`/`passengerAlighted` in `simulation.ts`'s actual event ordering). This was traced by hand against a constructed example, then additionally confirmed by running the real engine (`runSimulation`) on the end-to-end test's exact scenario and cross-checking the produced log's `elevatorArrived`/`passengerBoarded`/`passengerAlighted` ordering matches what the implementation assumes, before hardcoding the end-to-end test's expected `averageOccupancyWhileMovingPct`/`deadheadTravelPct` values.
- The end-to-end `computeMetrics.test.ts` scenario's full event timeline (a `ScriptedScenario` with 4 passengers, one boarded-only and one never-boarded at a deliberately tight `maxTimeMs` cutoff) was independently run through the real `runSimulation` before being hardcoded as expected values in the test — not just hand-derived from the plan's rules in isolation — specifically because this project's first four units each found at least one real bug in this kind of hand-traced reasoning (see `02_engine_done.md`'s amendment history). No discrepancy was found between the hand-derivation and the actual engine output.

## Files Modified

Created: `src/metrics/types.ts`, `passengerRecords.ts`, `distanceOccupancy.ts`, `throughput.ts`, `trialMetrics.ts`, `aggregate.ts`, `computeMetrics.ts`, `index.ts`, `passengerRecords.test.ts`, `distanceOccupancy.test.ts`, `throughput.test.ts`, `aggregate.test.ts`, `computeMetrics.test.ts`, `dev_log/05_metrics_test.md`. Modified: `dev_log/05_metrics.md` (this file — AI Interactions, Files Modified, Status).

No files under `src/engine/`, `src/algorithms/`, or `src/generation/` were touched, per this unit's stated scope.

## Status: Complete
