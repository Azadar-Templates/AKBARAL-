/**
 * Namespace-backed bounty sandbox — a $0 fallback when no OCI runtime exists.
 *
 * WHY. The OCI runner (`github-bounty-sandbox.ts`) is the preferred boundary, but it
 * needs a container runtime plus a pre-pulled, digest-pinned image. A fresh deployment
 * on a plain box (or a CI job, or this very sandbox) has neither, so every execution
 * attempt stopped at `sandbox_unavailable` — not because isolation was impossible, but
 * because Docker was the only isolation backend modelled.
 *
 * WHAT THIS IS. The same `BountySandboxRunner` contract, enforced by the kernel instead
 * of a container engine:
 *
 *   · a new user, PID, mount and NET namespace (`unshare`), so the jailed process has no
 *     route to the network and no view of host processes;
 *   · `--root` into a *staged* rootfs containing nothing but the node runtime, `sh`,
 *     `tar` and the libraries they link — no host file is reachable, and the capability
 *     probe verifies that with the real thing before anything runs;
 *   · kernel rlimits (`ulimit -v/-f/-u/-t`) for memory, file size, processes and CPU
 *     seconds, plus a wall-clock timeout and output caps enforced by the parent;
 *   · an explicit minimal environment (PATH/HOME/LANG/NODE_ENV). Mission secrets, vault
 *     keys and provider tokens are never placed in the child env;
 *   · the rootfs is content-addressed. Its manifest digest is recorded on every run and
 *     can be pinned exactly like an image digest
 *     (`ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST`): if the staged tree does not hash to
 *     the pinned value, nothing runs.
 *
 * It is deliberately honest about being weaker than the OCI path: user namespaces can be
 * disabled by policy, no seccomp/AppArmor profile or cgroup quota is applied here, and
 * the code under test runs as the namespace's mapped root. So `available()` re-probes and
 * returns false with a reason instead of approximating, and the OCI backend always wins
 * when it is present.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type {
  BountySandboxRunner, BountySolutionProposal, SandboxInspection, SandboxVerification,
} from './github-bounty-sandbox';
import { validateBountyProposal } from './github-bounty-sandbox';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 96 * 1024;
const RUN_TIMEOUT_MS = 6 * 60 * 1000;
/** util-linux added `--root` in 2.36; older `unshare` cannot build the jail. */
const MIN_UTIL_LINUX = [2, 36];
const HEX64 = /^[a-f0-9]{64}$/;
/**
 * `tar` decompresses `.tgz` by exec'ing `gzip`, so both must exist inside the jail;
 * `sh` carries the rlimits. Each entry lists the locations tried, because the staged
 * tree is host-derived and a binary's path differs between distributions.
 */
const REQUIRED_BINARIES: string[][] = [['/bin/sh', '/usr/bin/sh'], ['/usr/bin/tar', '/bin/tar'], ['/usr/bin/gzip', '/bin/gzip']];
/**
 * Staged only when the host actually has them. The jail can execute tests against these
 * runtimes and nothing else: it has no network, so a repository whose suite needs a
 * package install cannot be verified here — that run stays blocked instead of being faked.
 */
const STAGED_OPTIONAL_BINARIES: string[][] = [['/usr/bin/python3', '/usr/local/bin/python3', '/usr/bin/python', '/usr/local/bin/python']];

function firstExisting(candidates: string[]): string | null {
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function stagedBinaries(): { paths: string[]; missing: string[] } {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const candidates of REQUIRED_BINARIES) {
    const found = firstExisting(candidates);
    if (found) paths.push(found); else missing.push(basename(candidates[0]));
  }
  for (const candidates of STAGED_OPTIONAL_BINARIES) {
    const found = firstExisting(candidates);
    if (found) paths.push(found);
  }
  return { paths, missing };
}

export interface NamespaceSandboxStatus {
  available: boolean;
  reason: string | null;
  detail: Record<string, unknown>;
}

