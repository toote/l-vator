// Per-passenger classification for one trial. See dev_log/05_metrics.md, "Wait/travel time and
// passenger status (passengerRecords.ts)" and "Per-passenger arrival time: a real gap, and how
// this unit closes it without touching other layers".
//
// `arrivals` here is the regenerated ScriptedInput for this trial's specific trialIndex (from
// computeMetrics.ts's single `generateTrialBatch(scenario)` call) -- it carries every passenger's
// true `arrivalTime`, which is otherwise unrecoverable from `log`/`finalState` alone for
// fully-served passengers (boarded AND alighted before the run ended).

import type { ScriptedInput, SimEventLogEntry } from '../engine';
import type { PassengerRecord } from './types';

/**
 * Classifies every passenger in `arrivals` (the full population for this trial, including
 * never-served passengers) using the log's `passengerBoarded`/`passengerAlighted` entries:
 *
 * - alighted present            -> 'served', waitTimeMs = boardedAt - arrivalTime,
 *                                  travelTimeMs = alightedAt - boardedAt
 * - boarded present, no alight  -> 'boardedOnly', waitTimeMs = boardedAt - arrivalTime
 * - neither present             -> 'neverBoarded', censoredWaitMs = finalTimeMs - arrivalTime
 *   (a lower bound on true wait -- see dev_log/05_metrics.md, "Never-served passengers")
 *
 * A passenger boards at most once and alights at most once, by construction (engine invariant),
 * so `boardedAt`/`alightedAt` below are built as ordinary one-entry-per-id maps.
 */
export function buildPassengerRecords(
  arrivals: ScriptedInput,
  log: readonly SimEventLogEntry[],
  finalTimeMs: number,
): PassengerRecord[] {
  const boardedAt = new Map<string, number>();
  const alightedAt = new Map<string, number>();
  for (const entry of log) {
    if (entry.type === 'passengerBoarded') {
      boardedAt.set(entry.passengerId, entry.time);
    } else if (entry.type === 'passengerAlighted') {
      alightedAt.set(entry.passengerId, entry.time);
    }
  }

  return arrivals.map((arrival): PassengerRecord => {
    const boarded = boardedAt.get(arrival.id);
    const alighted = alightedAt.get(arrival.id);

    if (boarded !== undefined && alighted !== undefined) {
      return {
        id: arrival.id,
        status: 'served',
        waitTimeMs: boarded - arrival.arrivalTime,
        travelTimeMs: alighted - boarded,
      };
    }
    if (boarded !== undefined) {
      return {
        id: arrival.id,
        status: 'boardedOnly',
        waitTimeMs: boarded - arrival.arrivalTime,
      };
    }
    return {
      id: arrival.id,
      status: 'neverBoarded',
      censoredWaitMs: finalTimeMs - arrival.arrivalTime,
    };
  });
}
