import { it } from 'node:test';
import assert from 'node:assert/strict';
import { OciBountySandboxRunner, validateBountyProposal } from './github-bounty-sandbox';

const valid = () => ({
  files: [{ path: 'src/fix.ts', content: 'export const fixed = true;\n' }],
  testArgv: [['npm', 'test', '--', 'fix']],
  commitMessage: 'Fix parser edge case', prTitle: 'Fix parser edge case', prBody: 'Fixes the bounded issue.',
});

it('accepts only a bounded explicit one-file proposal and never shell syntax', () => {
  assert.deepEqual(validateBountyProposal(valid()), valid());
  const traversal = valid(); traversal.files[0].path = '../outside';
  assert.throws(() => validateBountyProposal(traversal), /proposal_invalid_path/);
  const shell = valid(); shell.testArgv = [['sh', '-c', 'npm test']];
  assert.throws(() => validateBountyProposal(shell), /proposal_invalid_test_0/);
  const multiple = valid(); multiple.files.push({ path: 'src/other.ts', content: 'x' });
  assert.throws(() => validateBountyProposal(multiple), /proposal_requires_exactly_one_file/);
});

it('fails closed when an immutable sandbox image digest is not configured', async () => {
  const runner = new OciBountySandboxRunner({ image: 'latest', runtime: 'not-a-runtime' });
  assert.equal(await runner.available(), false);
  await assert.rejects(() => runner.inspect(new Uint8Array([1])), /sandbox_unavailable/);
});
