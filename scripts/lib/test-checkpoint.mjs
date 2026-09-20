import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fileDigest = file => digest(fs.readFileSync(file));

export function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function identity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
  } catch { return null; }
}
function alive(actor) {
  if (!actor?.pid) return false;
  try { process.kill(actor.pid, 0); }
  catch (error) { return error.code !== 'ESRCH'; }
  return !actor.identity || identity(actor.pid) === actor.identity;
}
function acquire(directory) {
  // OS-backed SQLite locking is released even after SIGKILL. Unlike stale-PID
  // lock-file stealing, concurrent recovery attempts cannot race each other.
  const mutex = new DatabaseSync(path.join(directory, 'runner-lock.db'));
  try { mutex.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE'); }
  catch { mutex.close(); throw new Error('A checkpoint runner is already active; leave it running.'); }
  const lock = path.join(directory, 'runner.lock');
  const owner = { pid: process.pid, identity: identity(process.pid), nonce: crypto.randomUUID() };
  try {
    if (fs.existsSync(lock)) {
      const prior = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (alive(prior)) throw new Error('A checkpoint runner is already active; leave it running.');
      fs.renameSync(lock, `${lock}.stale-${crypto.randomUUID()}`);
    }
    atomicJson(lock, owner);
  } catch (error) { mutex.close(); throw error; }
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).nonce === owner.nonce) fs.unlinkSync(lock);
    } finally { mutex.close(); }
  };
}

