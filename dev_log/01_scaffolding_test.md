# Unit 01: Scaffolding - Test Instructions

## Test Objectives

Confirm the project scaffold is fully functional before any application code is built on top of it:

- The dev server runs and serves the placeholder page under the `/L-vator/` base path.
- The production build compiles cleanly and emits a static bundle with correctly-prefixed asset paths.
- Lint and format checks pass with no violations.
- The Vitest harness runs and the placeholder test passes.
- The GitHub Actions workflow deploys the built bundle to GitHub Pages on push to `main`.

## Automated Tests

These were run locally by the AI during implementation (Node v26.8.2 installed locally; CI will use Node 22 per `.nvmrc`). All passed on the final scaffold:

1. `npm run lint` — `eslint .` — **PASS**, no errors or warnings.
2. `npm run format:check` — `prettier --check .` — **PASS**, "All matched files use Prettier code style!" (after adding `.claude/` to `.prettierignore` and reformatting `src/style.css`).
3. `npm run test` — `vitest run` — **PASS**, 1 test file, 1 test (`src/main.test.ts`, trivial `1 + 1 === 2` assertion).
4. `npm run build` — `tsc -b && vite build` — **PASS**, produced `dist/index.html` plus hashed JS/CSS assets, all referenced with the `/L-vator/` prefix.

## Manual Tests

Run locally by the developer to independently confirm the above (or re-run by the AI, documented here for reproducibility):

1. From the project root, run `npm install` — should complete with no errors (already run; `node_modules/` present and gitignored).
2. Run `npm run dev` — Vite should print a local URL of the form `http://localhost:5173/L-vator/`. Open it in a browser (or `curl` it) and confirm the page loads with the title "L-vator" and the placeholder heading/paragraph. Stop the server (Ctrl+C) when done.
3. Run `npm run build` then `npm run preview` — open the printed preview URL and confirm the built bundle serves the same placeholder page correctly (asset paths should resolve, no 404s in the browser console/network tab).
4. Run `npm run format` (writes) once on a deliberately misformatted scratch file to confirm Prettier actually rewrites files, then revert/discard that scratch change — not required for sign-off, just a sanity check that `format` (as opposed to `format:check`) works.
5. Confirm `.gitignore` is respected: `node_modules/`, `dist/`, `.DS_Store`, and `*.tsbuildinfo` should never appear in `git status`.
6. Confirm `.claude/`, `dev_log/`, and `.git/` were not touched or overwritten by the scaffolding process (`git status` should show them either unchanged/tracked-as-before or, for `dev_log/01_scaffolding.md`, newly added — no deletions).

## Integration Checks

To be performed once this unit is committed and pushed to a GitHub repository named `L-vator` (not yet done as part of this implementation step — local-only so far):

1. Push the repository to GitHub (default branch `main`).
2. In the repo's Settings → Pages, set Source to "GitHub Actions" (one-time manual step).
3. Push (or re-push) to `main` and confirm the `Deploy to GitHub Pages` workflow run succeeds end-to-end:
   - `npm ci` succeeds.
   - `npm run lint` gate passes.
   - `npm run test` gate passes.
   - `npm run build` succeeds.
   - `upload-pages-artifact` uploads `dist/`.
   - The `deploy` job (depends on `build` via `needs:`) runs `deploy-pages` and publishes successfully.
4. Visit the deployed Pages URL (`https://<account>.github.io/L-vator/`) and confirm the placeholder page loads correctly — title "L-vator", heading and paragraph visible, no broken asset requests (check browser dev tools network tab for 404s, which would indicate a `base` path misconfiguration).
5. Confirm that a deliberately broken commit (e.g. a failing test or lint error) pushed to `main` causes the workflow to fail before reaching the deploy job — i.e. the lint/test gates actually block bad deploys. (Optional sanity check; can be done on a throwaway branch/commit and reverted.)

## Success Criteria

- All four automated commands (`lint`, `format:check`, `test`, `build`) pass locally with zero errors — confirmed above.
- `npm run dev` serves the placeholder page at the `/L-vator/` base path with no console errors.
- The GitHub Actions workflow file is syntactically valid and follows the documented job structure (build job with lint/test/build gates → separate deploy job with `needs:`).
- Once pushed: the Actions run for a `main` push completes successfully and the GitHub Pages URL serves the placeholder page with correctly-resolved asset paths.
- No unit-02+ application code exists yet — this unit is infrastructure only.