function compareVersion(actual: string, minimum: number[]): boolean {
  const parts = actual.split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < minimum.length; i += 1) {
    if ((parts[i] ?? 0) > minimum[i]) return true;
    if ((parts[i] ?? 0) < minimum[i]) return false;
  }
  return true;
}

function runText(command: string, args: string[], timeout = 8_000): Promise<{ code: number | null; stdout: string }> {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      shell: false, stdio: 'pipe',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), LANG: 'C', NODE_ENV: process.env.NODE_ENV ?? 'production' },
    });
    let out = '';
    let done = false;
    const finish = (code: number | null) => { if (!done) { done = true; clearTimeout(timer); resolvePromise({ code, stdout: out.slice(0, 4096) }); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeout);
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr.on('data', () => { /* capability probes never surface child stderr */ });
    child.once('error', () => finish(null));
    child.once('close', code => finish(code));
    void child.stdin.end();
  });
}

/** Every prerequisite, checked on THIS machine. Nothing here is assumed. */
export async function probeNamespaceSandbox(): Promise<NamespaceSandboxStatus> {
  const detail: Record<string, unknown> = {};
  const unshare = await runText('unshare', ['--version']);
  const version = /(\d+(?:\.\d+)+)/.exec(unshare.stdout)?.[1] ?? '';
  detail.unshareVersion = version || null;
  if (unshare.code !== 0 || !version) return { available: false, reason: 'unshare_missing', detail };
  detail.requiredUtilLinux = MIN_UTIL_LINUX.join('.');
  if (!compareVersion(version, MIN_UTIL_LINUX)) return { available: false, reason: 'unshare_too_old_for_root_option', detail };

  const maxUserNs = await readFile('/proc/sys/user/max_user_namespaces', 'utf8').catch(() => '');
  const userNsLimit = Number.parseInt(maxUserNs.trim(), 10);
  detail.maxUserNamespaces = Number.isFinite(userNsLimit) ? userNsLimit : null;
  if (!Number.isFinite(userNsLimit) || userNsLimit <= 0) return { available: false, reason: 'user_namespaces_disabled', detail };
  if (await readFile('/proc/sys/kernel/unprivileged_userns_clone', 'utf8').catch(() => '1').then(value => value.trim()) === '0') {
    return { available: false, reason: 'unprivileged_userns_disabled', detail };
  }
  if (!existsSync(process.execPath)) return { available: false, reason: 'node_runtime_unreadable', detail };
  detail.node = process.execPath;
  const staged = stagedBinaries();
  if (staged.missing.length) return { available: false, reason: `staged_binary_missing:${staged.missing.join(',')}`, detail };
  detail.runtimes = ['node', ...staged.paths.map(binary => basename(binary))];

  // Namespaces must actually be creatable here — some kernels and container policies
  // allow the binary to exist but refuse `unshare`. The host-file denial and no-egress
  // checks happen after staging, against the real rootfs, in `selftest` mode.
  const smoke = await runText('unshare', ['-Urn', '--pid', '--fork', '--mount-proc', '--map-root-user', '/bin/sh', '-c', 'echo NS_OK'], 20_000);
  detail.namespaceSmoke = smoke.stdout.trim().slice(0, 40);
  if (smoke.code !== 0 || !smoke.stdout.includes('NS_OK')) return { available: false, reason: 'namespace_create_denied', detail };
  return { available: true, reason: null, detail };
}

/** The exact libraries a binary links, dereferenced to real files. */
async function dependenciesOf(binary: string): Promise<Array<{ name: string; real: string }>> {
  const ldd = await runText('ldd', [binary], 20_000);
  const found: Array<{ name: string; real: string }> = [];
  for (const line of ldd.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[1] === '=>' && parts[2].startsWith('/')) found.push({ name: basename(parts[0]), real: parts[2] });
    else if (parts.length >= 1 && parts[0].startsWith('/lib') && parts[0] !== 'linux-vdso.so.1') found.push({ name: basename(parts[0]), real: parts[0] });
  }
  const out: Array<{ name: string; real: string }> = [];
  for (const entry of found) {
    const real = await realpath(entry.real).catch(() => entry.real);
    if (existsSync(real)) out.push({ name: entry.name, real });
  }
  return out;
}

