/* Trusted runner shipped in the immutable OCI image. It is the sole process
 * permitted to unpack or execute an untrusted repository. Its JSON output is
 * intentionally bounded because it becomes mission evidence. */
import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';

const INPUT = '/input/source.tgz', ROOT = '/workspace', MAX_OUTPUT = 16000;
const TEST_EXECUTABLES = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'python', 'python3', 'pytest', 'go', 'cargo', 'make', 'gradle', 'mvn', 'composer', 'php', 'ruby', 'rspec', 'dotnet', 'swift', 'java']);
const FORBIDDEN_TEST_FLAGS = new Set(['-c', '--command', '-e', '--eval']);
const die = reason => emit({ ok: false, reason, summary: `Sandbox refused input: ${reason}`, files: [], tests: [] }, 2);
const emit = (value, code = 0) => { process.stdout.write(JSON.stringify(value)); process.exit(code); };
const safeArchivePath = value => typeof value === 'string' && value.length > 0 && value.length < 401 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(segment => !segment || segment === '.' || segment === '..');
function tarList() {
  const result = spawnSync('tar', ['-tzf', INPUT], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  if (result.status !== 0) die('archive_list_failed');
  const names = result.stdout.split('\n').filter(Boolean);
  if (!names.length || names.length > 20000 || names.some(name => !safeArchivePath(name.replace(/\/$/, '')))) die('archive_path_invalid');
  return names;
}
function unpack(names) {
  // Listing first prevents known traversal names. Extraction remains contained
  // by Docker's tmpfs/user namespace even for a malformed tar implementation.
  const result = spawnSync('tar', ['-xzf', INPUT, '--no-same-owner', '--no-same-permissions'], { cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 32768, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  if (result.status !== 0) die('archive_extract_failed');
  const rootNames = [...new Set(names.map(name => name.split('/')[0]))];
  if (rootNames.length !== 1 || !rootNames[0]) die('archive_layout_invalid');
  const repo = resolve(ROOT, rootNames[0]);
  if (!relative(ROOT, repo) || relative(ROOT, repo).startsWith('..') || !lstatSync(repo).isDirectory()) die('archive_layout_invalid');
  return repo;
}
function findFiles(root, limit = 200) {
  const answer = [];
  const walk = (dir, depth) => {
    if (depth > 4 || answer.length >= limit) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const next = resolve(dir, entry.name), shown = relative(root, next);
      if (entry.isDirectory()) walk(next, depth + 1); else if (entry.isFile()) answer.push(shown);
      if (answer.length >= limit) return;
    }
  };
  walk(root, 0); return answer;
}
function safeProposalPath(repo, path) {
  if (typeof path !== 'string' || !/^(?!\.git(?:\/|$))(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+\-/]{1,400}$/.test(path)) die('proposal_path_invalid');
  const target = resolve(repo, path);
  if (relative(repo, target).startsWith('..')) die('proposal_path_invalid');
  let current = repo;
  for (const part of path.split('/').slice(0, -1)) {
    current = resolve(current, part);
    try { if (lstatSync(current).isSymbolicLink()) die('proposal_symlink_parent'); } catch { mkdirSync(current, { recursive: false, mode: 0o700 }); }
  }
  try { if (lstatSync(target).isSymbolicLink()) die('proposal_symlink_target'); } catch { /* creating a new regular file is safe */ }
  return target;
}
function test(repo, argv) {
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repo, shell: false, timeout: 180000, encoding: 'utf8', maxBuffer: MAX_OUTPUT,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', CI: 'true', NODE_ENV: 'test', NO_COLOR: '1', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.slice(0, MAX_OUTPUT);
  return { argv, exitCode: typeof result.status === 'number' ? result.status : null, output, durationMs: Math.min(Date.now() - started, 180000) };
}
const mode = process.argv[2];
if (mode !== 'inspect' && mode !== 'verify') die('mode_invalid');
const names = tarList(); const repo = unpack(names); const files = findFiles(repo);
if (mode === 'inspect') emit({ ok: true, summary: `Archive unpacked in isolated sandbox. ${files.length} representative files enumerated.`, files });
let proposal;
try { proposal = JSON.parse(readFileSync('/input/proposal.json', 'utf8')); } catch { die('proposal_read_failed'); }
if (!proposal || !Array.isArray(proposal.files) || proposal.files.length !== 1 || !Array.isArray(proposal.testArgv) || proposal.testArgv.length < 1 || proposal.testArgv.length > 4) die('proposal_invalid');
const file = proposal.files[0];
if (!file || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 500000 || file.content.includes('\0')) die('proposal_content_invalid');
const target = safeProposalPath(repo, file.path); writeFileSync(target, file.content, { encoding: 'utf8', mode: 0o600, flag: 'w' });
const tests = [];
for (const argv of proposal.testArgv) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 16 || !argv.every(x => typeof x === 'string' && x.length <= 512 && !/[\x00-\x1f]/.test(x)) || !/^[A-Za-z0-9._+-]{1,80}$/.test(argv[0]) || !TEST_EXECUTABLES.has(argv[0]) || argv.slice(1).some(x => FORBIDDEN_TEST_FLAGS.has(x))) die('test_argv_invalid');
  tests.push(test(repo, argv));
  if (tests[tests.length - 1].exitCode !== 0) break;
}
const ok = tests.length === proposal.testArgv.length && tests.every(item => item.exitCode === 0);
emit({ ok, summary: ok ? `Verified ${tests.length} explicit test command(s) inside isolated sandbox.` : 'At least one explicit sandbox test command failed or timed out.', files: [], tests, ...(ok ? {} : { reason: 'test_failed' }) });
