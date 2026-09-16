# Unit 01: Scaffolding

## Objective

Stand up the empty project shell that every later unit builds on: a Vite + TypeScript app with linting, formatting, testing, and an automated deploy pipeline all wired and verified working — before any simulation, algorithm, or UI code exists. Concretely, this unit delivers a repo where:

- `npm run dev` serves a blank page locally,
- `npm run build` produces a static bundle,
- `npm run lint` / `npm run format` enforce style,
- `npm run test` runs Vitest (against one placeholder test, to prove the harness works),
- a push to `main` builds and deploys the bundle to GitHub Pages automatically.

No app logic, no engine, no UI beyond a placeholder — this unit is infrastructure only. It's first because every subsequent unit (engine, algorithms, UI, tests) assumes this scaffold already exists and works; getting it wrong now (e.g. a Pages base-path misconfiguration) is cheap to fix today and expensive to untangle later once real code depends on it.

## Implementation

### Open questions for the developer (not yet decided in 00_main.md)

These need an answer before/while implementing — flagging rather than deciding unilaterally:

1. **Package manager**: 00_main.md doesn't specify npm vs pnpm vs yarn. Proposal: plain **npm** (ships with Node, zero extra tooling, simplest for a solo teaching-focused project). Will use npm unless told otherwise.
2. **GitHub repo name / org**: `L-vator` (confirmed by developer). Deployed as a project site, so Vite `base: '/L-vator/'` and Pages URL `https://<account>.github.io/L-vator/`.
3. **Node version**: propose pinning to **Node 22 LTS** (current LTS as of this plan) via `.nvmrc` and matching it in the Actions workflow's `actions/setup-node`. Open to a different LTS if the developer has a preference.
4. **Package manager lockfile commit**: assuming `package-lock.json` is committed (standard practice) — flagging only because it affects what "Files Modified" will include later.

If the developer doesn't push back on the proposals above, implementation proceeds with them as stated.

### Directory/file layout (target end state)

```
elevator/
├── .nvmrc
├── .gitignore
├── .eslintrc.cjs            (or eslint.config.js if flat config — see below)
├── .prettierrc.json
├── .prettierignore
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts         (or merged into vite.config.ts)
├── src/
│   ├── main.ts
│   └── main.test.ts         (placeholder test proving Vitest works)
├── public/
│   └── .gitkeep              (or favicon, if trivial)
├── dev_log/                  (already exists — untouched by this unit)
└── .github/
    └── workflows/
        └── deploy.yml
```

### Tool choices and config decisions

- **Scaffold base**: `npm create vite@latest . -- --template vanilla-ts`. This matches the agreed stack (vanilla TS + Vite, no framework) and gives a minimal `index.html` / `src/main.ts` starting point rather than hand-rolling config from scratch.
- **TypeScript**: use the `tsconfig.json` Vite's `vanilla-ts` template generates (strict mode on) as the base; verify `"strict": true` is set explicitly since later units (engine/algorithms) benefit from strict typing.
- **Linting — ESLint**: `eslint` + `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`, using **flat config** (`eslint.config.js`) since that's the current ESLint default/recommended approach going forward rather than the legacy `.eslintrc.cjs`. Add `eslint-config-prettier` to disable stylistic rules that would conflict with Prettier (division of labor: ESLint for correctness/code-quality, Prettier for formatting).
- **Formatting — Prettier**: `prettier` with a `.prettierrc.json` (defaults are fine to start: 2-space indent, semicolons, single quotes — can be adjusted on developer feedback) and a `.prettierignore` excluding `dist/`, `node_modules/`, `dev_log/`.
- **Testing — Vitest**: `vitest` added as a dev dependency. Since this is a Vite project, Vitest config is added directly into `vite.config.ts` under a `test:` key (simplest — avoids a second config file and keeps Vite/Vitest settings from drifting apart) rather than a separate `vitest.config.ts`. One placeholder test (`src/main.test.ts`) asserting something trivial (e.g. `1 + 1 === 2` or a DOM smoke check) exists purely to prove `npm run test` runs and passes in CI — it gets deleted/replaced once Unit 02 introduces real code to test.
- **npm scripts** in `package.json`:
  - `dev`: `vite`
  - `build`: `tsc -b && vite build`
  - `preview`: `vite preview`
  - `lint`: `eslint .`
  - `format`: `prettier --write .`
  - `format:check`: `prettier --check .`
  - `test`: `vitest run`
  - `test:watch`: `vitest`
