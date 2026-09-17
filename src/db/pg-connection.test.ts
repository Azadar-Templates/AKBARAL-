import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSslMode } from './pg-connection.mjs';

/**
 * SSL hardening (production-readiness pass): remote PostgreSQL connections
 * must carry an EXPLICIT sslmode=verify-full. Eliminates the
 * pg-connection-string deprecation warning ("sslmode 'require' et al are
 * aliases for verify-full; they weaken in pg 9") and refuses insecure
 * remote modes outright. Local hosts are never touched. The connection
 * string (credentials!) is never logged or embedded in errors.
 */
describe('pg connection SSL hardening', () => {
  it('upgrades Neon-style sslmode=require to explicit verify-full, preserving the rest byte-for-byte', () => {
    const input = 'postgres://user:pa%40ss@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
    const result = normalizeSslMode(input);
    assert.equal(result.changed, true);
    assert.equal(result.remote, true);
    assert.equal(result.sslmode, 'verify-full');
    assert.ok(result.connectionString.startsWith('postgres://user:pa%40ss@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?'));
    assert.ok(result.connectionString.includes('sslmode=verify-full'));
    // other params preserved exactly, in order
    assert.ok(result.connectionString.includes('&channel_binding=require'));
    // exactly one sslmode param
    assert.equal(result.connectionString.split('sslmode=').length - 1, 1);
  });

  it('appends sslmode=verify-full when a remote URL has no query string', () => {
    const result = normalizeSslMode('postgres://u:p@db.example.com:5432/prod');
    assert.equal(result.changed, true);
    assert.equal(result.connectionString, 'postgres://u:p@db.example.com:5432/prod?sslmode=verify-full');
  });

  it('appends sslmode=verify-full for ssl=true without sslmode', () => {
    const result = normalizeSslMode('postgres://u:p@db.example.com:5432/prod?ssl=true');
    assert.equal(result.sslmode, 'verify-full');
    assert.ok(result.connectionString.includes('sslmode=verify-full'));
  });

  it('upgrades prefer and verify-ca to verify-full', () => {
    for (const mode of ['prefer', 'verify-ca']) {
      const result = normalizeSslMode(`postgres://u:p@db.example.com/prod?sslmode=${mode}`);
      assert.equal(result.sslmode, 'verify-full');
      assert.ok(result.connectionString.includes('sslmode=verify-full'));
    }
  });

  it('leaves an explicit verify-full untouched (idempotent)', () => {
    const input = 'postgres://u:p@db.example.com/prod?sslmode=verify-full';
    assert.deepEqual(normalizeSslMode(input), { connectionString: input, sslmode: 'verify-full', changed: false, remote: true });
  });

  it('REFUSES disable / no-verify / allow on remote hosts, without leaking the URL', () => {
    for (const mode of ['disable', 'no-verify', 'allow']) {
      assert.throws(
        () => normalizeSslMode(`postgres://secret-user:secret-pass@db.example.com/prod?sslmode=${mode}`),
        (error: Error) => {
          assert.match(error.message, /refusing insecure database connection/);
          assert.match(error.message, new RegExp(`sslmode='${mode}'`));
          // the URL and credentials must NEVER appear in the error
          assert.ok(!error.message.includes('secret-user'));
          assert.ok(!error.message.includes('secret-pass'));
          assert.ok(!error.message.includes('db.example.com'));
          return true;
        },
      );
    }
  });

  it('leaves local/loopback/private hosts completely unchanged', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/dev',
      'postgres://u:p@127.0.0.1:5432/dev?sslmode=disable',
      'postgres://postgres:postgres@192.168.1.10:5432/home-lab?sslmode=require',
      'postgres://u:p@10.0.0.5:5432/internal?sslmode=no-verify',
      'postgres://u:p@db.local:5432/dev',
      'postgres://u:p@[::1]:5432/dev',
    ]) {
      const result = normalizeSslMode(url);
      assert.equal(result.changed, false, `${url} must be untouched`);
      assert.equal(result.connectionString, url);
      assert.equal(result.remote, false);
    }
  });

  it('never logs the connection string (no console output during normalization)', () => {
    // Capture writes to stdout/stderr while normalizing a credential-bearing URL.
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    let leaked = false;
    process.stdout.write = ((chunk: unknown) => { if (String(chunk).includes('super-secret')) leaked = true; return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => { if (String(chunk).includes('super-secret')) leaked = true; return true; }) as typeof process.stderr.write;
    try {
      normalizeSslMode('postgres://user:super-secret@db.example.com/prod?sslmode=require');
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalErr;
    }
    assert.equal(leaked, false);
  });
});
