// DOM: play/pause, speed selector, scrub/seek, trial selector, algorithm selector. Owns its own
// requestAnimationFrame loop -- see dev_log/07_results.md, "A new pattern for app.ts's render
// cycle": this loop patches only replayCrossSection.ts's own elements via update(frame) and never
// calls the outer render(), since calling the outer render() every frame would rebuild the
// entire app tree many times a second.
//
// Lifecycle: the loop self-terminates the first frame after its own root element is no longer
// connected to the document (`!wrapper.isConnected`) -- which happens whenever app.ts's outer
// render() rebuilds the tree for an unrelated structural reason (e.g. editing the config panel
// while a replay is on screen). This avoids leaking a zombie rAF loop per re-render without
// requiring app.ts/resultsView.ts to plumb an explicit stop() callback back out.

import { algorithms } from '../../algorithms';
import { advanceSimTime, clampSimTime, SPEED_OPTIONS } from './replayClock';
import { computeReplayFrame, type GroupedLog } from './replayFrame';
import type { CrossSectionHandle } from './replayCrossSection';
import type { ReplaySelection } from '../types';

export interface ReplayControlsOptions {
  render: () => void;
  replay: ReplaySelection;
  groupedLog: GroupedLog;
  maxTimeMs: number;
  trialCount: number;
  algorithmIds: string[];
  crossSection: CrossSectionHandle;
}

function algorithmName(id: string): string {
  return algorithms.find((algorithm) => algorithm.id === id)?.name ?? id;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function renderReplayControls(options: ReplayControlsOptions): HTMLElement {
  const { render, replay, groupedLog, maxTimeMs, trialCount, algorithmIds, crossSection } = options;

  const wrapper = document.createElement('div');

  // Algorithm selector -- switching is structural (changes which trial's log is grouped), so it
  // goes through the outer render() like Unit 06's other structural dropdowns.
  const algorithmRow = document.createElement('div');
  algorithmRow.appendChild(document.createTextNode('Algorithm: '));
  const algorithmSelect = document.createElement('select');
  for (const id of algorithmIds) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = algorithmName(id);
    option.selected = id === replay.algorithmId;
    algorithmSelect.appendChild(option);
  }
  algorithmSelect.onchange = () => {
    replay.algorithmId = algorithmSelect.value;
    replay.trialIndex = 0;
    replay.simTimeMs = 0;
    replay.playing = false;
    render();
  };
  algorithmRow.appendChild(algorithmSelect);
  wrapper.appendChild(algorithmRow);

  // Trial selector -- "Run N of M", also structural.
  const trialRow = document.createElement('div');
  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.textContent = 'Prev';
  prevButton.disabled = replay.trialIndex <= 0;
  prevButton.onclick = () => {
    replay.trialIndex -= 1;
    replay.simTimeMs = 0;
    replay.playing = false;
    render();
  };
  const trialLabel = document.createElement('span');
  trialLabel.textContent = ` Run ${replay.trialIndex + 1} of ${trialCount} `;
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = 'Next';
  nextButton.disabled = replay.trialIndex >= trialCount - 1;
  nextButton.onclick = () => {
    replay.trialIndex += 1;
    replay.simTimeMs = 0;
    replay.playing = false;
    render();
  };
  trialRow.appendChild(prevButton);
  trialRow.appendChild(trialLabel);
  trialRow.appendChild(nextButton);
  wrapper.appendChild(trialRow);

  // Play/pause, speed, scrub -- all handled by direct mutation of the shared state.replay object
  // plus this instance's own rAF loop, without calling the outer render() (see module doc
  // comment): the loop already reads state.replay.playing/speed/simTimeMs live every frame, so no
  // rebuild is needed for any of these to take effect.
  const playbackRow = document.createElement('div');

  const playButton = document.createElement('button');
  playButton.type = 'button';
  function syncPlayButton(): void {
    playButton.textContent = replay.playing ? 'Pause' : 'Play';
  }
  syncPlayButton();
  playButton.onclick = () => {
    if (!replay.playing && replay.simTimeMs >= maxTimeMs) {
      replay.simTimeMs = 0; // pressing Play again after reaching the end restarts from 0
    }
    replay.playing = !replay.playing;
    syncPlayButton();
  };
  playbackRow.appendChild(playButton);

  const speedSelect = document.createElement('select');
  for (const speed of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed}x`;
    option.selected = speed === replay.speed;
    speedSelect.appendChild(option);
  }
  speedSelect.onchange = () => {
    replay.speed = Number(speedSelect.value);
  };
  playbackRow.appendChild(speedSelect);

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(maxTimeMs);
  scrub.step = '1';
  scrub.value = String(replay.simTimeMs);
  scrub.style.width = '18rem';
  scrub.style.verticalAlign = 'middle';
  scrub.oninput = () => {
    replay.simTimeMs = clampSimTime(Number(scrub.value), maxTimeMs);
    replay.playing = false; // scrubbing pauses -- avoids the loop's own time advance fighting it
    syncPlayButton();
  };
  playbackRow.appendChild(scrub);

  const timeLabel = document.createElement('span');
  timeLabel.style.marginLeft = '0.5rem';
  playbackRow.appendChild(timeLabel);

  wrapper.appendChild(playbackRow);

  let lastTimestamp: number | null = null;

  function frameLoop(now: number): void {
    if (!wrapper.isConnected) return; // stale instance from a prior render() -- stop for good

    if (lastTimestamp === null) lastTimestamp = now;
    const elapsedRealMs = now - lastTimestamp;
    lastTimestamp = now;

    if (replay.playing) {
      const next = advanceSimTime(replay.simTimeMs, elapsedRealMs, replay.speed, maxTimeMs);
      replay.simTimeMs = next;
      if (next >= maxTimeMs) {
        replay.playing = false;
        syncPlayButton();
      }
    }

    scrub.value = String(replay.simTimeMs);
    timeLabel.textContent = `${formatClock(replay.simTimeMs)} / ${formatClock(maxTimeMs)}`;

    crossSection.update(computeReplayFrame(groupedLog, replay.simTimeMs));

    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  return wrapper;
}
