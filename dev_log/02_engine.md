# Unit 02: Engine

## Objective

Deliver the core discrete-event simulation engine described in `00_main.md`: the event queue and clock, the elevator/passenger/building state model, floor-to-floor atomic movement, capacity and presence-only hall-call semantics, and the door-dwell time formula. This is the substantive, framework-independent part of the project — everything else (algorithms, call generation, UI, replay, metrics) is built on top of it.

Scope is deliberately narrow: **mechanics only, no decision-making**.

- No dispatch algorithms (Unit 03) — this unit only defines and exposes the *seam* (an interface) that a real algorithm will plug into later, plus a minimal scripted/no-op stub used solely to drive this unit's own tests.
- No call generation or randomness (Unit 04) — hall calls and passenger destinations for this unit's tests are hand-authored fixtures, not generated.
- No UI (Unit 06) — the engine is a plain, headless TS module tree under `src/engine/`, importable by Vitest with no DOM dependency.

Getting this unit right matters more than most, because Units 03–07 all build on the shapes defined here (state model, event log, the dispatch-hook interface). Several of the choices below are therefore flagged explicitly for developer sign-off rather than decided silently, since a change to them later means touching downstream units too.

## Implementation

### Directory/file layout

```
src/engine/
├── types.ts           # FloorIndex, Direction, BuildingConfig, Passenger, ElevatorState,
│                       # HallCall, BuildingState — the core state model
├── eventQueue.ts       # generic time-ordered scheduling queue (min-heap or sorted insert)
├── door.ts             # pure door-dwell-time formula
├── dispatch.ts         # DispatchSnapshot / DispatchAction / DispatchHook types —
│                       # the seam Unit 03 will implement against
├── simulation.ts       # the engine core: runSimulation(config, script, dispatchHook)
├── index.ts            # public barrel export (what later units import)
├── eventQueue.test.ts
├── door.test.ts
├── simulation.test.ts  # movement/timing/redirection
├── capacity.test.ts    # overflow, presence-only semantics
└── testFixtures.ts     # scripted no-op/manual dispatch stub + hand-authored passenger-arrival
                         # fixtures (test-only scaffolding — NOT a real algorithm/generator;
                         # Units 03/04 own the real ones)
```

`testFixtures.ts` is explicitly not exported from `index.ts` and is not meant to survive as "the" algorithm — it exists only so this unit is testable before Unit 03 exists, per the task scope note in `00_main.md`.

### State model

Plain data interfaces, no classes — a "functional core": state is immutable-by-convention data, transitions are pure(-ish) functions that take a state and return a new one (or, pragmatically, mutate a working copy inside the simulation loop but never expose mutable references to callers/tests). This matches the project's minimal, framework-free style (vanilla TS, no UI framework, thin app layer) and keeps every mechanic (movement, dwell, boarding) independently unit-testable as a function rather than requiring instance setup. **Flagged below as an open choice** since it's a real alternative to a class-based `Elevator`/`Building` model — either works, but it affects how every later unit reads this code.

Core shapes (illustrative, not final until approved):

```ts
type FloorIndex = number;          // 0-indexed; 0 is always the ground floor
type Direction = 'up' | 'down';

interface BuildingConfig {
  floorCount: number;          // floors ABOVE ground — valid FloorIndex values are 0..floorCount
                                 // inclusive (floorCount + 1 total levels), e.g. floorCount: 5
                                 // means indices 0 (ground) through 5.
  elevatorCount: number;
  capacity: number;
  floorTravelTimeMs: number;
  doorDwellBaseMs: number;
  doorDwellPerPassengerMultiplier: number; // e.g. 0.5 for the default 50%
}

interface Passenger {
  id: string;
  originFloor: FloorIndex;
  direction: Direction;         // the hall-call direction they're waiting under
  waitingSince: number;         // sim time they started waiting
  destinationFloor: FloorIndex; // known internally from creation — see "Passenger destinations" below
  boardedElevatorId?: string;
  boardedAt?: number;
  alightedAt?: number;
}

type ElevatorMachineState = 'idle' | 'moving' | 'doorsOpen' | 'doorsClosed';

interface ElevatorState {
  id: string;
  currentFloor: FloorIndex;
  state: ElevatorMachineState;
  direction: Direction | null;  // travel/last-committed direction; null only when truly idle
  onboard: Passenger[];
  carButtons: Set<FloorIndex>;  // destinations requested by onboard passengers
}

interface HallCall {
  floor: FloorIndex;
  direction: Direction;          // presence only — no count, by design
}

interface BuildingState {
  time: number;
  elevators: ElevatorState[];
  waitingPassengers: Passenger[]; // full internal ground truth (has identities/counts)
}
```

