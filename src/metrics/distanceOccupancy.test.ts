import { describe, expect, it } from 'vitest';
import type { SimEventLogEntry } from '../engine';
import { computeDistanceOccupancy } from './distanceOccupancy';

function arrived(elevatorId: string, floor: number, time: number): SimEventLogEntry {
  return { type: 'elevatorArrived', time, elevatorId, floor };
}
function boarded(
  elevatorId: string,
  passengerId: string,
  floor: number,
  time: number,
): SimEventLogEntry {
  return { type: 'passengerBoarded', time, elevatorId, floor, passengerId };
}
function alighted(
  elevatorId: string,
  passengerId: string,
  floor: number,
  time: number,
): SimEventLogEntry {
  return { type: 'passengerAlighted', time, elevatorId, floor, passengerId };
}

describe('computeDistanceOccupancy', () => {
  it('reconstructs hop occupancy for a single elevator with a known hop sequence (hand-computed)', () => {
    const capacity = 4;
    // Hop-by-hop story, hand-traced against the engine's real event ordering (elevatorArrived is
    // always logged BEFORE the boarding/alighting that happens once doors open at that floor —
    // see dev_log/05_metrics.md and simulation.ts's handleElevatorArrived/handleStop):
    //   floor0: board a,b,c,d (onboard 0 -> 4)
    //   hop 0->1: carries 4                          -> elevatorArrived floor1, occupancy 4
    //   floor1: alight a,b (onboard 4 -> 2)
    //   hop 1->2: carries 2                          -> elevatorArrived floor2, occupancy 2
    //   floor2: no transaction
    //   hop 2->3: carries 2 (still a,b... c,d)        -> elevatorArrived floor3, occupancy 2
    //   floor3: alight c,d (onboard 2 -> 0)
    //   hop 3->4: carries nobody (deadhead)           -> elevatorArrived floor4, occupancy 0
    const log: SimEventLogEntry[] = [
      boarded('E1', 'a', 0, 0),
      boarded('E1', 'b', 0, 0),
      boarded('E1', 'c', 0, 0),
      boarded('E1', 'd', 0, 0),
      arrived('E1', 1, 1000),
      alighted('E1', 'a', 1, 1000),
      alighted('E1', 'b', 1, 1000),
      arrived('E1', 2, 2000),
      arrived('E1', 3, 3000),
      alighted('E1', 'c', 3, 3000),
      alighted('E1', 'd', 3, 3000),
      arrived('E1', 4, 4000),
    ];

    const result = computeDistanceOccupancy(log, ['E1'], capacity);

    expect(result.totalDistanceFloors).toBe(4);
    // mean([4/4, 2/4, 2/4, 0/4]) * 100 = mean([1, .5, .5, 0]) * 100 = 50
    expect(result.averageOccupancyWhileMovingPct).toBe(50);
    // 1 of 4 hops has occupancy 0
    expect(result.deadheadTravelPct).toBe(25);
  });

  it('pools hops across multiple elevators', () => {
    const capacity = 4;
    const log: SimEventLogEntry[] = [
      // E1: one hop, occupancy 2
      boarded('E1', 'p1', 0, 0),
      boarded('E1', 'p2', 0, 0),
      arrived('E1', 1, 1000),
      // E2: one hop, occupancy 0 (deadhead)
      arrived('E2', 1, 500),
    ];

    const result = computeDistanceOccupancy(log, ['E1', 'E2'], capacity);

    expect(result.totalDistanceFloors).toBe(2);
    // mean([2/4, 0/4]) * 100 = 25
    expect(result.averageOccupancyWhileMovingPct).toBe(25);
    expect(result.deadheadTravelPct).toBe(50);
  });

  it('returns null (not NaN/0) for averageOccupancyWhileMovingPct/deadheadTravelPct with zero hops', () => {
    const log: SimEventLogEntry[] = [
      { type: 'hallCallRegistered', time: 0, floor: 0, direction: 'up' },
      boarded('E1', 'p1', 0, 0),
    ];

    const result = computeDistanceOccupancy(log, ['E1'], 4);

    expect(result.totalDistanceFloors).toBe(0);
    expect(result.averageOccupancyWhileMovingPct).toBeNull();
    expect(result.deadheadTravelPct).toBeNull();
  });

  it('returns all-null/zero for an empty log', () => {
    const result = computeDistanceOccupancy([], ['E1'], 4);
    expect(result).toEqual({
      totalDistanceFloors: 0,
      averageOccupancyWhileMovingPct: null,
      deadheadTravelPct: null,
    });
  });
});
