/**
 * The GitHub credential must resolve through ONE module, with ONE documented precedence, and it
 * must be impossible to learn anything about the value from a presence report.
 *
 * Synthetic values only. Nothing here contacts GitHub, and no literal in this file is a credential:
 * the strings below are non-secret markers chosen so a leak would be visible as the marker itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_TOKEN_AUTHORITATIVE_ENV,
  GITHUB_TOKEN_ENV_NAMES,
  GITHUB_TOKEN_REQUIRED_SCOPES,
  acceptedGithubTokenEnvNames,
  githubCredentialLine,
  githubCredentialStatus,
  isGithubTokenEnvName,
  resolveGithubToken,
} from './github-credential';

const MARKER = 'synthetic-presence-marker';

it('the precedence is one explicit list, authoritative name first', () => {
  assert.deepEqual(GITHUB_TOKEN_ENV_NAMES, ['ZA141251SA_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']);
  assert.equal(GITHUB_TOKEN_AUTHORITATIVE_ENV, 'ZA141251SA_GITHUB_TOKEN');
  assert.deepEqual(acceptedGithubTokenEnvNames('read'), GITHUB_TOKEN_ENV_NAMES);
  assert.deepEqual(acceptedGithubTokenEnvNames('write'), [GITHUB_TOKEN_AUTHORITATIVE_ENV]);
});

it('resolution is deterministic: the highest accepted name wins, and blanks fall through', () => {
  const all = { ZA141251SA_GITHUB_TOKEN: `${MARKER}-authoritative`, GITHUB_TOKEN: `${MARKER}-generic`, GH_TOKEN: `${MARKER}-cli` };
  assert.equal(resolveGithubToken(all), `${MARKER}-authoritative`);
  assert.equal(resolveGithubToken({ GITHUB_TOKEN: all.GITHUB_TOKEN, GH_TOKEN: all.GH_TOKEN }), `${MARKER}-generic`);
  assert.equal(resolveGithubToken({ GH_TOKEN: all.GH_TOKEN }), `${MARKER}-cli`);
  assert.equal(resolveGithubToken({}), null);
  // A set-but-empty variable must not shadow a usable one — that was a real failure mode of `??`.
  assert.equal(resolveGithubToken({ ZA141251SA_GITHUB_TOKEN: '   ', GITHUB_TOKEN: `${MARKER}-generic` }), `${MARKER}-generic`);
  assert.equal(resolveGithubToken({ ZA141251SA_GITHUB_TOKEN: '', GITHUB_TOKEN: '', GH_TOKEN: '' }), null);
  // The order is the list's, not the object's: an env that happens to set GH_TOKEN first still
  // resolves GITHUB_TOKEN ahead of it.
  assert.equal(resolveGithubToken({ GH_TOKEN: `${MARKER}-cli`, GITHUB_TOKEN: `${MARKER}-generic` }), `${MARKER}-generic`);
});

it('a write-capable caller never accepts a fallback name', () => {
  const fallbackOnly = { GITHUB_TOKEN: `${MARKER}-generic`, GH_TOKEN: `${MARKER}-cli` };
  assert.equal(resolveGithubToken(fallbackOnly, { scope: 'write' }), null, 'an ambient CI token is not an owner opt-in for forks and pull requests');
  assert.equal(resolveGithubToken(fallbackOnly, { scope: 'read' }), `${MARKER}-generic`, 'read-only discovery keeps the compatibility it had before');
  assert.equal(githubCredentialStatus(fallbackOnly, { scope: 'write' }).present, false);
  assert.equal(githubCredentialStatus({ ...fallbackOnly, [GITHUB_TOKEN_AUTHORITATIVE_ENV]: `${MARKER}-ok` }, { scope: 'write' }).source, GITHUB_TOKEN_AUTHORITATIVE_ENV);
});

it('presence reports name the winning variable and can carry no other fact about it', () => {
  const value = `${MARKER}-value-abcdefghijklmnopqrstuvwxyz-0123456789`;
  const status = githubCredentialStatus({ [GITHUB_TOKEN_AUTHORITATIVE_ENV]: value });
  assert.deepEqual(Object.keys(status).sort(), ['acceptedNames', 'note', 'present', 'requiredScopes', 'scope', 'source'].sort());
  assert.equal(status.present, true);
  assert.equal(status.source, GITHUB_TOKEN_AUTHORITATIVE_ENV);
  assert.equal(status.scope, 'read');
  assert.deepEqual(status.acceptedNames, GITHUB_TOKEN_ENV_NAMES);
  assert.deepEqual(status.requiredScopes, [...GITHUB_TOKEN_REQUIRED_SCOPES]);
  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes(value), 'the value never appears in the status object');
  assert.ok(!serialized.includes(value.slice(0, 8)), 'nor does a prefix of it');
  assert.ok(!serialized.includes(String(value.length)), 'nor its length');
  assert.ok(!/-----BEGIN|Bearer /.test(serialized), 'and no credential-shaped text is invented either');
  const line = githubCredentialLine({ [GITHUB_TOKEN_AUTHORITATIVE_ENV]: value });
  assert.match(line, new RegExp(GITHUB_TOKEN_AUTHORITATIVE_ENV));
  assert.ok(!line.includes(value) && !line.includes(value.slice(0, 8)) && !line.includes(String(value.length)), 'the log line is presence-only');
  const absent = githubCredentialLine({});
  assert.match(absent, /absent/);
  assert.match(absent, new RegExp(GITHUB_TOKEN_AUTHORITATIVE_ENV), 'an absent report says what to set');
});

it('the resolver is the only place any other file reads those variables', () => {
  const root = process.cwd();
  const forbidden = [/process\.env\.(?:ZA141251SA_GITHUB_TOKEN|GITHUB_TOKEN|GH_TOKEN)\b/, /(?:\benv)\.(?:ZA141251SA_GITHUB_TOKEN|GITHUB_TOKEN|GH_TOKEN)\b/];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      const relative = path.relative(root, full);
      if (relative === path.join('src', 'mission', 'github-credential.ts')) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (forbidden.some(pattern => pattern.test(source))) offenders.push(relative);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'scripts'));
  assert.deepEqual(offenders, [], 'every GitHub credential reader must call resolveGithubToken/githubCredentialStatus instead of touching process.env');
});

it('isGithubTokenEnvName recognises exactly the accepted names', () => {
  for (const name of GITHUB_TOKEN_ENV_NAMES) assert.equal(isGithubTokenEnvName(name), true);
  for (const name of ['ZA141251SA_AWIN_ACCESS_TOKEN', 'GITHUB_CLIENT_SECRET', 'GH_ENTERPRISE_TOKEN', '']) assert.equal(isGithubTokenEnvName(name), false);
});
