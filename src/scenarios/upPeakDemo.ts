// Minimal example scripted scenario. See dev_log/04_generation.md, "Scripted scenario data:
// src/scenarios/".

import type { ScriptedScenario } from '../generation/types';

export const scenario: ScriptedScenario = {
  type: 'scripted',
  building: {
    floorCount: 5,
    elevatorCount: 1,
    capacity: 4,
    floorTravelTimeMs: 2000,
    doorDwellBaseMs: 3000,
    doorDwellPerPassengerMultiplier: 0.5,
  },
  trialCount: 1,
  script: [
    { id: 'p1', originFloor: 0, direction: 'up', destinationFloor: 3, arrivalTime: 0 },
    { id: 'p2', originFloor: 0, direction: 'up', destinationFloor: 5, arrivalTime: 1000 },
    { id: 'p3', originFloor: 3, direction: 'down', destinationFloor: 0, arrivalTime: 8000 },
  ],
};
