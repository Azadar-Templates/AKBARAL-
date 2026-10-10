/** Pure classifier tests. No network, no database — the point is that the rules are readable. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { classifyClaimEligibility, claimFreshnessMs, isClaimFresh, MAX_CLAIM_COMMENTS } = require('./github-bounty-eligibility') as typeof import('./github-bounty-eligibility');

const BASE = {
  repoFullName: 'acme/widget',
  issueNumber: 7,
  state: 'open',
  assignees: [] as string[],
  labels: ['bounty'],
  body: 'Bounty: $1,000 for a tested fix. The parser should preserve a backslash.',
  comments: 0,
  commentTexts: [] as string[],
};
const classify = (overrides: Record<string, unknown> = {}) => classifyClaimEligibility({ ...BASE, ...overrides });

test('an open, unclaimed, paid and specified issue is payable work', () => {
  const verdict = classify();
  assert.equal(verdict.state, 'payable');
  assert.equal(verdict.payable, true);
  assert.equal(verdict.reason, null);
  assert.ok(verdict.checks.includes('assignees_empty') && verdict.checks.includes('payment_declared'));
  assert.ok(verdict.evidence.some(item => /label=bounty/.test(item)));
});

test('the assignee field is decisive, in both directions', () => {
  const taken = classify({ assignees: ['samiyadev786'] });
  assert.equal(taken.state, 'not_payable');
  assert.equal(taken.reason, 'claimed_by_other_party');
  assert.ok(taken.evidence.some(item => /samiyadev786/.test(item)));

  assert.equal(classify({ assignees: ['mission-bot'], ourLogins: ['mission-bot'] }).state, 'payable');
  const shared = classify({ assignees: ['mission-bot', 'someone-else'], ourLogins: ['mission-bot'] });
  assert.equal(shared.state, 'not_payable');
  assert.equal(shared.reason, 'shared_with_other_claimants');
});

test('a maintainer claim written in prose counts even when nobody was assigned', () => {
  // This is the exact shape of both leads discovery accepted and the mission could not be
  // paid for: the assignee field was set in one case and only the body carried it in the other.
  const body = 'This is part of the Tenstorrent Bounty Program Terms & Conditions. This is a bounty that we have reviewed and assigned to @samiyadev786.';
  const verdict = classify({ body });
  assert.equal(verdict.state, 'not_payable');
  assert.equal(verdict.reason, 'maintainer_assigned_claimant');
  assert.ok(verdict.evidence.some(item => /samiyadev786/.test(item)), JSON.stringify(verdict.evidence));
});

test('comment claims are read, but a request to be assigned is not a claim', () => {
  assert.equal(classify({ comments: 1, commentTexts: ["I'm working on this — expect a PR this week."] }).reason, 'claimant_took_ownership');
  assert.equal(classify({ comments: 1, commentTexts: ['Already submitted a PR with the fix.'] }).reason, 'claimant_already_submitted_fix');
  assert.equal(classify({ comments: 1, commentTexts: ['My PR is incoming, thanks!'] }).reason, 'claimant_pull_request_incoming');
  assert.equal(classify({ comments: 1, commentTexts: ['Please assign this to me, I would like to work on it.'] }).state, 'payable', 'wanting the bounty is not having the bounty');
  assert.equal(classify({ comments: 1, commentTexts: ['Looks hard, good luck!'] }).state, 'payable');
});

test('a claim made by this mission is good news, not a blocker', () => {
  const ours = classify({ comments: 1, commentTexts: ['mission-bot: I will take this issue.'], ourLogins: ['mission-bot'] });
  assert.equal(ours.state, 'payable');
  assert.ok(ours.evidence.some(item => /us/.test(item)));
  const theirs = classify({ comments: 1, commentTexts: ['someone-else: I will take this issue.'], ourLogins: ['mission-bot'] });
  assert.equal(theirs.state, 'not_payable');
  assert.equal(theirs.reason, 'claimant_will_fix');
});

test('closed, unlabelled and paused are all not payable, for different reasons', () => {
  assert.equal(classify({ state: 'closed' }).reason, 'issue_not_open:closed');
  assert.equal(classify({ state: 'pull_request' }).reason, 'issue_not_open:pull_request');
  assert.equal(classify({ labels: ['good first issue'] }).reason, 'bounty_label_removed');
  assert.equal(classify({ labels: [] }).reason, 'bounty_label_removed');
  assert.equal(classify({ body: 'Bounty: $100. The bounty is currently on hold while we reorganise. should pass.' }).reason, 'bounty_program_paused');
});

test('a competing pull request ends the question', () => {
  assert.equal(classify({ linkedPullRequests: [{ number: 12, state: 'open', author: 'other' }] }).reason, 'competing_pull_request_open');
  assert.equal(classify({ linkedPullRequests: [{ number: 12, state: 'merged', author: 'other' }] }).reason, 'issue_already_resolved_by_pull_request');
  assert.equal(classify({ linkedPullRequests: [{ number: 12, state: 'open', author: 'mission-bot' }], ourLogins: ['mission-bot'] }).state, 'payable');
  assert.equal(classify({ linkedPullRequests: [{ number: 12, state: 'closed', author: 'other' }] }).state, 'payable', 'a rejected PR frees the bounty again');
});

test('unverifiable beats assumed-payable for anything we cannot actually honour', () => {
  const noMoney = classify({ body: 'The parser should preserve a backslash. Fix it.' });
  assert.equal(noMoney.state, 'unverifiable');
  assert.equal(noMoney.reason, 'payment_conditions_undeclared');

  const noCriteria = classify({ body: 'Bounty: $500. Something is weird around escaping maybe?' });
  assert.equal(noCriteria.state, 'unverifiable');
  assert.equal(noCriteria.reason, 'acceptance_criteria_undefined');

  const humanGate = classify({ body: 'Bounty: $500. should pass. Complete KYC before starting.' });
  assert.equal(humanGate.reason, 'human_verification_required');
  assert.ok(humanGate.ownerActions.some(action => /never bypasses identity checks/.test(action)), 'identity work is always routed to the owner');

  const externalClaim = classify({ body: 'Bounty: $500. should pass. Claim this bounty at https://algora.io/missions/acme/123 to start.' });
  assert.equal(externalClaim.reason, 'external_claim_platform_required');
  assert.ok(externalClaim.ownerActions.some(action => /claim_bounty_on_the_named_platform/.test(action)));
});

test('terms and disclosure are recorded as owner actions, never as silent permission', () => {
  const verdict = classify({ body: 'Bounty: $500 subject to the Bounty Program Terms & Conditions. Tests must pass.' });
  assert.equal(verdict.state, 'payable');
  assert.ok(verdict.ownerActions.includes('review_program_terms_before_submission'));
  assert.ok(verdict.ownerActions.includes('disclose_ai_authorship_in_the_pull_request'));
});

test('hostile and oversized input degrade to refusals, not to crashes', () => {
  const huge = classify({ body: `Bounty: $100. ${'a'.repeat(200_000)} should pass.` });
  assert.ok(['payable', 'unverifiable', 'not_payable'].includes(huge.state));
  assert.notEqual(classify({ body: 42 as never }).state, 'payable', 'a non-string body is not evidence of anything');
  assert.equal(classify({ assignees: ['a'.repeat(500), 'x'.repeat(500)] as never }).reason, 'claimed_by_other_party');
  assert.ok(classify({ comments: 999, commentTexts: Array.from({ length: 400 }, () => 'x'.repeat(5_000)) }).evidence.length <= 12);
});

test('the bounty label vocabulary is configurable', () => {
  assert.equal(classify({ labels: ['reward'] }).state, 'payable', 'common marketplace labels are recognised by default');
  assert.equal(classify({ labels: ['sponsor-paid'] }).state, 'not_payable');
  assert.equal(classify({ labels: ['sponsor-paid'], bountyLabels: ['sponsor-paid'] }).state, 'payable');
});

test('freshness decays instead of persisting, and a zero window means always re-check', () => {
  const assignWindow = claimFreshnessMs('assign'), executeWindow = claimFreshnessMs('execute');
  assert.ok(assignWindow > executeWindow, 'spending effort must require fresher evidence than bookkeeping');
  assert.equal(isClaimFresh(new Date(Date.now() - 1000).toISOString(), 'execute'), true);
  assert.equal(isClaimFresh(new Date(Date.now() - assignWindow - 1000).toISOString(), 'assign'), false);
  assert.equal(isClaimFresh(null, 'assign'), false);
  assert.equal(isClaimFresh('not a date', 'assign'), false);
  assert.equal(isClaimFresh(new Date(Date.now() + 10 * 60 * 1000).toISOString(), 'assign'), false, 'a clock in the future is not evidence of freshness');
  assert.equal(MAX_CLAIM_COMMENTS, 30);
});
