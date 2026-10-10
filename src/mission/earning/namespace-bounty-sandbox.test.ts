/** Synthetic fixtures and one guarded real jail run. Disposable DB-free unit surface; no
 * network, no container runtime, no live GitHub. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const {
  CompositeBountySandboxRunner, NamespaceBountySandboxRunner, defaultSandboxCacheRoot, pinnedRootfsDigest, probeNamespaceSandbox, stageRootfs,
} = require('./namespace-bounty-sandbox') as typeof import('./namespace-bounty-sandbox');
const { validateBountyProposal } = require('./github-bounty-sandbox') as typeof import('./github-bounty-sandbox');

function withEnv<T>(values: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key] as string | undefined]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return (async () => { try { return await run(); } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } })();
}

function refusingRunner(reason: string) {
  return new NamespaceBountySandboxRunner({ probe: async () => ({ available: false, reason, detail: { probe: 'fixture' } }) });
}

test('a refused capability probe is a refusal, never an approximation', async () => {
  for (const reason of ['unshare_missing', 'unshare_too_old_for_root_option', 'user_namespaces_disabled', 'unprivileged_userns_disabled', 'namespace_create_denied', 'staged_binary_missing:tar']) {
    const runner = refusingRunner(reason);
    assert.equal(await runner.available(), false, reason);
    const status = await runner.status();
    assert.equal(status.available, false);
    assert.equal(status.reason, reason);
    assert.equal(status.detail.probe, 'fixture');
    await assert.rejects(runner.inspect(new Uint8Array([1, 2, 3])), (error: Error) => error.message === `sandbox_unavailable:${reason}`);
    await assert.rejects(runner.verify(new Uint8Array([1]), { files: [{ path: 'a.ts', content: 'x' }], testArgv: [['node', '--test']], commitMessage: 'a', prTitle: 'b', prBody: 'c' }),
      (error: Error) => error.message === `sandbox_unavailable:${reason}`);
  }
});

test('an oversized or empty archive is rejected before any jail is created', async () => {
  const runner = refusingRunner('unused');
  await assert.rejects(runner.inspect(new Uint8Array(0)), (error: Error) => error.message === 'sandbox_archive_out_of_bounds');
  const huge = new Uint8Array(64 * 1024 * 1024 + 1);
  await assert.rejects(runner.inspect(huge), (error: Error) => error.message === 'sandbox_archive_out_of_bounds');
});

test('a proposal is validated by the same shared rules the OCI runner enforces', async () => {
  const runner = refusingRunner('unused');
  for (const bad of [
    { files: [], testArgv: [['node', '--test']], commitMessage: 'a', prTitle: 'b', prBody: 'c' },
    { files: [{ path: '../../root/.ssh/authorized_keys', content: 'x' }], testArgv: [['node', '--test']], commitMessage: 'a', prTitle: 'b', prBody: 'c' },
    { files: [{ path: 'a.ts', content: 'x' }], testArgv: [['node', '-e', 'process.exit(0)']], commitMessage: 'a', prTitle: 'b', prBody: 'c' },
    { files: [{ path: 'a.ts', content: 'x' }], testArgv: [['curl', 'http://example.invalid']], commitMessage: 'a', prTitle: 'b', prBody: 'c' },
  ]) {
    await assert.rejects(runner.verify(new Uint8Array([1]), bad as never), (error: Error) => /^proposal_/.test(error.message), JSON.stringify(bad).slice(0, 60));
  }
});

test('the pinned rootfs digest is honoured only when it is a real digest', () => withEnv({ ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST: undefined }, () => {
  assert.equal(pinnedRootfsDigest(undefined), null);
  assert.equal(pinnedRootfsDigest('   '), null);
  assert.equal(pinnedRootfsDigest('latest'), null);
  assert.equal(pinnedRootfsDigest('sha256:' + 'a'.repeat(64)), null, 'a docker-style prefix is not a bare manifest digest');
  assert.equal(pinnedRootfsDigest('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(pinnedRootfsDigest(('A'.repeat(64)).toLowerCase()), 'a'.repeat(64));
}));

test('deployment pinning makes an unpinned jail unavailable', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'akbaral-jail-pin-'));
  const runner = new NamespaceBountySandboxRunner({
    probe: async () => ({ available: true, reason: null, detail: {} }),
    cacheRoot: directory,
    requirePinnedRootfs: true,
    nodeBinary: process.execPath,
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST: undefined }, async () => {
    // Staging a full rootfs is the expensive half; only reach it when the host can stage at all.
    const capability = await probeNamespaceSandbox();
    if (!capability.available) { assert.equal(capability.available, false); return; }
    assert.equal(await runner.available(), false, 'an unpinned jail must not be used when the deployment demands pinning');
    assert.equal((await runner.status()).reason, 'rootfs_digest_unpinned');
    const digest = (await stageRootfs({ cacheRoot: directory, nodeBinary: process.execPath })).digest;
    assert.equal(digest.length, 64);
    await withEnv({ ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST: 'b'.repeat(64) }, async () => {
      // A fresh runner, because an availability verdict is cached per instance on purpose:
      // one jail identity per process, never a verdict that silently changes mid-run.
      const mismatched = new NamespaceBountySandboxRunner({ probe: async () => ({ available: true, reason: null, detail: {} }), cacheRoot: directory, requirePinnedRootfs: true, nodeBinary: process.execPath });
      assert.equal((await mismatched.status()).reason, 'rootfs_digest_mismatch', 'a different rootfs than the pinned one never runs');
      assert.equal(await mismatched.available(), false);
    });
    await withEnv({ ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST: digest }, async () => {
      const pinned = new NamespaceBountySandboxRunner({ probe: async () => ({ available: true, reason: null, detail: {} }), cacheRoot: directory, nodeBinary: process.execPath });
      assert.equal(await pinned.available(), true, 'the pinned digest matches the staged content, so the jail may run');
      assert.equal((await pinned.status()).rootfsDigest, digest);
    });
  });
});

test('the shared cache root follows DATA_DIR like the mission database does', () => withEnv({ DATA_DIR: '/srv/akbaral/data' }, () => {
  assert.equal(defaultSandboxCacheRoot(), path.join('/srv/akbaral/data', 'sandbox'));
}));

test('the composite prefers a pinned OCI image and only then falls back to the jail', async () => {
  const order: string[] = [];
  const backend = (name: string, ok: boolean) => ({
    backend: name,
    async available() { order.push(name); return ok; },
    async inspect() { return { ok: true, summary: `${name} inspection`, files: [] }; },
    async verify() { return { ok: true, summary: `${name} verification`, tests: [{ argv: ['node', '--test'], exitCode: 0, output: 'ok' }] }; },
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: undefined }, async () => {
    const composite = new CompositeBountySandboxRunner([backend('oci', false) as never, backend('namespace', true) as never]);
    assert.equal(await composite.available(), true, 'a jail is enough when the container runtime is absent');
    assert.deepEqual(order, ['oci', 'namespace'], 'the stronger backend is asked first');
    assert.deepEqual((await composite.describe()), { backend: 'namespace', mode: 'auto', reason: 'ready' });
    const inspection = await composite.inspect(new Uint8Array([1]));
    assert.equal(inspection.summary, 'namespace inspection');
    const verification = await composite.verify(new Uint8Array([1]), validateBountyProposal({ files: [{ path: 'a.ts', content: 'x' }], testArgv: [['node', '--test']], commitMessage: 'a', prTitle: 'b', prBody: 'c' }));
    assert.equal(verification.ok, true);
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: 'auto' }, async () => {
    const neither = new CompositeBountySandboxRunner([backend('oci', false) as never, backend('namespace', false) as never]);
    assert.equal(await neither.available(), false);
    assert.equal((await neither.describe()).backend, null);
    assert.equal((await neither.describe()).reason, 'no_backend_available');
    await assert.rejects(neither.inspect(new Uint8Array([1])), (error: Error) => error.message === 'sandbox_unavailable');
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: 'off' }, async () => {
    const disabled = new CompositeBountySandboxRunner([backend('oci', true) as never]);
    assert.equal(await disabled.available(), false, 'the owner can turn execution back off without redeploying');
    assert.equal((await disabled.describe()).reason, 'sandbox_mode_off');
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: 'oci' }, async () => {
    const forced = new CompositeBountySandboxRunner([backend('oci', false) as never, backend('namespace', true) as never]);
    assert.equal(await forced.available(), false, 'forcing OCI may not quietly substitute the weaker jail');
  });
  await withEnv({ ZA141251SA_BOUNTY_SANDBOX_MODE: 'garbage-value' }, async () => {
    const sane = new CompositeBountySandboxRunner([backend('oci', true) as never]);
    assert.equal(sane.mode, 'auto', 'an unreadable mode string falls back to the safe default, never to off-by-accident');
    assert.equal(await sane.available(), true);
  });
});

test('the staging manifest is content-addressed and stable across calls', async () => {
  const capability = await probeNamespaceSandbox();
  if (!capability.available) {
    // On a kernel that refuses unprivileged user namespaces this is the honest outcome:
    // nothing is claimed, and the reason is reported to the owner rather than hidden.
    assert.equal(typeof capability.reason, 'string');
    test.skip(`skipped: ${capability.reason}`);
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'akbaral-jail-stage-'));
  const first = await stageRootfs({ cacheRoot: directory, nodeBinary: process.execPath });
  const second = await stageRootfs({ cacheRoot: directory, nodeBinary: process.execPath });
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(second.digest, first.digest, 'the same staged content hashes to the same sandbox identity');
  assert.equal(second.reused, true, 'the 150 MB staging step must not repeat per run');
  assert.equal(second.rootDir, first.rootDir);
  assert.ok(first.fileCount >= 4, 'node, sh, tar, gzip, libraries and the inspector are all staged');
  assert.ok(existsSync(path.join(first.rootDir, 'bin', 'node')));
  assert.ok(readFileSync(path.join(first.rootDir, 'inspector.mjs'), 'utf8').includes('jail_selftest'), 'the inspector is part of the hashed rootfs');

  // The real thing: a hostile-shaped archive goes in, a bounded report comes out, and the
  // jail proves it can neither read the host nor reach the network.
  const workspace = mkdtempSync(path.join(tmpdir(), 'akbaral-jail-repo-'));
  const source = path.join(workspace, 'repo');
  mkdirSync(path.join(source, 'lib'), { recursive: true });
  mkdirSync(path.join(source, 'test'), { recursive: true });
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }));
  writeFileSync(path.join(source, 'lib', 'sum.js'), "function sum(values) { let total = 0; for (const value of values) total += value; return total - 1; }\nmodule.exports = { sum };\n");
  writeFileSync(path.join(source, 'test', 'sum.test.js'), "const { test } = require('node:test');\nconst assert = require('node:assert');\nconst { sum } = require('../lib/sum');\ntest('sums', () => assert.strictEqual(sum([1, 2, 3]), 6));\n");
  const archivePath = path.join(workspace, 'repo.tar.gz');
  const packed = spawnSync('tar', ['-czf', archivePath, '-C', workspace, 'repo'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = new Uint8Array(readFileSync(archivePath));

  const runner = new NamespaceBountySandboxRunner({ cacheRoot: directory, nodeBinary: process.execPath });
  const inspection = await runner.inspect(archive);
  assert.equal(inspection.ok, true, inspection.reason ?? 'inspection should succeed');
  assert.match(inspection.summary, /fixture/);
  assert.deepEqual(inspection.files.map(file => String(file).split(' ')[0]).sort(), ['lib/sum.js', 'package.json', 'test/sum.test.js'], 'the inspection reports the real archive inventory');
  const proposal = {
    files: [{ path: 'lib/sum.js', content: "function sum(values) { let total = 0; for (const value of values) total += value; return total; }\nmodule.exports = { sum };\n" }],
    testArgv: [['node', '--test']], commitMessage: 'fix: off-by-one', prTitle: 'fix: off-by-one', prBody: 'Fixes the off-by-one; the suite passes.',
  };
  const passing = await runner.verify(archive, proposal);
  assert.equal(passing.ok, true, passing.summary);
  assert.equal(passing.tests[0].exitCode, 0);
  assert.match(passing.tests[0].output, /# pass 1/);
  const failing = await runner.verify(archive, { ...proposal, files: [{ path: 'lib/sum.js', content: proposal.files[0].content.replace('return total;', 'return total + 1;') }] });
  assert.equal(failing.ok, false, 'a wrong fix must not be able to self-certify');
  assert.equal(failing.tests[0].exitCode, 1);
  assert.match(failing.tests[0].output, /# fail 1/);
  assert.equal(await runner.available(), true);
  const status = await runner.status();
  assert.equal(status.available, true);
  const boundary = status.detail.boundary as { hostVisible?: string[]; egress?: string; pids?: number } | undefined;
  assert.deepEqual(boundary?.hostVisible ?? [], [], 'no host path may be visible inside the jail');
  assert.equal(boundary?.egress, 'blocked', 'the jail must have no route out');
  assert.ok([1, 2, 3, 4].includes(Number(boundary?.pids)), 'the jail gets its own PID table');
});
