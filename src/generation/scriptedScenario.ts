// Loads/validates a ScriptedScenario's fixed script. Trivial by design — scripted scenarios are
// already in the exact ScriptedInput shape the engine consumes. See dev_log/04_generation.md,
// "Scripted scenario loading: scriptedScenario.ts".

import type { BuildingConfig, FloorIndex, ScriptedInput } from '../engine';
import type { ScriptedScenario } from './types';

/**
 * Minimal validation, not in the original engine scope but cheap and catches authoring mistakes
 * at the source: fail fast on a bad hand-authored fixture rather than letting the engine hit an
 * out-of-bounds error deep into a run.
 */
function checkFloorBounds(
  arrivalId: string,
  label: 'originFloor' | 'destinationFloor',
  floor: FloorIndex,
  floorCount: number,
): void {
  if (floor < 0 || floor > floorCount) {
    throw new Error(
      `Scripted arrival "${arrivalId}" has ${label} ${floor} out of bounds [0, ${floorCount}]`,
    );
  }
}

function validateScript(building: BuildingConfig, script: ScriptedInput): void {
  for (const arrival of script) {
    checkFloorBounds(arrival.id, 'originFloor', arrival.originFloor, building.floorCount);
    checkFloorBounds(arrival.id, 'destinationFloor', arrival.destinationFloor, building.floorCount);
    if (arrival.originFloor === arrival.destinationFloor) {
      throw new Error(
        `Scripted arrival "${arrival.id}" has originFloor === destinationFloor ` +
          `(${arrival.originFloor})`,
      );
    }
  }
}

export function loadScriptedScenario(scenario: ScriptedScenario): ScriptedInput {
  validateScript(scenario.building, scenario.script);
  return scenario.script;
}