`waitingPassengers` is the engine's internal ground truth and is how capacity/overflow is actually computed. It is deliberately **not** what gets shown to a dispatch algorithm (see below) — the two-stage call model requires that algorithms only ever see presence (floor + direction), never counts, even though the engine itself must track real passengers to do boarding/alighting correctly.

### Event queue

`eventQueue.ts` is a small generic time-ordered queue: `push(event, time)`, `pop()`, `peek()`, `isEmpty()`. Internally a binary min-heap keyed by `(time, sequence)` where `sequence` is a monotonically increasing insertion counter — this gives **stable FIFO tie-breaking** for events scheduled at the exact same simulation time. This is a real design choice, not dictated by `00_main.md`, and is flagged below.

Two distinct kinds of "event" exist and should not be conflated:
- **Scheduled events** (internal, what the queue holds): "wake the loop up at time T because X" — e.g. `ElevatorArrivedAtFloor`, `HallCallRegistered`, `DoorsFinishedDwell` (the `doorsOpen` → `doorsClosed` transition).
- **Log entries** (output, for later replay/metrics — Unit 07 needs "each trial's event log recorded"): a flat, timestamped record of what actually happened — `hallCallRegistered`, `elevatorArrived`, `doorsOpened`, `passengerBoarded`, `passengerAlighted`, `doorsClosed`, `hallCallCleared`. **Confirmed by developer: this unit builds the log now**, alongside the scheduling loop, rather than deferring it to Unit 07. `runSimulation` builds this log as it processes scheduled events and returns it alongside the final `BuildingState`.

Event ordering is **confirmed FIFO**: the min-heap's tie-break for same-timestamp events is pure insertion order, no semantic priority.

### Movement and the decision hook

Each elevator is modeled as an explicit finite state machine — `ElevatorMachineState`: `idle` (stopped, doors closed, no target) → `moving` (travelling toward one adjacent floor) → arrival triggers a decision → either `doorsOpen` (stop: mechanically board/alight, per below) or a fresh `moving` leg (continue past this floor) → `doorsOpen` transitions automatically to `doorsClosed` once the computed dwell time elapses (no decision needed mid-dwell — boarding/alighting is mechanical, not a dispatch choice) → `doorsClosed` triggers a decision (continue, reverse, or go idle) → back to `moving` or `idle`.

This directly replaces an earlier, less clean version of this plan that tacked on "doors-ready-to-depart" as a bolted-on third trigger alongside "floor arrival" and "new call." Framing it as a proper state machine instead is more natural and has a real benefit: the decision points fall out of the state transitions themselves (entering `moving`→arrival, entering `doorsClosed`) rather than being three independently-justified special cases, and it's no longer possible to represent a physically-impossible combination like "moving with doors open" — which the earlier `direction`/`doorState` two-field design could have accidentally allowed.