- **GitHub Actions — Pages deploy** (`.github/workflows/deploy.yml`): triggered on `push` to `main`. Uses the standard official Pages deploy pattern:
  1. Checkout (`actions/checkout@v4`)
  2. `actions/setup-node@v4` pinned to the Node version from `.nvmrc`
  3. `npm ci`
  4. `npm run lint` and `npm run test` as gates — the deploy fails if either fails, so broken code never reaches Pages
  5. `npm run build`
  6. `actions/upload-pages-artifact@v3` on the `dist/` output
  7. `actions/deploy-pages@v4` (separate job with `needs:` the build job, using the `github-pages` environment, per GitHub's documented Pages Actions pattern)
  - Requires the repo's Settings → Pages → Source set to "GitHub Actions" (a one-time manual step in the GitHub UI the developer will need to do — not something committable).
- **`vite.config.ts` `base` option**: set to `/L-vator/` for correct asset paths on a project Pages site.
- **`.gitignore`**: `node_modules/`, `dist/`, `.DS_Store`, editor directories (`.vscode/` optional — may keep shared editor settings instead, developer's call).

### Order of implementation

1. Confirm open questions above with developer (repo name, package manager, Node version) — or proceed with stated proposals if no objection.
2. Scaffold via `npm create vite@latest . -- --template vanilla-ts`.
3. Add `.nvmrc`, adjust `.gitignore`.
4. Install and configure ESLint (flat config) + `@typescript-eslint` + `eslint-config-prettier`.
5. Install and configure Prettier (`.prettierrc.json`, `.prettierignore`); run once to confirm no conflicts with ESLint.
6. Add Vitest, wire `test:` block into `vite.config.ts`, write the one placeholder test, confirm `npm run test` passes.
7. Add all npm scripts to `package.json`.
8. Verify locally: `npm run dev`, `npm run build`, `npm run lint`, `npm run format:check`, `npm run test` all succeed.
9. Write `.github/workflows/deploy.yml`.
10. (Post-approval, first git push) Confirm Pages deploy succeeds end-to-end and the deployed URL serves the placeholder page — this validation step belongs to MDD Step 4 (Test and Validate), not this plan, but is noted here so the developer knows it's the acceptance bar for calling this unit done.

This unit produces no `_test.md` beyond what's implicit above (a placeholder Vitest test proving the harness works) — real test-instruction documents (`01_scaffolding_test.md`) will be written per MMDD Step 3 once implementation starts, covering exact manual verification steps (local commands + checking the live Pages URL).

## AI Interactions

Implemented by AI (Claude) per the approved plan above, with the following decisions/deviations made during implementation (no unresolved open questions were pushed back on by the developer, so the plan's proposals — npm, `L-vator` repo name, Node 22 LTS, committed lockfile — were used as stated):

- **Scaffolded into a scratch directory, then merged in.** Running `npm create vite@latest .` directly in `/Users/toote/src/elevator` would have hit the "directory not empty" prompt (because of `.claude/`, `.git/`, `dev_log/`). Instead, scaffolded into a temp scratch directory and copied only the generated `index.html`, `package.json`, `tsconfig.json`, `.gitignore`, `public/`, and `src/` into the project root — `.claude/`, `.git/`, and `dev_log/` were never touched by the scaffolder. Verified afterward via `git status` that no unexpected files/deletions appeared under those paths.
- **Simplified the default Vite template page.** The current `create-vite` `vanilla-ts` template (create-vite 9.2.1 / Vite 8) now scaffolds an elaborate marketing-style landing page (hero image, counter demo, docs/social link sections, ~5KB of CSS). That doesn't match the unit's objective of "a blank/placeholder page" and "no UI beyond a placeholder." Replaced `src/main.ts`, `index.html`, and `src/style.css` with a minimal placeholder (a heading + one line of text), and deleted `src/counter.ts` and the `src/assets/` image/logo files that the extra template sections depended on. Kept `public/favicon.svg` (trivial, matches the plan's "or favicon, if trivial" allowance) but removed `public/icons.svg` (only used by the removed docs/social sections).
- **`tsconfig.json` / `tsconfig.node.json`.** The plan's file layout listed a `tsconfig.node.json` (reflecting the older create-vite pattern of root + app + node tsconfigs joined by project references). The current create-vite template instead generates a single `tsconfig.json` covering `src/` only, with `vite.config.ts` untyped by `tsc` (it's fine at runtime — Vite transpiles it directly). Used the current template's single-`tsconfig.json` approach rather than hand-rolling the older 3-file pattern, since it's what `npm create vite@latest . -- --template vanilla-ts` actually produces today and is fully sufficient for this project. Confirmed the plan's exact `"build": "tsc -b && vite build"` script still works unchanged against this single tsconfig (`tsc -b` doesn't require `composite`/`references` to be present — it just builds the one project).
- **ESLint TypeScript integration package.** Installed the unified `typescript-eslint` meta-package (which bundles the parser, the plugin, and a `tseslint.config()` helper for flat config) rather than installing `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` as two separate packages. This is the currently-recommended way to consume `@typescript-eslint` under ESLint flat config; the plan named the two sub-packages descriptively rather than mandating a specific install shape.
- **`.prettierignore` additions.** The plan specified excluding `dist/`, `node_modules/`, `dev_log/`. Running `format:check` surfaced that Prettier was also trying to format `.claude/skills/**/*.yaml` (unrelated tooling files outside this unit's scope, not something this unit should reformat) — added `.claude/` to `.prettierignore` as well.
- **`.gitignore` addition.** Added `*.tsbuildinfo` beyond the plan's three entries (`node_modules/`, `dist/`, `.DS_Store`), since `tsc -b` (used by the `build` script exactly as specified in the plan) generates a `tsconfig.tsbuildinfo` build-cache file in the project root that shouldn't be committed.
- **`vite.config.ts` test config.** Used `test: { globals: false }` (explicit, matching Vitest's default) with the one placeholder test importing `describe`/`it`/`expect` directly from `vitest` rather than relying on injected globals — avoids needing a `vitest/globals` types entry in `tsconfig.json` for this minimal placeholder.
- Did not create `.vscode/` — plan left this as "developer's call" and it wasn't requested.
- Local verification ran against the locally-installed Node v26.8.2 (no Node 22 available via a version manager on this machine) since only `.nvmrc`/CI need to pin to 22 LTS; all scripts are version-agnostic enough that this doesn't affect correctness. The developer may want to install/switch to Node 22 locally via `nvm`/`fnm` to match CI exactly, but this isn't a blocker.
- Did not scaffold a GitHub repo, push, or run the Actions workflow — per instructions this unit stays local-only; the workflow file was written and reviewed for correctness but not executed. That's flagged as an Integration Check in `01_scaffolding_test.md` for after developer approval.

## Files Modified

Created (project root, unless noted):

- `.nvmrc`
- `.gitignore`
- `.prettierrc.json`
- `.prettierignore`
- `eslint.config.js`
- `vite.config.ts`
- `index.html`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/main.ts`
- `src/main.test.ts`
- `src/style.css`
- `public/favicon.svg`
- `.github/workflows/deploy.yml`
- `dev_log/01_scaffolding_test.md`

Modified:

- `dev_log/01_scaffolding.md` (this file — AI Interactions, Files Modified, Status sections)

Not committed to git yet (awaiting developer review per MDD Step 5): all of the above are currently untracked/modified working-tree changes. `.claude/`, `.git/`, `dev_log/00_main.md`, and `dev_log/00_mmdd.md` were left untouched.

## Status: Complete
