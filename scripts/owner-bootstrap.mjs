#!/usr/bin/env node
/**
 * `npm run owner:bootstrap` launcher — NOT the bootstrap logic itself.
 *
 * Bug this fixes (production packaging): the production image's runtime
 * stage ships only the COMPILED backend (`dist/`) — raw `src/` is
 * intentionally not copied into the runtime image (see Dockerfile; this
 * keeps the image lean and matches the pattern already used for every other
 * production entrypoint — `dist/src/index.js`, `dist/src/db/migrate.js`,
 * `dist/src/scripts/backup-db.js`, see scripts/start-prod.mjs). The raw
 * `scripts/` directory IS copied into the runtime image (entrypoint.sh and
 * start-prod.mjs are plain JS/shell and run straight from there), which
 * meant `owner-init.ts` was present in the image but its
 * `import '../src/db/migrate'` resolved against a `src/` that was never
 * shipped — `tsx scripts/owner-init.ts` failed with
 * "Cannot find module '../src/db/migrate'" inside the container, even
 * though nothing was wrong with the bootstrap logic itself.
 *
 * The fix: run the SAME code the running server runs. `owner-init.ts` is
 * compiled by the exact same `tsc -p tsconfig.backend.json` step that
 * builds the rest of the backend (tsconfig.backend.json includes
 * `scripts/**\/*.ts`), so `dist/scripts/owner-init.js` already exists in
 * every production image and its compiled `require('../src/db/migrate')`
 * resolves correctly to `dist/src/db/migrate.js` — the identical compiled
 * module the API server itself imports. No owner/auth logic is duplicated
 * here; this file only decides WHICH already-built copy of owner-init to
 * run and then execs it unmodified.
 *
 * Preference order:
 *   1. dist/scripts/owner-init.js — the compiled artifact. Always present
 *      in a production image (and in any local checkout after
 *      `npm run build`). This is the production-safe path.
 *   2. scripts/owner-init.ts via tsx — a plain dev-checkout convenience
 *      fallback when `dist/` has not been built yet (e.g. before the first
 *      `npm run build`). Requires `src/`, which only a full source checkout
 *      has — never the production image.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const compiledEntry = path.resolve(process.cwd(), 'dist', 'scripts', 'owner-init.js');
const useCompiled = existsSync(compiledEntry);

const result = useCompiled
  ? spawnSync(process.execPath, [compiledEntry], { stdio: 'inherit', env: process.env })
  : spawnSync(path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx'), ['scripts/owner-init.ts'], {
      stdio: 'inherit',
      env: process.env,
    });

if (result.error) {
  console.error(`[owner:bootstrap] failed to start (${result.error.message}).`);
  process.exit(1);
}
if (result.signal) {
  console.error(`[owner:bootstrap] terminated by signal ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 0);
