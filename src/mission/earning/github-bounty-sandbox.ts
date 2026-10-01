/**
 * Boundary for examining and testing an untrusted GitHub archive.  Nothing in
 * this module loads repository code into the mission process.  Docker is only
 * used as an OCI runtime for a pre-provisioned, digest-pinned runner image;
 * it is never built, pulled, or selected from repository-controlled input.
 */
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface BountyFileProposal { path: string; content: string }
export interface BountySolutionProposal {
  files: BountyFileProposal[];
  testArgv: string[][];
  commitMessage: string;
  prTitle: string;
  prBody: string;
}
export interface SandboxInspection { ok: boolean; summary: string; files: string[]; reason?: string }
export interface SandboxVerification { ok: boolean; summary: string; tests: Array<{ argv: string[]; exitCode: number | null; output: string }>; reason?: string }
export interface BountySandboxRunner {
  available(): Promise<boolean>;
  inspect(archive: Uint8Array): Promise<SandboxInspection>;
  verify(archive: Uint8Array, proposal: BountySolutionProposal): Promise<SandboxVerification>;
}

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 96 * 1024;
const DOCKER_TIMEOUT_MS = 6 * 60 * 1000;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_PATH = /^(?!\.git(?:\/|$))(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+\-/]{1,400}$/;
const SAFE_EXECUTABLE = /^[A-Za-z0-9._+-]{1,80}$/;
const TEST_EXECUTABLES = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'python', 'python3', 'pytest', 'go', 'cargo', 'make', 'gradle', 'mvn', 'composer', 'php', 'ruby', 'rspec', 'dotnet', 'swift', 'java']);
const FORBIDDEN_TEST_FLAGS = new Set(['-c', '--command', '-e', '--eval']);
const SAFE_ARG = /^[^\u0000-\u001f]{0,512}$/;

