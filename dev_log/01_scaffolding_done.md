# Unit 01: Scaffolding - Completion Context

## What Was Implemented

A working Vite + TypeScript project shell: `npm run dev` serves a placeholder page locally, `npm run build` produces a correctly-pathed static bundle (base `/L-vator/`), `npm run lint`/`format:check` enforce style via ESLint (flat config) + Prettier, `npm run test` runs Vitest against a placeholder test, and `.github/workflows/deploy.yml` builds/tests/deploys to GitHub Pages on push to `main`. No app logic beyond the placeholder page — pure infrastructure, as scoped.

## Key Decisions

- npm as package manager, Node 22 LTS pinned via `.nvmrc`.
- Repo name `L-vator`, reflected in Vite's `base: '/L-vator/'`.
- ESLint flat config (`eslint.config.js`) using the unified `typescript-eslint` meta-package, with `eslint-config-prettier` to avoid rule conflicts with Prettier.
- Vitest config lives inline in `vite.config.ts` (no separate `vitest.config.ts`), one placeholder test in `src/main.test.ts`.
- GitHub Actions workflow gates deploy on lint + test passing before build/deploy runs.

## Deviations from Plan

All deviations are minor and documented in full in `01_scaffolding.md`'s AI Interactions section; summary:

- Scaffolded into a scratch temp directory and merged files in, to avoid `create-vite`'s "directory not empty" prompt touching `.claude/`, `.git/`, or `dev_log/`.
- Current `create-vite` `vanilla-ts` template ships a much more elaborate demo page than expected (hero/counter/docs-links) — stripped down to a bare placeholder heading, matching the unit's "no UI beyond a placeholder" objective.
- Current template produces a single `tsconfig.json` rather than the plan's assumed root+node tsconfig split — used what the template actually generates; the plan's exact `tsc -b && vite build` script still works unchanged.
- Added `.claude/` to `.prettierignore` and `*.tsbuildinfo` to `.gitignore` — both necessary additions surfaced by actually running the verification commands, not contradictions of the plan.
- Local verification ran against Node v26.8.2 (no Node 22 available locally); CI/`.nvmrc` still pin to 22 LTS. Not a blocker, but the developer may want to install Node 22 locally via nvm/fnm to match CI exactly.

## Files Modified

See `01_scaffolding.md`'s Files Modified section for the full list. Created: `.nvmrc`, `.gitignore`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `vite.config.ts`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `src/main.ts`, `src/main.test.ts`, `src/style.css`, `public/favicon.svg`, `.github/workflows/deploy.yml`, `dev_log/01_scaffolding_test.md`. Modified: `dev_log/01_scaffolding.md`.

## Integration Notes

The GitHub Actions Pages deploy workflow was written and reviewed but never executed — this unit stayed local-only per developer instruction (committed, not pushed). Once pushed, the developer still needs to set the repo's Settings → Pages → Source to "GitHub Actions" (one-time manual GitHub UI step, not committable) for the workflow to actually publish. The Integration Checks in `01_scaffolding_test.md` cover this post-push validation and remain unexecuted until the developer pushes.

## Lessons Learned

`create-vite`'s scaffolded output (template content, tsconfig structure, ESLint package shape) drifts from what any given plan assumes since it tracks upstream tooling versions — future unit plans that specify exact generated-file shapes should expect to verify against what the tool actually produces at implementation time rather than treating the plan's sketch as literal. Running the actual verification commands (not just writing config) surfaced two necessary additions (`.prettierignore` entry, `.gitignore` entry) that a purely plan-following implementation would have missed.

## Amendment (during Unit 02 planning)

While drafting the Unit 02 (engine) plan, it surfaced that `tsconfig.json` did not actually have `"strict": true` set, despite this file's own "Key Decisions" implying strict mode was verified during Unit 01. Corrected by adding `"strict": true` to `compilerOptions`, ahead of Unit 02 introducing the project's first real typed state model. Re-verified `npm run build`, `npm run lint`, `npm run test`, and `npm run format:check` all still pass with strict mode on — no code needed changes since there was no application logic yet. Committed separately from this unit's original commit.

## Amendment (after Unit 08, at developer request)

`.nvmrc` bumped from `22` to `26` at the developer's request, to track the latest Node version rather than the LTS that happened to be current when this unit was originally implemented (the local environment had already moved to Node v26.8.2 by this point — see Unit 01's own "Local verification ran against Node v26.8.2" note above, which was already ahead of `.nvmrc` at the time). Since `.github/workflows/deploy.yml`'s `actions/setup-node` step reads `node-version-file: '.nvmrc'`, this single-file change updates CI too — no other file needed changes. Re-verified `npm run lint`, `npm run format:check`, `npm run test` (177/177), and `npm run build` all pass unchanged.