const INSPECTOR_SOURCE = `// Staged inside the sandbox rootfs and covered by its digest, so it cannot be
// swapped without changing the sandbox identity. This is the only program the jail
// runs: it extracts the untrusted archive, lists it, applies the single proposed
// file, runs allowlisted test commands, and prints one bounded JSON report.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const requested = process.argv[2];
const mode = requested === 'verify' || requested === 'selftest' ? requested : 'inspect';
const work = '/work';
const LIMIT = 96 * 1024;
const clipped = value => String(value ?? '').slice(0, 16000);

if (mode === 'selftest') {
  // Run before anything is extracted: the point is to prove the boundary itself —
  // no host files, no network route, no host process table.
  const fs = await import('node:fs');
  const net = await import('node:net');
  const hostPaths = ['/etc/shadow', '/etc/passwd', '/root', '/usr/local/bin/node', '/home'];
  if (process.env.SANDBOX_HOST_PROBE) hostPaths.push(process.env.SANDBOX_HOST_PROBE);
  const hostVisible = hostPaths.filter(path => { try { return fs.existsSync(path); } catch { return false; } });
  const pids = (() => { try { return fs.readdirSync('/proc').filter(name => /^[0-9]+$/.test(name)).length; } catch { return -1; } })();
  const egress = await new Promise(resolve => {
    const socket = net.connect({ host: '8.8.8.8', port: 53 });
    const settle = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500);
    socket.once('connect', () => settle('connected'));
    socket.once('timeout', () => settle('blocked'));
    socket.once('error', () => settle('blocked'));
  });
  const ok = hostVisible.length === 0 && egress === 'blocked' && pids > 0 && pids <= 4;
  process.stdout.write(JSON.stringify({ ok, summary: 'jail_selftest', checks: { hostVisible, pids, egress } }));
  process.exit(0);
}

async function walk(dir, acc, depth) {
  if (depth > 12) return acc;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (acc.length >= 200) break;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc, depth + 1);
    else if (entry.isFile()) {
      const info = await stat(full).catch(() => ({ size: 0 }));
      acc.push(full.slice(work.length + 1) + ' (' + info.size + 'B)');
    }
  }
  return acc;
}

try {
  await mkdir(work, { recursive: true });
  await run('tar', ['-xzf', '/input/source.tgz', '-C', work, '--strip-components=1', '--no-same-owner'], { maxBuffer: LIMIT });
  const files = await walk(work, [], 0);
  if (mode === 'inspect') {
    const readme = await readFile(join(work, 'README.md'), 'utf8').catch(() => '');
    let pkg = null;
    try { pkg = JSON.parse(await readFile(join(work, 'package.json'), 'utf8')); } catch { /* not a node project */ }
    const scripts = pkg && pkg.scripts ? Object.keys(pkg.scripts) : [];
    const summary = 'entries=' + files.length
      + '; package=' + (pkg && pkg.name ? pkg.name : 'none')
      + '; scripts=' + scripts.slice(0, 12).join(',')
      + '; readme=' + readme.trim().split('\\n').slice(0, 2).join(' ').slice(0, 200);
    process.stdout.write(JSON.stringify({ ok: true, summary: summary.slice(0, 16000), files }));
    process.exit(0);
  }
  const proposal = JSON.parse(await readFile('/input/proposal.json', 'utf8'));
  const applied = [];
  for (const file of proposal.files || []) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') throw new Error('proposal_file_invalid');
    const target = join(work, file.path.replace(/^\\/+/, ''));
    if (target !== work && !target.startsWith(work + '/')) throw new Error('proposal_path_escape');
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    applied.push(file.path);
  }
  const tests = [];
  for (const argv of proposal.testArgv || []) {
    if (!Array.isArray(argv) || argv.length < 1 || !argv.every(arg => typeof arg === 'string')) throw new Error('test_argv_invalid');
    const outcome = await run(argv[0], argv.slice(1), {
      cwd: work, timeout: 5 * 60 * 1000, maxBuffer: LIMIT,
      env: { PATH: work + '/node_modules/.bin:/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', NODE_ENV: 'development', LANG: 'C' },
    }).catch(error => ({
      stdout: (error && error.stdout) || '',
      stderr: (error && error.stderr) || (error && error.message) || '',
      code: typeof error?.code === 'number' ? error.code : 1,
    }));
    tests.push({ argv, exitCode: typeof outcome.code === 'number' ? outcome.code : 0, output: (clipped(outcome.stdout) + '\\n' + clipped(outcome.stderr)).slice(0, 16000) });
  }
  const ok = tests.length > 0 && tests.every(test => test.exitCode === 0);
  process.stdout.write(JSON.stringify({
    ok,
    summary: ('applied ' + applied.join(',') + '; ' + tests.length + ' command(s)').slice(0, 16000),
    files: files.slice(0, 200),
    tests,
  }));
  process.exit(0);
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false, summary: 'inspector_failed',
    reason: String(error && error.message ? error.message : error).slice(0, 240),
    files: [], tests: [],
  }));
  process.exit(0);
}
`;