export function validateBountyProposal(value: unknown): BountySolutionProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('proposal_not_object');
  const proposal = value as Record<string, unknown>;
  const keys = Object.keys(proposal).sort().join(',');
  if (keys !== 'commitMessage,files,prBody,prTitle,testArgv') throw new Error('proposal_unexpected_fields');
  if (!Array.isArray(proposal.files) || proposal.files.length !== 1) throw new Error('proposal_requires_exactly_one_file');
  if (!Array.isArray(proposal.testArgv) || proposal.testArgv.length < 1 || proposal.testArgv.length > 4) throw new Error('proposal_invalid_test_argv');
  const file = proposal.files[0];
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('proposal_invalid_file');
  const path = (file as Record<string, unknown>).path;
  const content = (file as Record<string, unknown>).content;
  if (typeof path !== 'string' || !SAFE_PATH.test(path) || path.includes('//')) throw new Error('proposal_invalid_path');
  if (typeof content !== 'string' || !content.length || Buffer.byteLength(content, 'utf8') > 500_000 || /\u0000/.test(content)) throw new Error('proposal_invalid_content');
  const text = (name: 'commitMessage' | 'prTitle' | 'prBody', maximum: number) => {
    const item = proposal[name];
    if (typeof item !== 'string' || !item.trim() || Buffer.byteLength(item, 'utf8') > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)) throw new Error(`proposal_invalid_${name}`);
    return item;
  };
  const testArgv = proposal.testArgv.map((command, index) => {
    if (!Array.isArray(command) || command.length < 1 || command.length > 16 || !command.every(arg => typeof arg === 'string')) throw new Error(`proposal_invalid_test_${index}`);
    const argv = command as string[];
    if (!SAFE_EXECUTABLE.test(argv[0]) || !TEST_EXECUTABLES.has(argv[0]) || !argv.every(arg => SAFE_ARG.test(arg)) || argv.slice(1).some(arg => FORBIDDEN_TEST_FLAGS.has(arg))) throw new Error(`proposal_invalid_test_${index}`);
    return argv;
  });
  return { files: [{ path, content }], testArgv, commitMessage: text('commitMessage', 400), prTitle: text('prTitle', 250), prBody: text('prBody', 50_000) };
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}
function reportFromStdout(stdout: Buffer): any {
  if (stdout.byteLength > MAX_REPORT_BYTES) throw new Error('sandbox_report_too_large');
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.toString('utf8')); } catch { throw new Error('sandbox_report_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('sandbox_report_invalid');
  return parsed;
}

/**
 * A deliberately narrow Docker CLI adapter.  The image must be provisioned by
 * deployment and pinned with ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST.  This
 * prevents a bounty repository, model output, or an image tag from deciding
 * what privileged host-side program runs.
 */
export class OciBountySandboxRunner implements BountySandboxRunner {
  readonly image: string;
  readonly runtime: string;
  constructor(options: { image?: string; runtime?: string } = {}) {
    const digest = options.image ?? process.env.ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST ?? '';
    // A digest by itself is intentionally not enough to fetch a remote image.
    this.image = DIGEST.test(digest) ? `akbaral-bounty-sandbox@${digest}` : '';
    this.runtime = options.runtime ?? process.env.ZA141251SA_BOUNTY_SANDBOX_RUNTIME ?? 'docker';
  }
  async available(): Promise<boolean> {
    if (!this.image || !['docker', 'podman'].includes(this.runtime)) return false;
    const result = await run(this.runtime, ['image', 'inspect', this.image], 8_000).catch(() => null);
    return !!result && result.code === 0;
  }
  async inspect(archive: Uint8Array): Promise<SandboxInspection> {
    const result = await this.#run('inspect', archive);
    const parsed = reportFromStdout(result.stdout);
    return {
      ok: parsed.ok === true,
      summary: boundedText(parsed.summary, 16_000),
      files: Array.isArray(parsed.files) ? parsed.files.filter((item: unknown): item is string => typeof item === 'string').slice(0, 200) : [],
      ...(typeof parsed.reason === 'string' ? { reason: boundedText(parsed.reason, 240) } : {}),
    };
  }
  async verify(archive: Uint8Array, proposal: BountySolutionProposal): Promise<SandboxVerification> {
    validateBountyProposal(proposal);
    const result = await this.#run('verify', archive, proposal);
    const parsed = reportFromStdout(result.stdout);
    const tests = Array.isArray(parsed.tests) ? parsed.tests.slice(0, 4).map((test: unknown) => {
      const row = test && typeof test === 'object' ? test as Record<string, unknown> : {};
      return {
        argv: Array.isArray(row.argv) ? row.argv.filter((x: unknown): x is string => typeof x === 'string').slice(0, 16) : [],
        exitCode: Number.isSafeInteger(row.exitCode) ? row.exitCode as number : null,
        output: boundedText(row.output, 16_000),
      };
    }) : [];
    return { ok: parsed.ok === true && tests.length > 0 && tests.every((test: { exitCode: number | null }) => test.exitCode === 0), summary: boundedText(parsed.summary, 16_000), tests, ...(typeof parsed.reason === 'string' ? { reason: boundedText(parsed.reason, 240) } : {}) };
  }
  async #run(mode: 'inspect' | 'verify', archive: Uint8Array, proposal?: BountySolutionProposal): Promise<{ stdout: Buffer; code: number | null }> {
    if (archive.byteLength < 1 || archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('sandbox_archive_out_of_bounds');
    if (!(await this.available())) throw new Error('sandbox_unavailable');
    const scratch = await mkdtemp(join(tmpdir(), 'akbaral-bounty-'));
    try {
      const archivePath = join(scratch, 'source.tgz');
      // These two inputs are public repository/model data, never mission
      // credentials. They must be readable by the fixed non-root container UID.
      await writeFile(archivePath, archive, { mode: 0o444 }); await chmod(archivePath, 0o444);
      const args = [
        'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--pids-limit=128', '--memory=768m', '--memory-swap=768m', '--cpus=1', '--ulimit=nofile=128:128', '--user=65532:65532',
        '--workdir=/workspace', '--tmpfs=/workspace:rw,nosuid,nodev,noexec,size=384m', '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m',
        '--mount', `type=bind,src=${archivePath},dst=/input/source.tgz,readonly`,
      ];
      if (proposal) {
        const proposalPath = join(scratch, 'proposal.json');
        await writeFile(proposalPath, JSON.stringify(proposal), { mode: 0o444 }); await chmod(proposalPath, 0o444);
        args.push('--mount', `type=bind,src=${proposalPath},dst=/input/proposal.json,readonly`);
      }
      args.push(this.image, mode);
      const outcome = await run(this.runtime, args, DOCKER_TIMEOUT_MS);
      if (outcome.code !== 0) throw new Error(outcome.timedOut ? 'sandbox_timeout' : 'sandbox_runner_failed');
      return outcome;
    } finally { await rm(scratch, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined); }
  }
}

function run(command: string, args: string[], timeout: number): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'pipe', env: { ...process.env, PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), LANG: 'C', NODE_ENV: process.env.NODE_ENV ?? 'production' } });
    child.stdin.end();
    const chunks: Buffer[] = [], err: Buffer[] = []; let size = 0, finished = false;
    const finish = (value: { code: number | null; stdout: Buffer; stderr: Buffer; timedOut: boolean }) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ code: null, stdout: Buffer.concat(chunks), stderr: Buffer.concat(err), timedOut: true }); }, timeout);
    child.stdout.on('data', (value: Buffer) => { size += value.byteLength; if (size > MAX_REPORT_BYTES) child.kill('SIGKILL'); else chunks.push(value); });
    child.stderr.on('data', (value: Buffer) => { if (Buffer.concat(err).byteLength < 8192) err.push(value.subarray(0, 8192)); });
    child.once('error', reject); child.once('close', code => finish({ code, stdout: Buffer.concat(chunks), stderr: Buffer.concat(err), timedOut: false }));
  });
}