Per `00_main.md`, the atomic movement event is one floor at a time: an elevator never "jumps" multiple floors in a single scheduled event. The engine builds a fresh `DispatchSnapshot` of the whole fleet and invokes the dispatch hook whenever: (a) an elevator arrives at a floor (i.e. a `moving` leg completes — decide whether to stop or continue), (b) an elevator finishes its door dwell (`doorsClosed` — decide the next move), or (c) a new hall call is registered anywhere in the building (every elevator gets a fresh chance to react, though one already mid-`moving` can only act on it once its current leg completes — it can't teleport between floors).

Proposed dispatch hook interface — **this is this unit's design of the seam Unit 03 will build against**, so it's the most important open question in this plan:

```ts
interface ElevatorSnapshot {
  id: string;
  currentFloor: FloorIndex;
  state: ElevatorMachineState;
  direction: Direction | null;
  passengerCount: number;
  capacityRemaining: number;
  carButtons: ReadonlyArray<FloorIndex>;
}

interface DispatchSnapshot {
  time: number;
  elevators: ReadonlyArray<ElevatorSnapshot>;
  activeHallCalls: ReadonlyArray<HallCall>; // floor + direction ONLY — no counts, enforced by this shape
}

type DispatchAction =
  | { type: 'travel'; elevatorId: string; direction: Direction } // keep/start moving one floor that way
  | { type: 'stop'; elevatorId: string }                          // stop here, open doors
  | { type: 'idle'; elevatorId: string };                         // stay put, no target

type DispatchHook = (snapshot: DispatchSnapshot) => DispatchAction[];
```

On a `'stop'` action the engine — not the algorithm — mechanically determines who boards/alights: onboard passengers whose `destinationFloor` equals the current floor alight; waiting passengers at that floor whose `direction` matches the elevator's arrival direction board, up to remaining capacity (first-waiting-first-served among them, by `waitingSince`). If more are waiting than fit, the excess stay in `waitingPassengers` and the hall call stays active — this is the required overflow/partial-boarding behavior, not an error case. Door-dwell time is computed on the combined boarding+alighting count via `door.ts`'s formula.

### Door-dwell formula

`door.ts` exports a pure function:

```ts
function computeDoorDwellMs(
  totalBoardingAndAlighting: number,
  base: number,
  perPassengerMultiplier: number,
): number {
  if (totalBoardingAndAlighting <= 0) return 0;
  return base + perPassengerMultiplier * base * (totalBoardingAndAlighting - 1);
}
```

i.e. the first passenger costs `base`; each additional passenger (boarding or alighting, combined) adds `multiplier × base`. With the documented default of a 50% multiplier and e.g. a 3000ms base: 1 person → 3000ms, 2 → 4500ms, 5 → 9000ms.

### Passenger destinations and reproducibility

**Correction made during plan review**: an earlier draft of this plan had a `DestinationProvider` hook invoked at boarding time to "assign" a passenger's destination. That's wrong, and worth recording why: `00_main.md` requires that a seeded batch comparison replay the *exact same* call sequence identically across every algorithm under test, so metric differences reflect only the algorithm. If a passenger's destination were randomly drawn at the moment they board, the draw's position in the seeded RNG stream would depend on *when* a given algorithm happens to board that passenger — which varies by algorithm. Two algorithms could then silently get different destinations for "the same" passenger, quietly breaking the fairness guarantee.

The fix: a passenger's destination is decided at **creation** (arrival) time, as part of the input data itself — exactly like a real person already knows where they're going before they press a hall button. `ScriptedInput` (this unit's hand-authored test fixtures; later, Unit 04's real generator) supplies each passenger's `originFloor`, `direction`, `destinationFloor`, and arrival time together, up front. The engine stores `destinationFloor` on the `Passenger` object from the moment it's created — it is never optional, never separately "assigned," and never re-decided.

What's genuinely two-stage is only what the **dispatch algorithm gets to see**: `DispatchSnapshot` never carries `Passenger` objects or destination data at all (only `HallCall` presence and each elevator's own `carButtons`), so nothing about a waiting passenger's destination was ever going to leak to the algorithm regardless of when the value was set internally. Boarding doesn't "reveal" or "assign" anything — it just adds the already-known `destinationFloor` to the boarding elevator's `carButtons` so the engine's own routing/alighting logic can use it. This removes the need for any destination-related hook or seam in this unit; `runSimulation` only takes the one `dispatchHook` parameter.

### Public API (`index.ts`)

What later units import:

```ts
function runSimulation(
  config: BuildingConfig,
  script: ScriptedInput,      // for this unit: hand-authored passenger-arrival fixtures — each
                                // record already carries origin, direction, destination, and
                                // arrival time together, decided up front (see above)
  dispatchHook: DispatchHook,
  options?: { maxTimeMs?: number }, // safety cutoff for tests/scripts that never naturally quiesce
): { finalState: BuildingState; log: SimEventLogEntry[] };
```

plus the exported types (`BuildingConfig`, `Passenger`, `ElevatorState`, `HallCall`, `DispatchSnapshot`, `DispatchAction`, `DispatchHook`, `SimEventLogEntry`). Unit 03 imports `DispatchHook`/`DispatchSnapshot`/`DispatchAction` to implement real algorithms against; Unit 04 imports the `ScriptedInput`/passenger-record shape to implement real seeded call generation; Unit 07 consumes `SimEventLogEntry[]` for replay.

The loop terminates when the event queue is empty and no passengers remain waiting or onboard (natural quiescence), or at `options.maxTimeMs` if given — the cutoff exists so a test with a bad/never-resolving scripted hook fails fast with a bounded run instead of hanging.

### What gets unit-tested (Vitest) at this stage

