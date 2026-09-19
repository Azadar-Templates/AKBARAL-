#!/usr/bin/env node
/**
 * Copy backend runtime assets that the TypeScript compiler does not emit.
 *
 * `src/db/pg-worker.mjs` and `src/db/pg-connection.mjs` are plain ES modules
 * that live next to the TypeScript sources and are loaded by path at runtime
 * (`src/db/database.ts` spawns `path.join(__dirname, 'pg-worker.mjs')`). `tsc`
 * ignores .mjs inputs, so without this copy a compiled build is missing them
 * and any PostgreSQL deployment fails at the first worker spawn.
 *
 * This used to be an inline `node -e "fs.copyFileSync(...)"` inside
 * package.json's `build` script, which meant every other build path (the
 * StackHost build steps in stackhost.yaml) had to duplicate the same two
 * paths by hand — exactly how the two could drift. One script, both callers.
 *
 * Idempotent, no dependencies, exits non-zero (and says what is missing) if a
 * source file is absent, so a broken build fails loudly instead of producing a
 * dist/ that only breaks in production.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ASSETS = ['pg-worker.mjs', 'pg-connection.mjs'];
const from = path.resolve('src', 'db');
const to = path.resolve('dist', 'src', 'db');

if (!existsSync(path.resolve('dist', 'src'))) {
  console.error(
    '[build] dist/src does not exist — run "tsc -p tsconfig.backend.json" before this script ' +
      '(package.json build script and stackhost.yaml both do).',
  );
  process.exit(1);
}

mkdirSync(to, { recursive: true });

for (const asset of ASSETS) {
  const source = path.join(from, asset);
  if (!existsSync(source)) {
    console.error(`[build] missing backend runtime asset: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, path.join(to, asset));
  console.log(`[build] copied ${path.relative(process.cwd(), source)} -> dist/src/db/${asset}`);
}
