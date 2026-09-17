// Single-panel replay orchestrator: one cross-section for the currently selected
// algorithm/trial. See dev_log/07_results.md, "File layout" and "Side-by-side replay" (deferred,
// not built here -- one algorithm, one trial, at a time).

import { renderCrossSection } from './replayCrossSection';
import { renderReplayControls } from './replayControls';
import { groupReplayLog } from './replayFrame';
import type { AppState } from '../types';

export function renderReplayView(state: AppState, render: () => void): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h3');
  heading.textContent = 'Replay';
  section.appendChild(heading);

  const { run, replay } = state;
  if (run.status !== 'done' || !replay) {
    const message = document.createElement('p');
    message.textContent = 'Run a scenario above to replay it.';
    section.appendChild(message);
    return section;
  }

  const trialResult = run.trialResults.find(
    (result) =>
      result.algorithmId === replay.algorithmId && result.trialIndex === replay.trialIndex,
  );
  if (!trialResult) {
    // Shouldn't normally happen -- runControls.ts always initializes replay to a valid
    // algorithm/trial when a run completes -- but fail visibly rather than silently, just in
    // case a future change leaves replay pointing at a combination this run doesn't have.
    const message = document.createElement('p');
    message.textContent = 'Selected run not found.';
    section.appendChild(message);
    return section;
  }

  const algorithmIds = Array.from(new Set(run.trialResults.map((result) => result.algorithmId)));
  const trialCount = run.trialResults.filter(
    (result) => result.algorithmId === replay.algorithmId,
  ).length;

  const elevatorIds = trialResult.result.finalState.elevators.map((elevator) => elevator.id);
  const groupedLog = groupReplayLog(trialResult.result.log, elevatorIds);
  const maxTimeMs = trialResult.result.finalState.time;

  const crossSection = renderCrossSection(run.building, elevatorIds);

  const controls = renderReplayControls({
    render,
    replay,
    groupedLog,
    maxTimeMs,
    trialCount,
    algorithmIds,
    crossSection,
  });

  section.appendChild(controls);
  section.appendChild(crossSection.root);
  return section;
}
