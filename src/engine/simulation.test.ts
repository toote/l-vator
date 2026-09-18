import { describe, expect, it, vi } from 'vitest';

import type { DispatchAction, DispatchHook, DispatchSnapshot } from './dispatch';
import { runSimulation } from './simulation';
import {
  buildBasicConfig,
  createGreedyStopAndGoHook,
  createScriptedDispatchHook,
  passengerArrival,
} from './testFixtures';

// Generous, bounded cutoff for every test in this file. If a scripted hook has a bug that
// prevents the simulation from naturally quiescing, tests fail fast instead of hanging — see
// dev_log/02_engine.md, "options.maxTimeMs".
const SAFETY_CUTOFF = { maxTimeMs: 60_000 };

describe('floor-to-floor movement timing', () => {
  it('arrives at each intermediate floor exactly floorTravelTimeMs apart, one hop at a time', () => {
    const config = buildBasicConfig({ floorCount: 5, floorTravelTimeMs: 750 });

    let stopped = false;
    const hook: DispatchHook = (snapshot) => {
      const elevator = snapshot.elevators[0];
      if (!elevator) return [];
      if (elevator.currentFloor < 4) {
        return [{ type: 'travel', elevatorId: elevator.id, direction: 'up' }];
      }
      if (!stopped) {
        stopped = true;
        return [{ type: 'stop', elevatorId: elevator.id }];
      }
      return [];
    };

    const { log } = runSimulation(
      config,
      [passengerArrival('p1', 4, 'up', 5, 0)],
      hook,
      SAFETY_CUTOFF,
    );

    const arrivals = log.filter((entry) => entry.type === 'elevatorArrived');
    expect(arrivals).toEqual([
      { type: 'elevatorArrived', time: 750, elevatorId: 'E1', floor: 1 },
      { type: 'elevatorArrived', time: 1500, elevatorId: 'E1', floor: 2 },
      { type: 'elevatorArrived', time: 2250, elevatorId: 'E1', floor: 3 },
      { type: 'elevatorArrived', time: 3000, elevatorId: 'E1', floor: 4 },
    ]);
  });
});

describe('decision-point re-invocation and mid-route redirection', () => {
  it('re-invokes the hook at every floor arrival and doors-finished-dwell, and can redirect an elevator mid-route', () => {
    const config = buildBasicConfig({ floorCount: 5, floorTravelTimeMs: 1000 });

    // Fully scripted by call index, independent of snapshot content, so there's no risk of the
    // hook itself looping unexpectedly - each of the 6 expected decision points gets a fixed,
    // hand-picked response.
    const responses: DispatchAction[][] = [
      [{ type: 'travel', elevatorId: 'E1', direction: 'up' }], // call 0: t=0, hall call registered
      [{ type: 'travel', elevatorId: 'E1', direction: 'up' }], // call 1: t=1000, arrived floor1
      [{ type: 'travel', elevatorId: 'E1', direction: 'down' }], // call 2: t=2000, arrived floor2 -> redirect
      [{ type: 'travel', elevatorId: 'E1', direction: 'down' }], // call 3: t=3000, arrived floor1 (heading down)
      [{ type: 'stop', elevatorId: 'E1' }], // call 4: t=4000, arrived floor0
      [], // call 5: t=7000, doors finished dwell (base dwell, no one boards) -> defaults to idle
    ];
    const scripted = createScriptedDispatchHook(
      (_snapshot, callIndex) => responses[callIndex] ?? [],
    );
    const hook = vi.fn(scripted);

    // Floor/direction here are irrelevant to the elevator's scripted path (this passenger never
    // boards) - the arrival only exists to register a hall call and kick off the first decision.
    const { log } = runSimulation(
      config,
      [passengerArrival('p1', 5, 'down', 0, 0)],
      hook,
      SAFETY_CUTOFF,
    );

    expect(hook).toHaveBeenCalledTimes(6);
    expect(hook.mock.calls.map(([snapshot]) => snapshot.time)).toEqual([
      0, 1000, 2000, 3000, 4000, 7000,
    ]);

    // At the moment of redirection (call index 2), the hook actually saw the elevator sitting at
    // floor 2, still committed 'up' from its original path.
    const redirectSnapshot: DispatchSnapshot = hook.mock.calls[2]![0];
    expect(redirectSnapshot.elevators[0]?.currentFloor).toBe(2);
    expect(redirectSnapshot.elevators[0]?.state).toBe('moving');
    expect(redirectSnapshot.elevators[0]?.direction).toBe('up');

    // The resulting movement proves the redirection actually happened mechanically: instead of
    // continuing up to floor 3/4, the elevator reverses at floor 2 and heads back down to floor 0.
    const arrivals = log.filter((entry) => entry.type === 'elevatorArrived');
    expect(arrivals).toEqual([
      { type: 'elevatorArrived', time: 1000, elevatorId: 'E1', floor: 1 },
      { type: 'elevatorArrived', time: 2000, elevatorId: 'E1', floor: 2 },
      { type: 'elevatorArrived', time: 3000, elevatorId: 'E1', floor: 1 },
      { type: 'elevatorArrived', time: 4000, elevatorId: 'E1', floor: 0 },
    ]);
  });
});

