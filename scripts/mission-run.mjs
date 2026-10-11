#!/usr/bin/env node
/**
 * Run a mission tool by name, in whichever shape this checkout has.
 *
 *   node scripts/mission-run.mjs <name> [args…]        # npm run mission:*
 *
 * The runtime image ships `dist/` (compiled from `tsconfig.backend.json`, which compiles
 * `scripts/*.ts` files as well as `src/*.ts`) and deliberately does NOT ship `src/`. So
 * every `mission:*` script that was written as `tsx scripts/<name>.ts` was unrunnable in
 * production: the `.ts` file itself is copied, but its `import '../src/…'` resolved to a
 * directory the image has never had. That is why `npm run mission:sync-registry` could
 * only ever fail there, and why the boot-time migration step had to be written as its own
 * compiled entry.
 *
 * The precedent is in this repo, not invented here: `scripts/owner-bootstrap.mjs` runs
 * `owner-init.ts` through the same preference order (compiled `dist/scripts/owner-init.js`
 * first, `tsx` on the source second) for the identical production-packaging reason.
 *
 * Contract:
 *   · prefer the compiled entry `dist/scripts/<name>.js` — the shape production has;
 *   · fall back to the TypeScript source via `tsx` — the shape a dev checkout has;
 *   · say, on one line, which of the two ran, so a wrapper can never mistake "did nothing"
 *     for "succeeded";
 *   · exit with the child's code, and non-zero with a readable reason when neither exists.
 * No dependency on a build having run, and no new dependency at all.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
// --root only changes WHICH tree is resolved against; it exists so a test can point the
// resolver at a runtime-image-shaped tree (dist/ present, src/ absent) instead of trusting
// whatever this checkout happens to contain.
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootAt = argv.indexOf('--root');
if (rootAt !== -1) {
  const value = argv[rootAt + 1];
  if (!value) {
    console.error('[mission-run] --root needs a directory');
    process.exit(2);
  }
  root = path.resolve(value);
  argv.splice(rootAt, 2);
}
const [name, ...rest] = argv;

if (!name) {
  console.error('[mission-run] usage: node scripts/mission-run.mjs [--root <dir>] <script-name> [args…]');
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`[mission-run] refusing unexpected script name "${name}"`);
  process.exit(2);
}

const compiled = path.join(root, 'dist', 'scripts', `${name}.js`);
const source = path.join(root, 'scripts', `${name}.ts`);
const tsxBin = path.join(root, 'node_modules', '.bin', 'tsx');
/**
 * `src/` is what tells a dev checkout from the runtime image: the image deliberately ships
 * dist/ without src/, so a TypeScript entry there can never resolve its own imports
 * (`import '../src/mission/database'` → MODULE_NOT_FOUND). In a checkout that HAS src/, the
 * source is the fresher answer and gets used, so an edit is never shadowed by a stale build.
 */
const sourceIsUsable = existsSync(path.join(root, 'src'));

let command;
let args;
if (existsSync(compiled) && !sourceIsUsable) {
  command = process.execPath;
  args = [compiled, ...rest];
  console.log(`[mission-run] ${name}: compiled entry ${path.relative(root, compiled)} (no src/ in this tree — runtime-image shape)`);
} else if (existsSync(source) && existsSync(tsxBin) && sourceIsUsable) {
  command = tsxBin;
  args = [source, ...rest];
  console.log(`[mission-run] ${name}: source entry via tsx ${path.relative(root, source)}`);
} else if (existsSync(compiled)) {
  command = process.execPath;
  args = [compiled, ...rest];
  console.log(`[mission-run] ${name}: compiled entry ${path.relative(root, compiled)} (no usable tsx in this tree)`);
} else if (existsSync(source)) {
  console.error(
    `[mission-run] ${name}: found ${path.relative(root, source)} but neither a compiled entry ` +
      '(`dist/scripts/`) nor a usable `node_modules/.bin/tsx` — in the runtime image that means ' +
      '`npm run build` did not compile this script; in a checkout it usually means `npm ci` has not run.',
  );
  process.exit(1);
} else {
  console.error(
    `[mission-run] ${name}: no entry to run — looked for ${path.relative(root, compiled)} and ` +
      `${path.relative(root, source)}.`,
  );
  process.exit(1);
}

const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
if (result.error) {
  console.error(`[mission-run] ${name}: could not start (${result.error.message})`);
  process.exit(1);
}
if (result.signal) {
  console.error(`[mission-run] ${name}: terminated by signal ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
