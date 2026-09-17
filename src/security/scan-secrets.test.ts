import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { realFindings, scanSecretMarkers } from '../../scripts/scan-secrets';

/**
 * The secret scan is a launch gate: it must fail on a real credential and must
 * not be silenceable. These tests lock both properties, including the limit of
 * the path-scoped placeholder exemptions.
 *
 * Credential-shaped strings below are ASSEMBLED at runtime so this test file
 * itself contains no scannable marker (the same convention used by
 * src/config/env.test.ts) — otherwise the gate would flag its own test.
 */

const REPO_ROOT = process.cwd();

/** A synthetic DSN that only exists as runtime data, never as source text. */
const FAKE_DSN = ['postgres', '://u:p@db.example.com:5432/prod'].join('');

function makeTempTree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scan-secrets-'));
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

describe('secret scan gate', () => {
  it('detects a real-looking credential anywhere in the tree', () => {
    const root = makeTempTree();
    try {
      write(root, 'src/leaked.ts', `const key = '${['sk', 'a1b2c3d4e5'.repeat(4)].join('-')}';\n`);
      const real = realFindings(scanSecretMarkers({ root, baseDir: REPO_ROOT }));
      assert.equal(real.length, 1, 'the OpenAI-shaped key must be a real finding');
      assert.equal(real[0].pattern, 'openai-key');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows a documented placeholder only on the allow-listed path', () => {
    const root = makeTempTree();
    try {
      const dsn = `const url = '${FAKE_DSN}';\n`;
      // Same content in two locations: the allow-listed test file and a random
      // source file. Only the documented file may pass.
      write(root, 'src/db/pg-connection.test.ts', dsn);
      write(root, 'src/somewhere/else.ts', dsn);
      const real = realFindings(scanSecretMarkers({ root, baseDir: REPO_ROOT }));
      assert.equal(real.length, 1);
      assert.equal(real[0].path, 'src/somewhere/else.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never lets a path exemption hide a key-shaped secret', () => {
    const root = makeTempTree();
    try {
      // The allow-listed path is exempted for connection strings ONLY. A real
      // API key pasted into that same file must still fail the scan.
      write(
        root,
        'src/db/pg-connection.test.ts',
        `const url = '${FAKE_DSN}';\nconst key = '${['AIza', 'AbCdEfGh1234567890123456'].join('')}0';\n`,
      );
      const real = realFindings(scanSecretMarkers({ root, baseDir: REPO_ROOT }));
      assert.equal(real.length, 1, 'the Google-shaped key must survive the path exemption');
      assert.equal(real[0].pattern, 'google-api-key');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('strict mode reports even the allow-listed placeholders (nothing can be hidden)', () => {
    const root = makeTempTree();
    try {
      write(root, 'src/db/pg-connection.test.ts', `const url = '${FAKE_DSN}';\n`);
      assert.equal(realFindings(scanSecretMarkers({ root, baseDir: REPO_ROOT })).length, 0, 'allowed in normal mode');
      const strict = scanSecretMarkers({ root, baseDir: REPO_ROOT, strict: true });
      assert.equal(strict.length, 1, 'strict mode ignores the allowlist');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('the repository working tree itself is clean', () => {
    const real = realFindings(scanSecretMarkers({ root: REPO_ROOT, baseDir: REPO_ROOT }));
    assert.deepEqual(
      real.map((finding) => `${finding.path}:${finding.line} (${finding.pattern})`),
      [],
      'no real secret marker may be committed',
    );
  });
});