describe('dispatch hook contract', () => {
  it('throws if the hook returns more than one action for the same elevator in one invocation', () => {
    const config = buildBasicConfig({ floorCount: 3, elevatorCount: 1 });

    const hook: DispatchHook = (snapshot) => {
      const elevator = snapshot.elevators[0]!;
      return [
        { type: 'travel', elevatorId: elevator.id, direction: 'up' },
        { type: 'idle', elevatorId: elevator.id },
      ];
    };

    expect(() =>
      runSimulation(config, [passengerArrival('p1', 2, 'up', 3, 0)], hook, SAFETY_CUTOFF),
    ).toThrow(/more than one action for elevator "E1"/);
  });
});

describe('building config validation', () => {
  it('throws if doorDwellBaseMs is not positive', () => {
    const zeroConfig = buildBasicConfig({ doorDwellBaseMs: 0 });
    const negativeConfig = buildBasicConfig({ doorDwellBaseMs: -100 });
    const noop = (): [] => [];

    // A non-positive dwell time would let a zero-transaction stop loop forever with no time
    // advancement (see dev_log/02_engine_done.md's amendments) — rejected up front instead.
    expect(() => runSimulation(zeroConfig, [], noop, SAFETY_CUTOFF)).toThrow(
      /doorDwellBaseMs must be > 0/,
    );
    expect(() => runSimulation(negativeConfig, [], noop, SAFETY_CUTOFF)).toThrow(
      /doorDwellBaseMs must be > 0/,
    );
  });

  it('accepts a positive doorDwellBaseMs (no false positives)', () => {
    const config = buildBasicConfig({ doorDwellBaseMs: 1 });
    const noop = (): [] => [];
    expect(() => runSimulation(config, [], noop, SAFETY_CUTOFF)).not.toThrow();
  });

  it('throws if idleReturnThresholdMs is negative', () => {
    const config = buildBasicConfig({ idleReturnThresholdMs: -1 });
    const noop = (): [] => [];
    expect(() => runSimulation(config, [], noop, SAFETY_CUTOFF)).toThrow(
      /idleReturnThresholdMs must be >= 0/,
    );
  });

  it('accepts idleReturnThresholdMs of exactly 0 -- unlike doorDwellBaseMs, 0 is legitimate here ("return home immediately")', () => {
    const config = buildBasicConfig({ idleReturnThresholdMs: 0 });
    const noop = (): [] => [];
    expect(() => runSimulation(config, [], noop, SAFETY_CUTOFF)).not.toThrow();
  });
});

describe('combined door-dwell timing', () => {
  it('computes dwell on the summed boarding+alighting total in a single door cycle, not two phases', () => {
    const config = buildBasicConfig({
      floorCount: 3,
      capacity: 4,
      floorTravelTimeMs: 500,
      doorDwellBaseMs: 1000,
      doorDwellPerPassengerMultiplier: 0.5,
    });

    const hook = createGreedyStopAndGoHook();

    const script = [
      passengerArrival('onboard', 0, 'up', 2, 0), // boards immediately (elevator idle right there)
      passengerArrival('waitingA', 2, 'up', 0, 0), // waiting at floor 2 before the elevator arrives
      passengerArrival('waitingB', 2, 'up', 0, 0),
    ];

    const { log } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    const doorsAtFloor2 = log.filter(
      (entry) =>
        (entry.type === 'doorsOpened' || entry.type === 'doorsClosed') && entry.floor === 2,
    );
    // Exactly one open/close cycle at floor 2 - not a separate cycle for alighting vs boarding.
    expect(doorsAtFloor2.map((e) => e.type)).toEqual(['doorsOpened', 'doorsClosed']);

    const [opened, closed] = doorsAtFloor2;
    const actualDwell = closed!.time - opened!.time;
    // 1 alighting + 2 boarding = 3 total. If dwell were wrongly phased (alight then board as two
    // separate stops), it would be 1000 + 1500 = 2500 instead of the correct combined 2000.
    expect(actualDwell).toBe(2000);

    const alightings = log.filter((e) => e.type === 'passengerAlighted' && e.floor === 2);
    const boardings = log.filter((e) => e.type === 'passengerBoarded' && e.floor === 2);
    expect(alightings).toHaveLength(1);
    expect(boardings).toHaveLength(2);
    expect(alightings.every((e) => e.type === 'passengerAlighted' && e.time === opened!.time)).toBe(
      true,
    );
    expect(boardings.every((e) => e.type === 'passengerBoarded' && e.time === opened!.time)).toBe(
      true,
    );
  });
});

