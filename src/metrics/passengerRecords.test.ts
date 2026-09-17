import { describe, expect, it } from 'vitest';
import type { Passenger, ScriptedInput, SimEventLogEntry } from '../engine';
import { buildPassengerRecords } from './passengerRecords';

describe('buildPassengerRecords', () => {
  const arrivals: ScriptedInput = [
    { id: 'served', originFloor: 0, direction: 'up', destinationFloor: 2, arrivalTime: 100 },
    { id: 'boardedOnly', originFloor: 0, direction: 'up', destinationFloor: 1, arrivalTime: 200 },
    {
      id: 'neverBoarded',
      originFloor: 1,
      direction: 'down',
      destinationFloor: 0,
      arrivalTime: 300,
    },
  ];

  const log: SimEventLogEntry[] = [
    { type: 'hallCallRegistered', time: 100, floor: 0, direction: 'up' },
    { type: 'doorsOpened', time: 500, elevatorId: 'E1', floor: 0 },
    { type: 'passengerBoarded', time: 500, elevatorId: 'E1', floor: 0, passengerId: 'served' },
    { type: 'doorsClosed', time: 500, elevatorId: 'E1', floor: 0 },
    { type: 'doorsOpened', time: 600, elevatorId: 'E1', floor: 0 },
    { type: 'passengerBoarded', time: 600, elevatorId: 'E1', floor: 0, passengerId: 'boardedOnly' },
    { type: 'doorsClosed', time: 600, elevatorId: 'E1', floor: 0 },
    { type: 'doorsOpened', time: 900, elevatorId: 'E1', floor: 2 },
    { type: 'passengerAlighted', time: 900, elevatorId: 'E1', floor: 2, passengerId: 'served' },
    { type: 'doorsClosed', time: 900, elevatorId: 'E1', floor: 2 },
  ];

  const finalTimeMs = 1000;

  it('classifies a served passenger with exact waitTimeMs/travelTimeMs', () => {
    const records = buildPassengerRecords(arrivals, log, finalTimeMs);
    const served = records.find((r) => r.id === 'served');
    expect(served).toEqual({
      id: 'served',
      status: 'served',
      waitTimeMs: 400, // boardedAt(500) - arrivalTime(100)
      travelTimeMs: 400, // alightedAt(900) - boardedAt(500)
    });
  });

  it('classifies a boarded-not-alighted passenger with exact waitTimeMs, no travelTimeMs', () => {
    const records = buildPassengerRecords(arrivals, log, finalTimeMs);
    const boardedOnly = records.find((r) => r.id === 'boardedOnly');
    expect(boardedOnly).toEqual({
      id: 'boardedOnly',
      status: 'boardedOnly',
      waitTimeMs: 400, // boardedAt(600) - arrivalTime(200)
    });
  });

  it('classifies a never-boarded passenger with exact censoredWaitMs, no waitTimeMs/travelTimeMs', () => {
    const records = buildPassengerRecords(arrivals, log, finalTimeMs);
    const neverBoarded = records.find((r) => r.id === 'neverBoarded');
    expect(neverBoarded).toEqual({
      id: 'neverBoarded',
      status: 'neverBoarded',
      censoredWaitMs: 700, // finalTimeMs(1000) - arrivalTime(300)
    });
  });

  it('returns exactly one record per arrival, in arrival order', () => {
    const records = buildPassengerRecords(arrivals, log, finalTimeMs);
    expect(records.map((r) => r.id)).toEqual(['served', 'boardedOnly', 'neverBoarded']);
  });

  describe('consistency check against a hand-built finalState ground truth', () => {
    // Ground-truth Passenger objects mirroring what runSimulation would have left behind at the
    // end of a run using this exact arrivals/log fixture: 'neverBoarded' still waiting, and
    // 'boardedOnly' still onboard an elevator (see dev_log/05_metrics.md, "Wait/travel time and
    // passenger status", point 3).
    const waitingPassenger: Passenger = {
      id: 'neverBoarded',
      originFloor: 1,
      direction: 'down',
      waitingSince: 300,
      destinationFloor: 0,
    };
    const onboardPassenger: Passenger = {
      id: 'boardedOnly',
      originFloor: 0,
      direction: 'up',
      waitingSince: 200,
      destinationFloor: 1,
      boardedElevatorId: 'E1',
      boardedAt: 600,
    };

    it("neverBoarded record ids exactly match finalState.waitingPassengers' ids", () => {
      const records = buildPassengerRecords(arrivals, log, finalTimeMs);
      const neverBoardedIds = records
        .filter((r) => r.status === 'neverBoarded')
        .map((r) => r.id)
        .sort();
      const waitingIds = [waitingPassenger].map((p) => p.id).sort();
      expect(neverBoardedIds).toEqual(waitingIds);
    });

    it('boardedOnly record ids exactly match the union of finalState.elevators[].onboard ids', () => {
      const records = buildPassengerRecords(arrivals, log, finalTimeMs);
      const boardedOnlyIds = records
        .filter((r) => r.status === 'boardedOnly')
        .map((r) => r.id)
        .sort();
      const onboardIds = [onboardPassenger].map((p) => p.id).sort();
      expect(boardedOnlyIds).toEqual(onboardIds);
    });
  });
});