export interface StagedRootfs {
  rootDir: string;
  digest: string;
  fileCount: number;
  reused: boolean;
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export function defaultSandboxCacheRoot(): string {
  const dataDir = (process.env.DATA_DIR ?? './data').trim() || './data';
  return join(dataDir, 'sandbox');
}

/**
 * Build — or reuse from cache — the content-addressed rootfs. The digest covers the
 * sorted `relative path | size | sha256` of every staged file, so a host library
 * upgrade changes the identity of the sandbox rather than silently changing what runs.
 */
export async function stageRootfs(options: { cacheRoot?: string; nodeBinary?: string } = {}): Promise<StagedRootfs> {
  const cacheRoot = options.cacheRoot ?? defaultSandboxCacheRoot();
  const stagedBinaries_ = stagedBinaries();
  if (stagedBinaries_.missing.length) throw new Error(`staged_binary_missing:${stagedBinaries_.missing.join(',')}`);
  const binaries = [options.nodeBinary ?? process.execPath, ...stagedBinaries_.paths].filter((value, index, all) => all.indexOf(value) === index);
  const stage = await mkTemp(join(cacheRoot, '.staging-'));
  try {
    for (const binary of binaries) {
      const real = await realpath(binary);
      const dest = join(stage, 'bin', basename(binary));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(real, dest);
      await chmod(dest, 0o755);
      for (const dependency of await dependenciesOf(real)) {
        for (const directory of ['lib/x86_64-linux-gnu', 'lib64']) {
          const target = join(stage, directory, dependency.name);
          await mkdir(dirname(target), { recursive: true });
          if (!existsSync(target)) { await copyFile(dependency.real, target); await chmod(target, 0o755); }
        }
      }
    }
    await writeFile(join(stage, 'inspector.mjs'), INSPECTOR_SOURCE, 'utf8');
    for (const directory of ['proc', 'tmp', 'input']) await mkdir(join(stage, directory), { recursive: true });

    const listing: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) listing.push(`${relative(stage, full)}|${(await stat(full)).size}|${await hashFile(full)}`);
      }
    };
    await walk(stage);
    const digest = createHash('sha256').update(listing.slice().sort().join('\n')).digest('hex');
    const rootDir = join(cacheRoot, `rootfs-${digest.slice(0, 32)}`);
    if (existsSync(join(rootDir, '.complete'))) {
      await rm(stage, { recursive: true, force: true });
      return { rootDir, digest, fileCount: listing.length, reused: true };
    }
    await mkdir(dirname(rootDir), { recursive: true });
    await rename(stage, rootDir).catch(async error => {
      // Another worker won the race and published the same content-addressed root.
      if (existsSync(join(rootDir, '.complete'))) { await rm(stage, { recursive: true, force: true }); return; }
      throw error;
    });
    if (!existsSync(join(rootDir, '.complete'))) {
      await writeFile(join(rootDir, '.complete'), `${JSON.stringify({ digest, files: listing.length, stagedAt: new Date().toISOString(), binaries })}\n`, 'utf8');
    }
    return { rootDir, digest, fileCount: listing.length, reused: false };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function mkTemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  await mkdir(dirname(prefix), { recursive: true });
  return mkdtemp(prefix);
}