- **Event queue**: chronological pop order; stable FIFO tie-break for equal timestamps; peek doesn't mutate; empty-queue behavior.
- **Door-dwell formula**: direct tests of `computeDoorDwellMs` — 0, 1, 2, and 5-passenger cases against the default base/multiplier, plus a non-default multiplier to confirm the formula (not just the defaults) is right.
- **Floor-to-floor timing**: an elevator commanded to travel N floors arrives at each intermediate floor exactly `floorTravelTimeMs` apart, one hop at a time (not a single multi-floor jump).
- **Decision-point re-invocation**: the dispatch hook is called at every floor arrival and every new hall call registration (assert call count/arguments against a scripted scenario), and a scripted hook can redirect an elevator to a new target after an intermediate arrival — proving mid-route redirection actually works mechanically.
- **Capacity/overflow**: more waiting passengers at a hall call than remaining capacity results in exactly `capacityRemaining` boarding, the rest staying in `waitingPassengers`, and the hall call remaining active until they're eventually served.
- **Presence-only hall calls**: the `DispatchSnapshot.activeHallCalls` shape exposes only `{floor, direction}` — a type-level check plus a runtime scenario confirming no count/identity information leaks through it, even though `capacity.test.ts`'s overflow scenario proves the *engine* internally does track real counts correctly.
- **Combined dwell timing**: a stop with simultaneous alighting and boarding computes dwell on the summed total, not as two separate phases.
- **Destination fixed at creation**: a passenger's `destinationFloor` (set when the fixture creates them) is unchanged by boarding/alighting — boarding only copies the already-known value into the elevator's `carButtons`, it never generates or reassigns it. Combined with the presence-only test above, this confirms destinations are decided up front and never leak to the algorithm.
- **End-to-end scripted scenario**: one small hand-computed scenario (e.g. 3 floors, 1 elevator, 2–3 scripted hall calls) asserting the full log timeline matches expected timestamps/ordering, as a integration-style smoke test over the unit tests above.

### Open questions for the developer

Flagging these for explicit sign-off before implementation starts, since they're not decided in `00_main.md` and several of them shape interfaces that Units 03/04 will depend on:

1. **Dispatch hook interface shape** (`DispatchSnapshot`/`DispatchAction`/`DispatchHook` above). This is this unit's design of Unit 03's seam without Unit 03 existing yet — worth the most scrutiny of anything in this plan. In particular: should `'stop'` be a distinct action from `'travel'`, or should stopping be implicit (e.g., `travel` with no target = stop)? Should the hook return actions for every elevator every time, or only ones it wants to change?
2. ~~**Event-queue tie-break rule.**~~ — **Resolved: FIFO.** Pure insertion order for same-timestamp events, no semantic priority.
3. ~~**State model style**~~ — **Resolved: plain data + pure functions** ("functional core"), confirmed by developer.
4. ~~**Destination-provider hook**~~ — **Resolved, removed.** Caught during plan review: generating a passenger's destination at boarding time (rather than at creation) would make the seeded RNG draw's position depend on algorithm behavior, breaking the seeded-fairness guarantee in `00_main.md`. Destinations are now decided at passenger creation, carried directly on `Passenger.destinationFloor` (non-optional), and never exposed via `DispatchSnapshot` — see "Passenger destinations and reproducibility" above. No hook needed.
5. ~~**Event log ownership**~~ — **Resolved: this unit builds it now**, alongside the scheduling loop.
6. ~~**Floor indexing convention**~~ — **Resolved: 0-indexed, 0 is the ground floor.** `floorCount` in `BuildingConfig` configures floors *above* ground, so valid `FloorIndex` values run `0..floorCount` inclusive (`floorCount + 1` total levels) — e.g. `floorCount: 5` means indices 0 (ground) through 5.
7. ~~**Doors-ready-to-depart as a third trigger**~~ — **Resolved: reframed as an explicit elevator state machine** (`idle` / `moving` / `doorsOpen` / `doorsClosed`), with decision points falling naturally out of the state transitions rather than being bolted-on special cases — see "Movement and the decision hook" above. This also fixed a latent modeling bug: the old separate `direction`/`doorState` fields could represent physically-impossible states (e.g. moving with doors open); the state machine can't.
8. ~~**`tsconfig.json` strict mode**~~ — **Resolved.** `"strict": true` has been added and verified (build/lint/test/format:check all pass); committed separately ahead of this unit.

## AI Interactions

Implemented the full unit as specified: `types.ts`, `eventQueue.ts`, `door.ts`, `dispatch.ts`, `simulation.ts`, `index.ts`, and `testFixtures.ts`, plus the four test files (`eventQueue.test.ts`, `door.test.ts`, `simulation.test.ts`, `capacity.test.ts` — 21 tests total, all passing). No classes anywhere; `eventQueue.ts`'s min-heap is a factory function returning closures (state-carrying but not a `class`), consistent with the plan's "functional core" style. `npm run lint`, `npm run format:check` (one `npm run format` pass needed first), `npm run test`, and `npm run build` all pass under strict TypeScript with no `any` and no non-null assertions except where a value's presence is already guaranteed by prior logic in the same scope (e.g. destructuring a known-present array element right after `.find()` succeeded, or a queue `pop()` result whose `undefined` case was already handled a line above) — used sparingly and only where a real runtime guarantee exists, not as a way around the type checker.

