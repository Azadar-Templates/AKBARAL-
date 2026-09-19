import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const { runBatch } = require('../../scripts/lib/test-checkpoint.mjs') as typeof import('../../scripts/lib/test-checkpoint.mjs');

function fixture(hang = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-runner-'));
  const directory = path.join(root, 'checkpoints');
  const files = ['a.cjs', 'b.cjs', 'c.cjs'];
  for (const [index, file] of files.entries()) {
    fs.writeFileSync(path.join(root, file), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
test('synthetic checkpoint fixture ${index}', async () => {
  const db = new DatabaseSync(process.env.DATABASE_URL.slice(5));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM progress').get().n, ${index});
  db.prepare('INSERT INTO progress VALUES (?)').run(${index});
  if (${hang && index === 1} && !fs.existsSync(__filename + '.allow')) {
    db.prepare('INSERT INTO progress VALUES (?)').run(999);
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  db.close();
});`);
  }
  const options = { root, directory, fingerprint: 'synthetic-fixed-source', files: [...files].reverse(), batchSize: 1, timeoutMs: 1500,
    bootstrapArgs: ['-e', "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.env.DATABASE_URL.slice(5)); db.exec('CREATE TABLE progress (n INTEGER)'); db.close();"],
    testArgs: (file: string) => ['--test', file],
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(directory, 'checkpoint.json'), 'utf8'));
  return { root, directory, options, state };
}

it('saves sorted batches, resumes without repeating completed files, and keeps shared DB state', async () => {
  const f = fixture();
  const first = await runBatch(f.options);
  assert.equal(first.completedFiles, 1);
  assert.equal(first.next, 'b.cjs');
  assert.equal(first.complete, false);
  const checkpoint = fs.readFileSync(path.join(f.directory, 'checkpoint.json'), 'utf8');
  await assert.rejects(runBatch({ ...f.options, fingerprint: 'changed-source' }), /fingerprint mismatch/);
  assert.equal(fs.readFileSync(path.join(f.directory, 'checkpoint.json'), 'utf8'), checkpoint);
  const finished = await runBatch({ ...f.options, batchSize: 2 });
  assert.equal(finished.complete, true);
  assert.equal(finished.pass, 3);
  assert.equal(f.state().attempts.length, 3);
  const replay = await runBatch(f.options);
  assert.equal(replay.pass, 3);
  assert.equal(f.state().attempts.length, 3);
  const last = f.state().attempts.at(-1);
  const db = new DatabaseSync(last.snapshot);
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM progress').get()!.n, 3); }
  finally { db.close(); }
});

it('timeout preserves completed evidence and retries from its immutable snapshot, not dirty failed writes', async () => {
  const f = fixture(true);
  await runBatch(f.options);
  const firstSnapshot = f.state().attempts[0].snapshot;
  await assert.rejects(runBatch(f.options), /timed_out/);
  assert.equal(f.state().attempts[0].snapshot, firstSnapshot);
  assert.equal(f.state().attempts[1].status, 'failed');
  fs.writeFileSync(path.join(f.root, 'b.cjs.allow'), 'synthetic retry fixture');
  const result = await runBatch({ ...f.options, batchSize: 2 });
  assert.equal(result.pass, 3);
  assert.equal(f.state().attempts.length, 4, 'only the failed file was retried');
  assert.ok(fs.existsSync(f.state().attempts[1].database), 'failed attempt remains available');
});

it('refuses concurrent runners and corrupted success evidence', async () => {
  const f = fixture();
  const active = runBatch(f.options);
  await assert.rejects(runBatch(f.options), /already active/);
  await active;
  fs.appendFileSync(f.state().attempts[0].log, '\nchanged evidence\n');
  await assert.rejects(runBatch(f.options), /corrupted/);
});

it('recovers a dead runner lock but refuses to checkpoint source changes during a test', async () => {
  const f = fixture();
  fs.mkdirSync(f.directory);
  fs.writeFileSync(path.join(f.directory, 'runner.lock'), JSON.stringify({ pid: 2147483647, identity: 'dead', nonce: 'synthetic-stale' }));
  await runBatch(f.options);
  assert.ok(fs.readdirSync(f.directory).some(name => name.startsWith('runner.lock.stale-')));
  let checks = 0;
  await assert.rejects(runBatch({ ...f.options, checkFingerprint: () => { if (++checks === 2) throw new Error('synthetic source change'); } }), /source change/);
  assert.equal(f.state().attempts.filter((attempt: { status: string }) => attempt.status === 'passed').length, 1);
});

it('SIGKILL recovery retains completed files and terminates only its expired orphan before retrying', async () => {
  const f = fixture(true);
  await runBatch(f.options);
  const wrapper = path.join(f.root, 'runner.mjs');
  const moduleUrl = pathToFileURL(path.resolve('scripts/lib/test-checkpoint.mjs')).href;
  fs.writeFileSync(wrapper, `import { runBatch } from ${JSON.stringify(moduleUrl)}; await runBatch({ ...${JSON.stringify(f.options)}, testArgs: file => ['--test', file] });`);
  const runner = spawn(process.execPath, [wrapper], { stdio: 'ignore' });
  try {
    for (let tries = 0; tries < 100 && f.state().active?.file !== 'b.cjs'; tries++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.state().active?.file, 'b.cjs');
    const deadline = f.state().active.deadline;
    const exited = new Promise(resolve => runner.once('exit', resolve));
    runner.kill('SIGKILL');
    await exited;
    await assert.rejects(runBatch(f.options), /live child/);
    fs.writeFileSync(path.join(f.root, 'b.cjs.allow'), 'synthetic retry fixture');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 50)));
    const result = await runBatch({ ...f.options, batchSize: 2 });
    assert.equal(result.pass, 3);
    assert.equal(f.state().attempts[1].status, 'interrupted');
    assert.equal(f.state().attempts.length, 4);
  } finally { if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL'); }
});
