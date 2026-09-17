// The seam Unit 03's dispatch algorithms implement against. See dev_log/02_engine.md,
// "Movement and the decision hook" — these shapes are this unit's proposed (and approved)
// design of that interface.

import type { Direction, ElevatorMachineState, FloorIndex, HallCall } from './types';

export interface ElevatorSnapshot {
  id: string;
  currentFloor: FloorIndex;
  state: ElevatorMachineState;
  direction: Direction | null;
  passengerCount: number;
  capacityRemaining: number;
  carButtons: ReadonlyArray<FloorIndex>;
}

export interface DispatchSnapshot {
  time: number;
  elevators: ReadonlyArray<ElevatorSnapshot>;
  /**
   * Floor + direction ONLY — no counts, enforced by this shape. Never carries `Passenger`
   * objects or destination data; that's the whole point of the two-stage call model.
   *
   * Ordering is a guaranteed contract, not incidental: entries appear in the order each
   * distinct (floor, direction) call first became active among calls that are *currently*
   * active, and a call being served/cleared never reorders the calls that remain — clearing
   * one call is independent of the others' relative order. An algorithm may rely on this
   * (e.g. to approximate first-come-first-served) without re-deriving it from timestamps.
   */
  activeHallCalls: ReadonlyArray<HallCall>;
}

export type DispatchAction =
  | { type: 'travel'; elevatorId: string; direction: Direction } // keep/start moving one floor that way
  | { type: 'stop'; elevatorId: string } // stop here, open doors
  | { type: 'idle'; elevatorId: string }; // stay put, no target

export type DispatchHook = (snapshot: DispatchSnapshot) => DispatchAction[];