Two implementation decisions were needed that the plan didn't spell out (not deviations from anything the plan explicitly required — genuine gaps the plan's own "mechanics only" scope left open):

1. **Deriving `activeHallCalls` from `waitingPassengers` rather than tracking a separate hall-call collection.** `BuildingState` (as specified) has no `activeHallCalls` field of its own — only `waitingPassengers`. Rather than inventing a second, parallel piece of state that could desync from it, hall-call presence (for both `DispatchSnapshot.activeHallCalls` and the `hallCallRegistered`/`hallCallCleared` log transitions) is computed on demand from `waitingPassengers`: a call is "active" exactly when at least one waiting passenger shares its `(floor, direction)`. This is a direct reading of the plan's own framing ("the engine's internal ground truth... how capacity/overflow is actually computed" / "presence only, no count") rather than an addition to it.
2. **Boarding direction when a `'stop'` action is issued directly from `idle`.** The plan's boarding rule ("waiting passengers... whose direction matches the elevator's arrival direction board") presumes an elevator that just arrived via a `moving` leg, so `direction` is set. But `ElevatorState.direction` is `null` when idle, and a dispatch hook can legitimately issue `'stop'` for an elevator that's already sitting at a call floor (never having had to travel there) — there's no "arrival direction" in that case. Resolved by treating a `null` committed direction as "match either direction" for that one stop only; `elevator.direction` itself is only ever set by a `'travel'` action, so this doesn't change behavior for the (much more common) arrived-via-movement case the plan's wording describes. Exercised directly by the "destination fixed at creation" test and implicitly by every scenario where the first stop happens to be at the elevator's starting floor. Flagged here for developer awareness since it's the one place engine behavior isn't fully pinned down by the approved plan text.

Two minor scope decisions, also not deviations: (a) `index.ts` exports a slightly larger type surface than the plan's literal parenthetical list (`BuildingConfig, Passenger, ElevatorState, HallCall, DispatchSnapshot, DispatchAction, DispatchHook, SimEventLogEntry`) — it also exports `FloorIndex`, `Direction`, `ElevatorMachineState`, `BuildingState`, `PassengerArrival`, `ScriptedInput`, `ElevatorSnapshot`, and `RunSimulationOptions`/`RunSimulationResult`. The plan's own prose says "Unit 04 imports the `ScriptedInput`/passenger-record shape," which isn't in that parenthetical list either, so the list read as illustrative rather than exhaustive; the additional exports are exactly the supporting types needed to use `runSimulation`, `DispatchSnapshot`, etc. meaningfully from outside the module, nothing beyond that. (b) `runSimulation`'s options/result shapes are named interfaces (`RunSimulationOptions`, `RunSimulationResult`) rather than the plan's inline `{ maxTimeMs?: number }` / `{ finalState; log }` object-type sketch — same shape, just named for a cleaner public signature; also exported from `index.ts`.

Every `runSimulation` call across the test suite passes a generous `maxTimeMs` safety cutoff (60s), per the plan's own stated purpose for that option ("a test with a bad/never-resolving scripted hook fails fast... instead of hanging") — defensive test-writing given several tests drive the engine with hand-written, non-trivial dispatch hooks.

### Post-review refinement: duplicate-action guard

During developer review, `applyDecision` was noted to have no guard against a hook returning two actions for the same elevator in one invocation (e.g. both `'travel'` and `'stop'`) — both would have executed in sequence with undefined-by-the-plan results. Fixed: `applyDecision` now does an up-front pass over the hook's returned actions and throws `Dispatch hook returned more than one action for elevator "<id>" in the same invocation` if any elevator id appears twice, before any action is applied — regardless of whether that elevator is currently eligible to act. Added a test in `simulation.test.ts` ("dispatch hook contract") asserting the throw. 22 tests now pass (was 21); lint/format/build re-verified clean.

## Files Modified

Created:
- `src/engine/types.ts`
- `src/engine/eventQueue.ts`
- `src/engine/door.ts`
- `src/engine/dispatch.ts`
- `src/engine/simulation.ts`
- `src/engine/index.ts`
- `src/engine/testFixtures.ts`
- `src/engine/eventQueue.test.ts`
- `src/engine/door.test.ts`
- `src/engine/simulation.test.ts`
- `src/engine/capacity.test.ts`
- `dev_log/02_engine_test.md`

Modified:
- `dev_log/02_engine.md` (this file — AI Interactions, Files Modified, Status)

## Status: Complete
