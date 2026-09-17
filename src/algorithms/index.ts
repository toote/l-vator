// Discovers algorithm files automatically at build time via Vite's `import.meta.glob` — no
// manually maintained registry to keep in sync. See dev_log/03_algorithms.md, "Discovery".

import type { Algorithm } from './types';

// Eagerly imports every sibling file except itself, the shared type/helper files, and tests —
// so only files meant to BE an algorithm are considered. A file that doesn't export `algorithm`
// (or exports something that doesn't match the Algorithm shape) is silently excluded rather than
// erroring, so types.ts/shared.ts can't accidentally end up in the list even if the glob pattern
// were ever loosened.
const modules = import.meta.glob<{ algorithm?: Algorithm }>(
  ['./*.ts', '!./index.ts', '!./types.ts', '!./shared.ts', '!./*.test.ts'],
  { eager: true },
);

export const algorithms: Algorithm[] = Object.values(modules)
  .map((m) => m.algorithm)
  .filter((a): a is Algorithm => a !== undefined);

export type { Algorithm } from './types';
