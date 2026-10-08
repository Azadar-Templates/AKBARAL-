import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural check only: the owner runbook exists and keeps its required
 * sections. This test does not exercise any behaviour.
 */
const RUNBOOK = path.resolve(__dirname, '../../docs/OWNER_BOUNTY_PROGRAM_SETUP.md');

const REQUIRED_HEADINGS = [
  '## 0. Ground rules',
  '## 1. Prerequisites checklist',
  '## 2. Owner-only routes',
  '## 3. Step-by-step program registration',
  '### 3.1 Immunefi',
  '### 3.2 Code4rena',
  '### 3.3 Sherlock',
  '### 3.4 HackerOne',
  '### 3.5 Bugcrowd',
  '## 4. Copy-paste request examples',
  '## 5. Explicit warning section',
  '## 6. Verification steps',
  '## 7. What will not work yet',
  '## 8. Owner setup required',
];

test('owner bounty program runbook exists and has every required section', () => {
  const text = readFileSync(RUNBOOK, 'utf8');
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(text.includes(heading), `missing heading: ${heading}`);
  }
});
