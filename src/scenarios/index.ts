// Discovers scenario files automatically at build time via Vite's `import.meta.glob` — mirrors
// src/algorithms/index.ts's mechanism exactly, for the same reason Unit 03 adopted it: adding a
// scenario is "drop a file," no manual registry edit. See dev_log/04_generation.md, "Scenario
// discovery mechanism".

import type { Scenario } from '../generation/types';

// Eagerly imports every sibling file except itself and tests — so only files meant to BE a
// scenario are considered. A file that doesn't export `scenario` (or exports something that
// doesn't match the Scenario shape) is silently excluded rather than erroring.
const modules = import.meta.glob<{ scenario?: Scenario }>(
  ['./*.ts', '!./index.ts', '!./*.test.ts'],
  {
    eager: true,
  },
);

export const scenarios: Scenario[] = Object.values(modules)
  .map((m) => m.scenario)
  .filter((s): s is Scenario => s !== undefined);

export type { Scenario } from '../generation/types';