/** The digest the deployment pinned, if any. A malformed value means "nothing pinned". */
export function pinnedRootfsDigest(value: string | undefined = process.env.ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  return HEX64.test(raw) ? raw : null;
}

interface RunnerState {
  available: boolean;
  reason: string | null;
  rootDir?: string;
  digest?: string;
  detail: Record<string, unknown>;
}

export interface NamespaceSandboxOptions {
  /** Test seam; defaults to the real capability probe. */
  probe?: () => Promise<NamespaceSandboxStatus>;
  cacheRoot?: string;
  nodeBinary?: string;
  /** Deployments that want reproducible jails require a pinned digest to exist at all. */
  requirePinnedRootfs?: boolean;
}

export class NamespaceBountySandboxRunner implements BountySandboxRunner {
  readonly backend = 'namespace';
  #state: RunnerState | null = null;
  readonly #probe: () => Promise<NamespaceSandboxStatus>;
  readonly #options: NamespaceSandboxOptions;

  constructor(options: NamespaceSandboxOptions = {}) {
    this.#options = options;
    this.#probe = options.probe ?? probeNamespaceSandbox;
  }

  async available(): Promise<boolean> {
    return (await this.#resolve()).available;
  }

  /** Availability plus the reason it failed, for the owner-facing readiness view. */
  async status(): Promise<{ available: boolean; reason: string | null; rootfsDigest: string | null; detail: Record<string, unknown> }> {
    const state = await this.#resolve();
    return { available: state.available, reason: state.reason, rootfsDigest: state.digest ?? null, detail: state.detail };
  }

  async #resolve(): Promise<RunnerState> {
    if (this.#state) return this.#state;
    const capability = await this.#probe().catch(() => ({ available: false, reason: 'probe_threw', detail: {} } as NamespaceSandboxStatus));
    if (!capability.available) {
      this.#state = { available: false, reason: capability.reason, detail: capability.detail };
      return this.#state;
    }
    let staged: StagedRootfs;
    try {
      staged = await stageRootfs({ cacheRoot: this.#options.cacheRoot, nodeBinary: this.#options.nodeBinary });
    } catch {
      this.#state = { available: false, reason: 'rootfs_staging_failed', detail: capability.detail };
      return this.#state;
    }
    const pinned = pinnedRootfsDigest();
    if (pinned && pinned !== staged.digest) {
      this.#state = { available: false, reason: 'rootfs_digest_mismatch', detail: { ...capability.detail, staged: staged.digest, pinned } };
      return this.#state;
    }
    if (!pinned && this.#options.requirePinnedRootfs) {
      this.#state = { available: false, reason: 'rootfs_digest_unpinned', detail: { ...capability.detail, staged: staged.digest } };
      return this.#state;
    }
    // The boundary is proven on this machine, with the staged rootfs and the same flags a
    // real run uses, before anything untrusted is ever executed. A jail that cannot show
    // "no host files, no route out, private PID table" is not available.
    let selftest: { stdout: Buffer; code: number | null; timedOut: boolean };
    try {
      selftest = await this.#jail(staged.rootDir, 'selftest');
    } catch {
      this.#state = { available: false, reason: 'jail_selftest_unreachable', detail: capability.detail };
      return this.#state;
    }
    if (selftest.timedOut || selftest.code !== 0) {
      this.#state = { available: false, reason: selftest.timedOut ? 'jail_selftest_timeout' : 'jail_selftest_failed', detail: capability.detail };
      return this.#state;
    }
    let boundary: Record<string, unknown>;
    try { boundary = JSON.parse(selftest.stdout.toString('utf8')) as Record<string, unknown>; } catch { boundary = {}; }
    if (boundary.ok !== true) {
      this.#state = {
        available: false, reason: 'jail_boundary_not_verified',
        detail: { ...capability.detail, boundary: boundary.checks ?? null },
      };
      return this.#state;
    }
    this.#state = {
      available: true, reason: null, rootDir: staged.rootDir, digest: staged.digest,
      detail: { ...capability.detail, rootfsFiles: staged.fileCount, rootfsReused: staged.reused, boundary: boundary.checks ?? null },
    };
    return this.#state;
  }

  async #jail(rootDir: string, mode: 'inspect' | 'verify' | 'selftest'): Promise<{ stdout: Buffer; code: number | null; timedOut: boolean }> {
    return new Promise(resolvePromise => {
      // No secret ever enters this environment: the jail sees PATH/HOME/LANG/NODE_ENV, and
      // for the selftest one extra read-only host path used to prove invisibility.
      const env: NodeJS.ProcessEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C', NODE_ENV: 'production' };
      if (mode === 'selftest') env.SANDBOX_HOST_PROBE = process.cwd();
      const child = spawn('unshare', [
        '-Urn', '--pid', '--fork', '--mount-proc', '--map-root-user', '--propagation', 'private',
        '--root', rootDir,
        '/bin/sh', '-c',
        'ulimit -v 786432 -f 262144 -u 96 -t 330 2>/dev/null || true; exec /bin/node /inspector.mjs "$1"',
        'sandbox', mode,
      ], { shell: false, stdio: 'pipe', env });
      void child.stdin.end();
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (value: { stdout: Buffer; code: number | null; timedOut: boolean }) => { if (!done) { done = true; clearTimeout(timer); resolvePromise(value); } };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ stdout: Buffer.concat(chunks), code: null, timedOut: true }); }, RUN_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.byteLength; if (size > MAX_REPORT_BYTES) child.kill('SIGKILL'); else chunks.push(chunk); });
      child.stderr.on('data', () => { /* the jail's stderr is not part of any report */ });
      child.once('error', () => finish({ stdout: Buffer.alloc(0), code: null, timedOut: false }));
      child.once('close', code => finish({ stdout: Buffer.concat(chunks), code, timedOut: false }));
    });
  }

  async #runInJail(archive: Uint8Array, proposal?: BountySolutionProposal): Promise<{ stdout: Buffer; code: number | null; timedOut: boolean }> {
    if (archive.byteLength < 1 || archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('sandbox_archive_out_of_bounds');
    const state = await this.#resolve();
    if (!state.available || !state.rootDir) throw new Error(`sandbox_unavailable${state.reason ? `:${state.reason}` : ''}`);
    const rootDir = state.rootDir;
    const inputDir = join(rootDir, 'input');
    const workDir = join(rootDir, 'work');
    try {
      await mkdir(inputDir, { recursive: true });
      await writeFile(join(inputDir, 'source.tgz'), archive);
      await chmod(join(inputDir, 'source.tgz'), 0o444);
      if (proposal) {
        await writeFile(join(inputDir, 'proposal.json'), JSON.stringify(proposal));
        await chmod(join(inputDir, 'proposal.json'), 0o444);
      }
      return await this.#jail(rootDir, proposal ? 'verify' : 'inspect');
    } finally {
      await rm(join(inputDir, 'proposal.json'), { force: true }).catch(() => undefined);
      await rm(join(inputDir, 'source.tgz'), { force: true }).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async inspect(archive: Uint8Array): Promise<SandboxInspection> {
    const result = await this.#runInJail(archive);
    const parsed = parseReport(result.stdout, result.timedOut);
    return {
      ok: parsed.ok === true,
      summary: String(parsed.summary ?? '').slice(0, 16_000),
      files: Array.isArray(parsed.files) ? parsed.files.filter((item: unknown): item is string => typeof item === 'string').slice(0, 200) : [],
      ...(typeof parsed.reason === 'string' ? { reason: String(parsed.reason).slice(0, 240) } : {}),
    };
  }

  async verify(archive: Uint8Array, proposal: BountySolutionProposal): Promise<SandboxVerification> {
    const validated = validateBountyProposal(proposal);
    const result = await this.#runInJail(archive, validated);
    const parsed = parseReport(result.stdout, result.timedOut);
    const tests = Array.isArray(parsed.tests) ? parsed.tests.slice(0, 4).map((test: unknown) => {
      const row = test && typeof test === 'object' ? test as Record<string, unknown> : {};
      return {
        argv: Array.isArray(row.argv) ? row.argv.filter((item: unknown): item is string => typeof item === 'string').slice(0, 16) : [],
        exitCode: Number.isSafeInteger(row.exitCode) ? row.exitCode as number : null,
        output: String(row.output ?? '').slice(0, 16_000),
      };
    }) : [];
    return {
      ok: parsed.ok === true && tests.length > 0 && tests.every((test: { exitCode: number | null }) => test.exitCode === 0),
      summary: String(parsed.summary ?? '').slice(0, 16_000),
      tests,
      ...(typeof parsed.reason === 'string' ? { reason: String(parsed.reason).slice(0, 240) } : {}),
    };
  }
}

function parseReport(stdout: Buffer, timedOut: boolean): Record<string, unknown> {
  if (timedOut) return { ok: false, summary: 'sandbox_timeout', reason: 'sandbox_timeout', files: [], tests: [] };
  if (stdout.byteLength > MAX_REPORT_BYTES) throw new Error('sandbox_report_too_large');
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.toString('utf8')); } catch { throw new Error('sandbox_report_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('sandbox_report_invalid');
  return parsed as Record<string, unknown>;
}

/**
 * Backend selection for the worker. OCI first (a pinned image inside a container runtime
 * is strictly stronger), then the namespace jail, then nothing. Both backends keep their
 * own verdict; this only orders them, it never overrides a refusal.
 * `ZA141251SA_BOUNTY_SANDBOX_MODE` = auto (default) | oci | namespace | off.
 */
export class CompositeBountySandboxRunner implements BountySandboxRunner {
  #active: BountySandboxRunner | null = null;

  constructor(private readonly backends: BountySandboxRunner[]) {}

  get mode(): string {
    const raw = (process.env.ZA141251SA_BOUNTY_SANDBOX_MODE ?? 'auto').trim().toLowerCase();
    return ['auto', 'oci', 'namespace', 'off'].includes(raw) ? raw : 'auto';
  }

  async #pick(): Promise<BountySandboxRunner | null> {
    if (this.mode === 'off') return null;
    if (this.#active) return this.#active;
    for (const backend of this.backends) {
      if (this.mode !== 'auto' && backendName(backend) !== this.mode) continue;
      if (await backend.available().catch(() => false)) { this.#active = backend; return backend; }
    }
    return null;
  }

  async available(): Promise<boolean> { return (await this.#pick()) !== null; }

  /** Which backend is live, and why not — for the owner report and the evidence record. */
  async describe(): Promise<{ backend: string | null; mode: string; reason: string }> {
    const chosen = await this.#pick();
    if (chosen) return { backend: backendName(chosen), mode: this.mode, reason: 'ready' };
    const namespace = this.backends.find(backend => backendName(backend) === 'namespace') as NamespaceBountySandboxRunner | undefined;
    const detail = typeof namespace?.status === 'function' ? await namespace.status() : null;
    return {
      backend: null, mode: this.mode,
      reason: this.mode === 'off' ? 'sandbox_mode_off' : (detail?.reason ?? 'no_backend_available'),
    };
  }

  async inspect(archive: Uint8Array): Promise<SandboxInspection> {
    const chosen = await this.#pick();
    if (!chosen) throw new Error('sandbox_unavailable');
    return chosen.inspect(archive);
  }

  async verify(archive: Uint8Array, proposal: BountySolutionProposal): Promise<SandboxVerification> {
    const chosen = await this.#pick();
    if (!chosen) throw new Error('sandbox_unavailable');
    return chosen.verify(archive, proposal);
  }
}

function backendName(backend: BountySandboxRunner): string {
  return (backend as { backend?: string }).backend ?? 'oci';
}
