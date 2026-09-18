// Core state model for the simulation engine.
//
// Plain data only, no classes: this is the "functional core" for the whole project
// (see dev_log/02_engine.md, "State model"). Transitions live in simulation.ts as
// functions that read and produce this data; nothing here carries behavior.

/** 0-indexed floor number. 0 is always the ground floor. */
export type FloorIndex = number;

/** Direction of travel, or the direction a hall call / waiting passenger is bound for. */
export type Direction = 'up' | 'down';

export interface BuildingConfig {
  /**
   * Floors ABOVE ground. Valid FloorIndex values are 0..floorCount inclusive
   * (floorCount + 1 total levels) — e.g. floorCount: 5 means indices 0 (ground) through 5.
   */
  floorCount: number;
  elevatorCount: number;
  capacity: number;
  floorTravelTimeMs: number;
  doorDwellBaseMs: number;
  /** e.g. 0.5 for the default 50% */
  doorDwellPerPassengerMultiplier: number;
  /**
   * How long (ms) an elevator must sit idle before a homing dispatch algorithm sends it back to
   * the lobby (floor 0, hardcoded — see dev_log/10_homing_algorithms.md's resolved open
   * questions). Read only by the three `*Homing.ts` algorithms; every other algorithm ignores it,
   * exactly like they already ignore `time` for anything but tie-breaking-adjacent logic. `0` is
   * valid and meaningful ("return home immediately on going idle"), unlike `doorDwellBaseMs`.
   */
  idleReturnThresholdMs: number;
}

export interface Passenger {
  id: string;
  originFloor: FloorIndex;
  /** The hall-call direction they're waiting under. */
  direction: Direction;
  /** Sim time they started waiting. */
  waitingSince: number;
  /**
   * Known internally from creation time, never assigned/reassigned at boarding —
   * see dev_log/02_engine.md, "Passenger destinations and reproducibility".
   */
  destinationFloor: FloorIndex;
  boardedElevatorId?: string;
  boardedAt?: number;
  alightedAt?: number;
}

export type ElevatorMachineState = 'idle' | 'moving' | 'doorsOpen' | 'doorsClosed';

export interface ElevatorState {
  id: string;
  currentFloor: FloorIndex;
  state: ElevatorMachineState;
  /** Travel/last-committed direction; null only when truly idle. */
  direction: Direction | null;
  onboard: Passenger[];
  /** Destinations requested by onboard passengers. */
  carButtons: Set<FloorIndex>;
}

export interface HallCall {
  floor: FloorIndex;
  /** Presence only — no count, by design. */
  direction: Direction;
}

export interface BuildingState {
  time: number;
  elevators: ElevatorState[];
  /** Full internal ground truth (has identities/counts). Never exposed to a dispatch hook. */
  waitingPassengers: Passenger[];
}

/**
 * One hand-authored (or, in later units, generated) passenger arrival: everything about the
 * passenger — including their destination — is decided up front, together, at record-authoring
 * time. This is what `ScriptedInput` is made of; see "Passenger destinations and reproducibility"
 * in dev_log/02_engine.md for why destinations are never assigned later, e.g. at boarding time.
 */
export interface PassengerArrival {
  id: string;
  originFloor: FloorIndex;
  direction: Direction;
  destinationFloor: FloorIndex;
  /** Sim time this passenger arrives and registers their hall call. */
  arrivalTime: number;
}

/**
 * This unit's hand-authored test fixtures; later, Unit 04's real seeded generator will produce
 * the same shape.
 */
export type ScriptedInput = PassengerArrival[];

/**
 * A flat, timestamped record of what actually happened during the run, for later replay/metrics
 * (Unit 07). Built by `runSimulation` as it processes scheduled events.
 */
export type SimEventLogEntry =
  | { type: 'hallCallRegistered'; time: number; floor: FloorIndex; direction: Direction }
  | { type: 'elevatorArrived'; time: number; elevatorId: string; floor: FloorIndex }
  | { type: 'doorsOpened'; time: number; elevatorId: string; floor: FloorIndex }
  | {
      type: 'passengerBoarded';
      time: number;
      elevatorId: string;
      floor: FloorIndex;
      passengerId: string;
    }
  | {
      type: 'passengerAlighted';
      time: number;
      elevatorId: string;
      floor: FloorIndex;
      passengerId: string;
    }
  | { type: 'doorsClosed'; time: number; elevatorId: string; floor: FloorIndex }
  | { type: 'hallCallCleared'; time: number; floor: FloorIndex; direction: Direction };