function snapshot(source, destination) {
  const db = new DatabaseSync(source);
  try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); }
  finally { db.close(); }
}
function decodeSnapshot(attempt) {
  const bytes = fs.readFileSync(attempt.snapshot);
  return attempt.snapshotEncoding === 'gzip' ? gunzipSync(bytes) : brotliDecompressSync(bytes);
}
function restoreSnapshot(previous, destination) {
  if (['gzip','brotli'].includes(previous.snapshotEncoding)) {
    const raw = decodeSnapshot(previous);
    if (digest(raw) !== previous.snapshotRawHash) throw new Error('Compressed snapshot content is corrupted');
    fs.writeFileSync(destination, raw, { flag: 'wx', mode: 0o600 });
  } else snapshot(previous.snapshot, destination);
}
function saveSnapshot(attempt, attemptDir, compress) {
  if (!compress) {
    attempt.snapshot = path.join(attemptDir, 'passed.db');
    snapshot(attempt.database, attempt.snapshot);
    return;
  }
  // A scratch capture, not the retained verification artifact. The full SQLite
  // image is retained losslessly in the new artifact; no older snapshot is touched.
  attempt.captureTemporary = path.join(attemptDir, 'capture.tmp.db');
  snapshot(attempt.database, attempt.captureTemporary);
  const raw = fs.readFileSync(attempt.captureTemporary);
  const zipped = compress === 'gzip' ? gzipSync(raw, { level: 9 }) : brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } });
  attempt.snapshotRawHash = digest(raw);
  if (digest(compress === 'gzip' ? gunzipSync(zipped) : brotliDecompressSync(zipped)) !== attempt.snapshotRawHash) throw new Error('Snapshot compression verification failed');
  attempt.snapshot = path.join(attemptDir, compress === 'gzip' ? 'passed.db.gz' : 'passed.db.br');
  attempt.snapshotEncoding = compress === 'gzip' ? 'gzip' : 'brotli';
  const fd = fs.openSync(attempt.snapshot, 'wx', 0o600);
  try { fs.writeFileSync(fd, zipped); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function tapCounts(text) {
  const counts = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const values = [...text.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    counts[key] = values.length ? Number(values.at(-1)[1]) : null;
  }
  if (counts.tests === null || counts.pass === null || counts.fail !== 0 || counts.cancelled !== 0) throw new Error('Missing or failing TAP summary; no success checkpoint recorded');
  return counts;
}
export function summarize(state) {
  const passed = state.attempts.filter(attempt => attempt.status === 'passed');
  const counts = { tests: 0, suites: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) counts[key] = passed.reduce((total, attempt) => total + (attempt.counts[key] ?? 0), 0);
  return { fingerprint: state.fingerprint, completedFiles: passed.length, totalFiles: state.files.length, complete: passed.length === state.files.length, ...counts, next: state.files[passed.length] ?? null };
}
async function validate(state, fingerprint, files) {
  if (state.version !== 1 || state.fingerprint !== fingerprint || JSON.stringify(state.files) !== JSON.stringify(files)) throw new Error('Checkpoint source/configuration fingerprint mismatch; retain this run and start a new run directory');
  const passed = state.attempts.filter(attempt => attempt.status === 'passed');
  if (passed.some((attempt, index) => attempt.file !== files[index])) throw new Error('Invalid checkpoint ordering');
  for (const attempt of passed) {
    if (fileDigest(attempt.log) !== attempt.logHash || fileDigest(attempt.snapshot) !== attempt.snapshotHash) throw new Error('Checkpoint evidence was changed or corrupted; refusing to skip tests');
  }
  if (state.bootstrap && fileDigest(state.bootstrap.snapshot) !== state.bootstrap.snapshotHash) throw new Error('Bootstrap snapshot is corrupted');
  if (alive(state.active?.child) && state.active.deadline && Date.now() >= state.active.deadline) {
    // Recover only the recorded, identity-matched test process group after its
    // persisted deadline. Never kill an unrelated reused PID.
    try { process.kill(process.platform === 'win32' ? state.active.child.pid : -state.active.child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let tries = 0; tries < 40 && alive(state.active.child); tries++) await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (alive(state.active?.child)) throw new Error('An interrupted runner still has a live child; wait for its recorded deadline before resuming');
}

async function command(args, options, attempt, state, save) {
  const fd = fs.openSync(attempt.log, 'wx', 0o600);
  let child;
  let timer;
  let forced;
  let stopReason;
  const stop = reason => {
    if (!child?.pid || stopReason) return;
    stopReason = reason;
    const kill = signal => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    kill('SIGTERM');
    forced = setTimeout(() => kill('SIGKILL'), 1000);
  };
  const interrupt = () => stop('interrupted');
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  try {
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env, ...options.env, DATABASE_URL: `file:${attempt.database}` };
      // Nested runner regressions must launch a real independent TAP process.
      delete env.NODE_TEST_CONTEXT;
      child = spawn(process.execPath, args, { cwd: options.root, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' });
      state.active = { file: attempt.file, deadline: Date.now() + options.timeoutMs, child: { pid: child.pid, identity: identity(child.pid) } };
      save();
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
      timer = setTimeout(() => stop('timed_out'), options.timeoutMs);
    });
    fs.fsyncSync(fd);
    if (result.code !== 0 || stopReason) throw new Error(`${stopReason ?? 'failed'}: ${attempt.file} (exit ${result.code}, signal ${result.signal}); see ${attempt.log}`);
  } finally {
    clearTimeout(timer); clearTimeout(forced);
    process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
    fs.closeSync(fd);
    state.active = null;
  }
}

/** Optional disk-safe retention: discard only a closed, completed test's mutable
 * copy after its immutable verification snapshot and TAP log have been hashed.
 * Failed/interrupted DBs, snapshots, logs, source and production artifacts stay.
 */
export function pruneCompletedWorkingCopy(attempt) {
  const working = path.resolve(attempt.database);
  const saved = path.resolve(attempt.snapshot ?? '');
  if (attempt.status !== 'passed' || path.basename(working) !== 'working.db' ||
      path.basename(saved) !== (attempt.snapshotEncoding === 'gzip' ? 'passed.db.gz' : attempt.snapshotEncoding === 'brotli' ? 'passed.db.br' : 'passed.db') || path.dirname(working) !== path.dirname(saved) ||
      !fs.lstatSync(working).isFile() || fs.lstatSync(working).isSymbolicLink()) throw new Error('Not a disposable completed test copy');
  if (fileDigest(saved) !== attempt.snapshotHash || fileDigest(attempt.log) !== attempt.logHash) throw new Error('Completed evidence is corrupted; refusing cleanup');
  if (['gzip','brotli'].includes(attempt.snapshotEncoding)) {
    if (digest(decodeSnapshot(attempt)) !== attempt.snapshotRawHash) throw new Error('Compressed snapshot content is corrupted; refusing cleanup');
    const capture = path.resolve(attempt.captureTemporary ?? '');
    if (path.basename(capture) !== 'capture.tmp.db' || path.dirname(capture) !== path.dirname(saved) || fileDigest(capture) !== attempt.snapshotRawHash) throw new Error('Not a disposable capture');
    fs.unlinkSync(capture);
  }
  fs.unlinkSync(working);
}

/** Immutable successful DB snapshots keep failed/interrupted writes out of retries.
 * Only test-owned databases under directory are created; existing DBs are never reset.
 */
export async function runBatch(options) {
  const { root, directory, fingerprint } = options;
  const files = [...options.files].sort();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const checkpoint = path.join(directory, 'checkpoint.json');
  const release = acquire(directory);
  try {
    const state = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : { version: 1, fingerprint, files, bootstrap: null, attempts: [], active: null };
    await validate(state, fingerprint, files);
    for (const attempt of state.attempts) if (attempt.status === 'running') attempt.status = 'interrupted';
    state.active = null;
    const save = () => atomicJson(checkpoint, state);
    save();
    const execute = async (file, args, previous) => {
      const attemptDir = path.join(directory, `${file === '__bootstrap__' ? 'bootstrap' : state.attempts.length}-${crypto.randomUUID()}`);
      fs.mkdirSync(attemptDir, { mode: 0o700 });
      const attempt = { file, status: 'running', startedAt: new Date().toISOString(), log: path.join(attemptDir, 'output.tap'), database: path.join(attemptDir, 'working.db') };
      if (previous) restoreSnapshot(previous, attempt.database);
      if (file !== '__bootstrap__') state.attempts.push(attempt);
      save();
      try {
        options.checkFingerprint?.();
        await command(args, { ...options, root }, attempt, state, save);
        options.checkFingerprint?.();
        if (file !== '__bootstrap__') attempt.counts = tapCounts(fs.readFileSync(attempt.log, 'utf8'));
        saveSnapshot(attempt, attemptDir, options.compressSnapshots);
        attempt.snapshotHash = fileDigest(attempt.snapshot);
        attempt.logHash = fileDigest(attempt.log);
        attempt.status = 'passed';
        attempt.finishedAt = new Date().toISOString();
        if (file === '__bootstrap__') state.bootstrap = attempt;
        save();
        if (options.pruneWorkingCopies) pruneCompletedWorkingCopy(attempt);
        options.onCheckpoint?.(summarize(state));
        return attempt;
      } catch (error) {
        attempt.status = 'failed'; attempt.error = error.message; save();
        throw error;
      }
    };
    if (!state.bootstrap) await execute('__bootstrap__', options.bootstrapArgs, null);
    const completed = state.attempts.filter(attempt => attempt.status === 'passed');
    let previous = completed.at(-1) ?? state.bootstrap;
    const pending = files.slice(completed.length, completed.length + options.batchSize);
    for (const file of pending) previous = await execute(file, options.testArgs(file), previous);
    return summarize(state);
  } finally { release(); }
}
