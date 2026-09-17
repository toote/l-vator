// Test-only scaffolding for this unit: a scripted/no-op dispatch stub and small hand-authored
// fixture builders. NOT a real dispatch algorithm or call generator (those are Units 03/04) and
// NOT exported from index.ts — see dev_log/02_engine.md, directory/file layout note.

import type { DispatchAction, DispatchHook, DispatchSnapshot } from './dispatch';
import type { BuildingConfig, Direction, FloorIndex, HallCall, PassengerArrival } from './types';

/** A dispatch hook that never issues any action. Useful as a baseline / do-nothing stub. */
export const noOpDispatchHook: DispatchHook = () => [];

/**
 * A small, deliberately simple "go toward the nearest known target and stop when you get there"
 * dispatch hook, shared by several tests that need realistic multi-stop behavior without
 * hand-scripting every single decision by call index.
 *
 * Not a real algorithm (that's Unit 03) - just enough logic to drive hand-computed test scenarios
 * predictably: prefer dropping off/picking up right here if possible, otherwise head toward the
 * nearest onboard destination, otherwise head toward the first active hall call. Gated by
 * `capacityRemaining > 0` so a full elevator doesn't loop trying to re-stop for a call it can't
 * actually serve.
 */
export function createGreedyStopAndGoHook(): DispatchHook {
  return (snapshot: DispatchSnapshot): DispatchAction[] => {
    const elevator = snapshot.elevators[0];
    if (!elevator) return [];

    const hasMatchingCallHere =
      elevator.capacityRemaining > 0 &&
      snapshot.activeHallCalls.some(
        (call: HallCall) =>
          call.floor === elevator.currentFloor &&
          (elevator.direction === null || call.direction === elevator.direction),
      );
    const hasButtonHere = elevator.carButtons.includes(elevator.currentFloor);
    if (hasMatchingCallHere || hasButtonHere) {
      return [{ type: 'stop', elevatorId: elevator.id }];
    }

    const target: FloorIndex | undefined = elevator.carButtons[0];
    if (target !== undefined) {
      return [
        {
          type: 'travel',
          elevatorId: elevator.id,
          direction: target > elevator.currentFloor ? 'up' : 'down',
        },
      ];
    }

    const call = snapshot.activeHallCalls[0];
    if (call !== undefined && call.floor !== elevator.currentFloor) {
      return [
        {
          type: 'travel',
          elevatorId: elevator.id,
          direction: call.floor > elevator.currentFloor ? 'up' : 'down',
        },
      ];
    }

    return [];
  };
}

/**
 * Builds a dispatch hook from a plain function, handing it a 0-based call index alongside the
 * snapshot so scripted test scenarios can vary their response call-by-call (e.g. to prove
 * mid-route redirection: "on the 2nd invocation, redirect elevator E1").
 */
export function createScriptedDispatchHook(
  script: (snapshot: DispatchSnapshot, callIndex: number) => DispatchAction[],
): DispatchHook {
  let callIndex = 0;
  return (snapshot: DispatchSnapshot): DispatchAction[] => {
    const actions = script(snapshot, callIndex);
    callIndex += 1;
    return actions;
  };
}

/** A small default building config for tests to override piecemeal. */
export function buildBasicConfig(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return {
    floorCount: 5,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 1000,
    doorDwellBaseMs: 3000,
    doorDwellPerPassengerMultiplier: 0.5,
    ...overrides,
  };
}

/** Shorthand for hand-authoring a single passenger arrival record. */
export function passengerArrival(
  id: string,
  originFloor: FloorIndex,
  direction: Direction,
  destinationFloor: FloorIndex,
  arrivalTime: number,
): PassengerArrival {
  return { id, originFloor, direction, destinationFloor, arrivalTime };
}