describe('destination fixed at creation', () => {
  it("leaves a boarded passenger's destinationFloor exactly as fixture-authored; boarding only copies it into carButtons", () => {
    const config = buildBasicConfig({ floorCount: 3, floorTravelTimeMs: 500 });

    // Board the passenger, then explicitly go idle rather than continuing toward their
    // destination, so they're still onboard (inspectable) when the simulation ends.
    const hook: DispatchHook = (snapshot) => {
      const elevator = snapshot.elevators[0];
      if (!elevator) return [];
      if (elevator.state === 'idle' && snapshot.activeHallCalls.length > 0) {
        return [{ type: 'stop', elevatorId: elevator.id }];
      }
      return [{ type: 'idle', elevatorId: elevator.id }];
    };

    const { finalState } = runSimulation(
      config,
      [passengerArrival('p1', 0, 'up', 3, 0)],
      hook,
      SAFETY_CUTOFF,
    );

    const elevator = finalState.elevators[0]!;
    expect(elevator.onboard).toHaveLength(1);
    const passenger = elevator.onboard[0]!;
    expect(passenger.id).toBe('p1');
    expect(passenger.originFloor).toBe(0);
    expect(passenger.destinationFloor).toBe(3); // unchanged from the fixture-authored value
    expect(passenger.boardedElevatorId).toBe('E1');
    expect(passenger.boardedAt).toBe(0);
    expect(passenger.alightedAt).toBeUndefined();
    expect(Array.from(elevator.carButtons)).toEqual([3]); // copied, not regenerated
  });
});

describe('end-to-end scripted scenario', () => {
  it('matches a hand-computed full log timeline for a small multi-stop run', () => {
    const config = buildBasicConfig({
      floorCount: 3,
      capacity: 4,
      floorTravelTimeMs: 1000,
      doorDwellBaseMs: 2000,
      doorDwellPerPassengerMultiplier: 0.5,
    });

    const hook = createGreedyStopAndGoHook();

    // p1 waits at floor 2 from t=0; p2 registers at floor 1 (which the elevator hasn't reached
    // yet) at t=300, while the elevator is already mid-route - proving a mid-route hall call gets
    // served opportunistically once the elevator's current leg completes.
    const script = [passengerArrival('p1', 2, 'up', 3, 0), passengerArrival('p2', 1, 'up', 3, 300)];

    const { log, finalState } = runSimulation(config, script, hook, SAFETY_CUTOFF);

    expect(log).toEqual([
      { type: 'hallCallRegistered', time: 0, floor: 2, direction: 'up' },
      { type: 'hallCallRegistered', time: 300, floor: 1, direction: 'up' },
      { type: 'elevatorArrived', time: 1000, elevatorId: 'E1', floor: 1 },
      { type: 'doorsOpened', time: 1000, elevatorId: 'E1', floor: 1 },
      { type: 'passengerBoarded', time: 1000, elevatorId: 'E1', floor: 1, passengerId: 'p2' },
      { type: 'hallCallCleared', time: 1000, floor: 1, direction: 'up' },
      { type: 'doorsClosed', time: 3000, elevatorId: 'E1', floor: 1 },
      { type: 'elevatorArrived', time: 4000, elevatorId: 'E1', floor: 2 },
      { type: 'doorsOpened', time: 4000, elevatorId: 'E1', floor: 2 },
      { type: 'passengerBoarded', time: 4000, elevatorId: 'E1', floor: 2, passengerId: 'p1' },
      { type: 'hallCallCleared', time: 4000, floor: 2, direction: 'up' },
      { type: 'doorsClosed', time: 6000, elevatorId: 'E1', floor: 2 },
      { type: 'elevatorArrived', time: 7000, elevatorId: 'E1', floor: 3 },
      { type: 'doorsOpened', time: 7000, elevatorId: 'E1', floor: 3 },
      { type: 'passengerAlighted', time: 7000, elevatorId: 'E1', floor: 3, passengerId: 'p2' },
      { type: 'passengerAlighted', time: 7000, elevatorId: 'E1', floor: 3, passengerId: 'p1' },
      { type: 'doorsClosed', time: 10000, elevatorId: 'E1', floor: 3 },
    ]);

    expect(finalState.time).toBe(10000);
    const elevator = finalState.elevators[0]!;
    expect(elevator.currentFloor).toBe(3);
    expect(elevator.state).toBe('idle');
    expect(elevator.direction).toBeNull();
    expect(elevator.onboard).toEqual([]);
    expect(Array.from(elevator.carButtons)).toEqual([]);
    expect(finalState.waitingPassengers).toEqual([]);
  });
});
