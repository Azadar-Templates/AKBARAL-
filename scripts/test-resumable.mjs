#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, runBatch, summarize } from './lib/test-checkpoint.mjs';
import { failureDiagnostic } from './lib/test-diagnostics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
function fingerprint() {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const inputs = [...new Set(tracked.filter(file => /^(src\/|scripts\/|db\/|mission-dashboard\/|public\/|package[^/]*\.json$|tsconfig[^/]*\.json$|next[^/]*\.[cm]?[jt]s$)/.test(file)))];
  // Hash local configuration, never serialize its values. Config changes invalidate reuse.
  for (const name of ['.env', '.env.local', '.env.test', 'node_modules/.package-lock.json']) if (fs.existsSync(path.join(root, name))) inputs.push(name);
  const hashes = inputs.sort().map(file => [file, fs.existsSync(path.join(root, file)) ? digest(fs.readFileSync(path.join(root, file))) : 'missing']);
  const environment = Object.entries(process.env).filter(([key]) => /^(AKBARAL|ZA141251SA|OPENAI|GOOGLE|ANTHROPIC|MODEL|PROVIDER|SMTP|STRIPE|SESSION|NODE_ENV|NODE_OPTIONS|OWNER)/.test(key)).sort(([a], [b]) => a.localeCompare(b));
  return digest(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, inputs: hashes, environment }));
}
const sourceFingerprint = fingerprint();
const directory = path.resolve(root, value('--run-dir', `logs/test-checkpoints/${sourceFingerprint.slice(0, 24)}`));
const batchSize = args.includes('--all') ? Number.MAX_SAFE_INTEGER : Number(value('--batch-size', '8'));
const timeoutMs = Number(value('--timeout-ms', '180000'));
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Batch size and timeout must be positive safe integers');
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(file => file.endsWith('.test.ts')).map(file => `src/${file}`).sort();
console.log(`Checkpoint directory: ${path.relative(root, directory)}`);
if (args.includes('--status')) {
  const checkpoint = path.join(directory, 'checkpoint.json');
  if (!fs.existsSync(checkpoint)) console.log(JSON.stringify({ complete: false, completedFiles: 0, totalFiles: files.length, next: files[0] }, null, 2));
  else {
    const state = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    if (state.fingerprint !== sourceFingerprint) throw new Error('Checkpoint fingerprint differs from current sources/configuration');
    console.log(JSON.stringify(summarize(state), null, 2));
  }
} else {
  try {
    const result = await runBatch({ root, directory, fingerprint: sourceFingerprint, files, batchSize, timeoutMs,
      bootstrapArgs: ['--import', 'tsx', 'src/db/migrate.ts'],
      testArgs: file => ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-force-exit', file],
      checkFingerprint: () => { if (fingerprint() !== sourceFingerprint) throw new Error('Sources/configuration changed during the run; refusing a mixed-source checkpoint'); },
      onCheckpoint: summary => console.log(JSON.stringify(summary)),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) console.log('Batch saved. Run the same command again to continue; this is not a full-suite pass.');
  } catch (error) {
    const diagnostic = failureDiagnostic(directory, error.message);
    console.error(diagnostic.summary);
    if (process.env.GITHUB_ACTIONS === 'true') console.error(diagnostic.annotation);
    console.error('Completed checkpoints are preserved. Rerun the same command to retry only the unfinished file.');
    process.exitCode = 1;
  }
}
