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

it('failure annotations preserve resume location without allowing multiline workflow command injection', () => {
  const { failureDiagnostic } = require('../../scripts/lib/test-diagnostics.mjs') as typeof import('../../scripts/lib/test-diagnostics.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-diagnostic-'));
  const log = path.join(root, 'failed.tap');
  fs.writeFileSync(log, 'not ok 1 - synthetic failure\nerror: synthetic 10% failure\n::warning::not a real command\n');
  fs.writeFileSync(path.join(root, 'checkpoint.json'), JSON.stringify({ files: ['a.ts', 'b.ts'], attempts: [{ status: 'passed', file: 'a.ts' }, { status: 'failed', file: 'b.ts', log, error: 'synthetic failed attempt' }] }));
  const result = failureDiagnostic(root, 'fallback');
  assert.match(result.summary, /1\/2 files checkpointed/);
  assert.match(result.summary, /Failed file: b.ts/);
  assert.match(result.annotation, /10%25/);
  assert.equal(result.annotation.includes('\n'), false);
  assert.equal(result.annotation.includes('::warning::'), false);
  assert.match(failureDiagnostic(path.join(root, 'missing'), 'synthetic fallback').annotation, /synthetic fallback/);
});

it('opt-in pruning preserves every verified snapshot/log and resumes without replaying completed tests', async () => {
  const f=fixture();await runBatch({...f.options,pruneWorkingCopies:true});
  for(const a of [f.state().bootstrap,...f.state().attempts]) {
    assert.equal(fs.existsSync(a.database),false);assert.equal(fs.existsSync(a.snapshot),true);assert.equal(fs.existsSync(a.log),true);
  }
  const result=await runBatch({...f.options,batchSize:2,pruneWorkingCopies:true});assert.equal(result.pass,3);
  assert.equal((await runBatch({...f.options,pruneWorkingCopies:true})).pass,3);assert.equal(f.state().attempts.length,3);
});
it('pruning retains failed-run databases and refuses cleanup when immutable evidence is corrupt', async () => {
  const f=fixture(true);await runBatch({...f.options,pruneWorkingCopies:true});
  await assert.rejects(runBatch({...f.options,pruneWorkingCopies:true}),/timed_out/);
  assert.equal(fs.existsSync(f.state().attempts[1].database),true);
  const g=fixture();await runBatch(g.options);const a=g.state().attempts[0];
  fs.appendFileSync(a.log,'changed fixture evidence');
  const {pruneCompletedWorkingCopy}=require('../../scripts/lib/test-checkpoint.mjs') as typeof import('../../scripts/lib/test-checkpoint.mjs');
  assert.throws(()=>pruneCompletedWorkingCopy(a),/corrupted/);assert.equal(fs.existsSync(a.database),true);
  assert.throws(()=>pruneCompletedWorkingCopy({...a,status:'failed'}),/Not a disposable/);
  assert.throws(()=>pruneCompletedWorkingCopy({...a,database:a.snapshot}),/Not a disposable/);assert.equal(fs.existsSync(a.snapshot),true);
});

it('the full-suite runner must not force process exit and truncate completed test reporting', () => {
  const script=fs.readFileSync(path.resolve('scripts/test-resumable.mjs'),'utf8');
  assert.equal(script.includes('--test-force-exit'),false);
});
for(const encoding of ['gzip','brotli'])it(`losslessly ${encoding}-compressed verification snapshots resume with identical database contents`,async()=>{
  const f=fixture(),options={...f.options,pruneWorkingCopies:true,compressSnapshots:encoding};
  await runBatch(options);const a=f.state().attempts[0];
  assert.equal(a.snapshotEncoding,encoding);assert.equal(fs.existsSync(a.database),false);assert.equal(fs.existsSync(a.captureTemporary),false);assert.equal(fs.existsSync(a.snapshot),true);
  const {gunzipSync,brotliDecompressSync}=require('node:zlib') as typeof import('node:zlib');
  const {createHash}=require('node:crypto') as typeof import('node:crypto');
  assert.equal(createHash('sha256').update((encoding==='gzip'?gunzipSync:brotliDecompressSync)(fs.readFileSync(a.snapshot))).digest('hex'),a.snapshotRawHash);
  assert.equal((await runBatch({...options,batchSize:2})).pass,3);
  assert.equal((await runBatch(options)).complete,true);assert.equal(f.state().attempts.length,3);
});
it('compressed snapshot corruption stops resume without replacing existing evidence',async()=>{
  const f=fixture(),options={...f.options,pruneWorkingCopies:true,compressSnapshots:true};await runBatch(options);
  const a=f.state().attempts[0];fs.appendFileSync(a.snapshot,'fixture corruption');
  await assert.rejects(runBatch(options),/corrupted/);assert.equal(fs.existsSync(a.log),true);assert.equal(f.state().attempts.length,1);
});
