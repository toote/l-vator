// The common per-file export shape every dispatch algorithm implements. See
// dev_log/03_algorithms.md, "Common interface: Algorithm".

import type { DispatchHook } from '../engine';

export interface Algorithm {
  /** Stable key, e.g. 'fcfs-nearest-car'. */
  id: string;
  /** Display name, e.g. "FCFS / Nearest Car" — for a future UI (Unit 06) to list. */
  name: string;
  /**
   * One or two plain-language sentences explaining how this algorithm actually decides who
   * serves each call — shown in the algorithm-selection UI (see algorithmSelect.ts) so a reader
   * unfamiliar with the codebase can build real intuition about what they're comparing, per this
   * project's teaching-first objective (00_main.md's "What This Is"). Describes current, real
   * behavior — keep in sync with the algorithm's own file whenever its dispatch logic changes.
   */
  description: string;
  /**
   * Factory rather than a bare hook: two of the three algorithms need per-run assignment
   * memory held in a closure, and a fresh factory call per trial is required for Unit 04's
   * seeded multi-trial fairness guarantee (each trial starts with empty memory, never one
   * carried over from a previous trial). See dev_log/03_algorithms.md for the full rationale.
   */
  createHook: () => DispatchHook;
}
