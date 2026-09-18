// Public barrel export — what later units import. See dev_log/02_engine.md, "Public API".
//
// Deliberately excludes eventQueue.ts (an internal scheduling mechanism, not part of the seam)
// and testFixtures.ts (test-only scaffolding — Units 03/04 own the real dispatch algorithm and
// call generator, respectively).

export { runSimulation } from './simulation';
export type { RunSimulationOptions, RunSimulationResult } from './simulation';

export type {
  BuildingConfig,
  BuildingState,
  Direction,
  ElevatorMachineState,
  ElevatorState,
  FloorIndex,
  HallCall,
  Passenger,
  PassengerArrival,
  ScriptedInput,
  SimEventLogEntry,
} from './types';

export type { DispatchAction, DispatchHook, DispatchSnapshot, ElevatorSnapshot } from './dispatch';

export { createRng } from './rng';
export type { Rng, Seed } from './rng';
