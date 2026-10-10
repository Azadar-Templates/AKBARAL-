/**
 * Bounty claim eligibility — "discovery accepted" is not "payable to us".
 *
 * WHY THIS EXISTS. Two leads passed the risk screen, got recorded, and looked like work.
 * A live recheck of the actual issues then showed both had already been handed to other
 * contributors by the maintainers ("a bounty that we have reviewed and assigned to
 * @someone", `assignees: ['someone']`), with real PR discussion on them. Discovery cannot
 * see that: it matches labels and titles. Executing either would have burned model spend
 * and CI time on work someone else owns, and preparing a PR for an already-claimed bounty
 * is exactly the kind of spam that gets an account restricted.
 *
 * SO THIS IS A SEPARATE, LATER GATE. It reads the live issue (state, assignees, body,
 * comment text, linked PRs) and returns a verdict that execution refuses to ignore:
 *
 *   · `payable`      — open, unclaimed, no competing PR, terms/acceptance readable
 *   · `not_payable`  — someone else owns it, it is closed, or the program paused it
 *   · `unverifiable` — the live facts are unreadable or the acceptance criteria do not
 *                      exist, so nobody can honestly claim the work is worth paying for
 *
 * `unverifiable` deliberately denies too. A verdict is only as good as the evidence
 * behind it, and "we could not check" must never degrade into "we assumed it was fine".
 * Every verdict carries the matched evidence (quote + field name), so the owner can audit
 * the decision without re-deriving it.
 */

/** Bounded so a hostile issue body cannot inflate the audit or the classifier's work. */
export const MAX_CLAIM_TEXT_BYTES = 60_000;
export const MAX_CLAIM_COMMENTS = 30;

export interface IssueClaimEvidence {
  repoFullName: string;
  issueNumber: number;
  issueUrl?: string;
  /** `open` or `closed`, exactly as the platform reported it. */
  state: string;
  /** GitHub assignee logins. Empty means nobody has been assigned. */
  assignees: string[];
  labels: string[];
  body: string;
  comments?: number;
  /** Comment bodies, oldest first, already bounded by the client. */
  commentTexts?: string[];
  /** Pull requests that reference the issue, when the caller bothered to look. */
  linkedPullRequests?: Array<{ number: number; state: string; url?: string; author?: string | null }>;
  /** Logins that belong to this mission. Only the owner configures these. */
  ourLogins?: string[];
  /** Labels the admitting program treats as its bounty marker. */
  bountyLabels?: string[];
}

export type ClaimState = 'payable' | 'not_payable' | 'unverifiable';

export interface ClaimVerdict {
  state: ClaimState;
  payable: boolean;
  reason: string | null;
  /** Matched text or field values that justify the reason, each ≤ 240 chars. */
  evidence: string[];
  /** Every check that ran, in order — an auditor can see what was actually examined. */
  checks: string[];
  /** Owner actions this verdict implies (never auto-performed). */
  ownerActions: string[];
}

const DEFAULT_BOUNTY_LABELS = ['bounty', 'paid-issue', 'reward', '💎 bounty', 'algora'];

const CLAIM_PATTERNS: Array<{ reason: string; pattern: RegExp; actorGroup?: boolean }> = [
  // Only this pattern captures a login; the others describe intent in prose, so their
  // group 1 must never be mistaken for an account name.
  { reason: 'maintainer_assigned_claimant', pattern: /assigned (?:to|this to) @([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]))/i, actorGroup: true },
  { reason: 'claimant_took_ownership', pattern: /\bi(?:'m| am|ma)?\s+(?:currently\s+)?(?:working on|taking|started|taken|on)\b[^.]{0,80}\bthis\b/i },
  { reason: 'claimant_will_fix', pattern: /\b(i|we)\s+will\s+(?:take|work on|fix|handle)\b[^.]{0,60}\b(this|it|issue)\b/i },
  { reason: 'claimant_pull_request_incoming', pattern: /\b(?:my\s+)?(?:pr|pull request)\b[^.]{0,60}\b(?:incoming|on the way|up soon|coming|ready|opened|open)\b/i },
  { reason: 'claimant_already_submitted_fix', pattern: /\balready\s+(?:submitted|pushed|opened|raised)\b[^.]{0,60}\b(?:pr|fix|patch|pull request)\b/i },
];
/** A request to be assigned is the opposite of a claim — it must not block anyone. */
const ASSIGNMENT_REQUEST = /please\s+(?:re-?)?assign\b[^.]{0,40}\b(?:this|it)\s+to\s+me\b/i;
const PROGRAM_PAUSED = /\b(?:bounty|bounties|program)\b[^.\n]{0,60}\b(?:paused|on hold|suspended|halted|closed temporarily)\b/i;
const ACCEPTANCE_NORMATIVE = /\b(?:acceptance criteria|definition of done|done when|expected behaviou?r|steps to reproduce|should|must|returns?|fails?|throws?|errors?|assert)\b/i;
const PAYMENT_DECLARED = /(?:US)?\$\s?\d[\d,]*(?:\.\d{1,2})?|\b(?:paid|payout|payment|reward|prize)\b[^.\n]{0,40}\b\d/i;
const EXTERNAL_CLAIM_PLATFORM = /\b(?:claim|apply for|start|work on)\b[^.\n]{0,40}\bbounty\b[^.\n]{0,40}\b(?:at|via|on|through)\s*(https?:\/\/\S{1,200})/i;
const TERMS_REFERENCE = /\b(?:bounty program terms|terms (?:&|and) conditions|terms of service|t&c)\b/i;
const HUMAN_VERIFICATION_REQUIRED = /\b(?:KYC|identity verification|human verification|prove you(?:'re| are) (?:human|not a bot)|captcha)\b/i;

function clip(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function normalizedText(value: string): string {
  const text = typeof value === 'string' ? value : '';
  return Buffer.byteLength(text, 'utf8') > MAX_CLAIM_TEXT_BYTES ? text.slice(0, MAX_CLAIM_TEXT_BYTES) : text;
}

function loginSet(logins: Array<string | null | undefined> | undefined): string[] {
  return [...new Set((logins ?? []).map(login => String(login ?? '').trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

/** True when a matched login belongs to this mission (then "already claimed" is good news). */
function isOurs(login: string, ours: string[]): boolean {
  const value = login.trim().toLowerCase();
  return value.length > 0 && ours.includes(value);
}

function firstMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  if (!text) return null;
  try { return text.match(pattern); } catch { return null; }
}

/**
 * The whole decision, from already-fetched facts. No network, no database, no clock:
 * the caller owns freshness and persistence, so this stays auditable in isolation.
 */
export function classifyClaimEligibility(input: IssueClaimEvidence): ClaimVerdict {
  const evidence: string[] = [];
  const checks: string[] = [];
  const ownerActions: string[] = [];
  const ours = loginSet(input.ourLogins);
  const body = normalizedText(String(input.body ?? ''));
  const comments = (input.commentTexts ?? []).slice(0, MAX_CLAIM_COMMENTS).map(comment => normalizedText(String(comment ?? '')));
  const commentary = [body, ...comments].join('\n');
  const labels = Array.isArray(input.labels) ? input.labels.map(label => String(label).trim().toLowerCase()).filter(Boolean) : [];
  const assignees = loginSet(input.assignees);
  const verdict = (state: ClaimState, reason: string | null, extraEvidence: string[] = []): ClaimVerdict => ({
    state, payable: state === 'payable', reason,
    evidence: [...evidence, ...extraEvidence].slice(0, 12), checks, ownerActions,
  });

  // 1. The issue must still be open. `state` comes from the platform, not from us.
  checks.push('issue_state');
  const state = String(input.state ?? '').trim().toLowerCase();
  if (state !== 'open') return verdict('not_payable', `issue_not_open:${state || 'unknown'}`);

  // 2. A bounty marker must still be present. A maintainer who drops the label dropped
  //    the money, and we must not be the last to know.
  checks.push('bounty_label_present');
  const wanted = (input.bountyLabels?.length ? input.bountyLabels : DEFAULT_BOUNTY_LABELS)
    .map(label => String(label).trim().toLowerCase()).filter(Boolean);
  const matchedLabel = labels.find(label => wanted.includes(label)) ?? null;
  if (!matchedLabel) {
    evidence.push(`labels=${clip(labels.join(',') || 'none')}`);
    return verdict('not_payable', 'bounty_label_removed');
  }
  evidence.push(`label=${matchedLabel}`);

  // 3. Assignees are the strongest claim signal the platform actually stores.
  checks.push('assignees_empty');
  if (assignees.length > 0) {
    const oursAssigned = assignees.filter(login => isOurs(login, ours));
    evidence.push(`assignees=${clip(assignees.join(','))}`);
    if (oursAssigned.length === assignees.length) return verdict('payable', null, ['already_assigned_to_us']);
    return verdict('not_payable', oursAssigned.length ? 'shared_with_other_claimants' : 'claimed_by_other_party');
  }

  // 4. Written claims. Most bounty programs put the claim in a comment or the body, not
  //    in the assignee field, so the text has to be read — but only for real claim words.
  //    Each claim is judged inside its own comment: one contributor asking to be assigned
  //    must not cancel out a maintainer assigning it elsewhere, and a comment naming this
  //    mission as the claimant is ours rather than a competitor's.
  checks.push('no_written_claim');
  const sources = [body, ...comments].filter(text => text.length > 0).map(text => ({
    text,
    isRequest: ASSIGNMENT_REQUEST.test(text),
    namesUs: ours.some(login => text.toLowerCase().includes(login)),
  }));
  if (sources.some(source => source.isRequest)) checks.push('assignment_requests_ignored_as_non_claims');
  for (const { reason, pattern, actorGroup } of CLAIM_PATTERNS) {
    for (const source of sources) {
      if (source.isRequest) continue;
      const match = firstMatch(source.text, pattern);
      if (!match) continue;
      const login = actorGroup ? (match[1] ?? null) : null;
      if ((login && isOurs(login, ours)) || source.namesUs) {
        evidence.push(`claimant=${login ?? 'this mission'} (us)`);
        return verdict('payable', null, ['already_claimed_by_us']);
      }
      evidence.push(`${reason}: ${clip(match[0])}`);
      return verdict('not_payable', reason);
    }
  }

  // 5. A competing pull request means the reward is (or is being) paid to somebody else.
  checks.push('no_competing_pull_request');
  const pulls = Array.isArray(input.linkedPullRequests) ? input.linkedPullRequests.slice(0, 10) : [];
  for (const pull of pulls) {
    const author = String(pull?.author ?? '').trim().toLowerCase();
    const pullState = String(pull?.state ?? '').trim().toLowerCase();
    if (pullState === 'merged') { evidence.push(`merged_pr=${String(pull?.number ?? '?')}`); return verdict('not_payable', 'issue_already_resolved_by_pull_request'); }
    if (pullState === 'open' && !(author && isOurs(author, ours))) { evidence.push(`open_pr=${String(pull?.number ?? '?')}${author ? ` by ${author}` : ''}`); return verdict('not_payable', 'competing_pull_request_open'); }
    if (pullState === 'open') return verdict('payable', null, ['our_pull_request_open']);
  }

  // 6. Program status. A paused bounty is not work, it is a queue.
  checks.push('program_not_paused');
  const paused = firstMatch(commentary, PROGRAM_PAUSED);
  if (paused) { evidence.push(`pause: ${clip(paused[0])}`); return verdict('not_payable', 'bounty_program_paused'); }
  const human = firstMatch(commentary, HUMAN_VERIFICATION_REQUIRED);
  if (human) {
    evidence.push(`human_verification: ${clip(human[0])}`);
    ownerActions.push('platform_requires_human_verification: an owner must complete it; the fleet never bypasses identity checks');
    return verdict('unverifiable', 'human_verification_required');
  }

  // 7. Claim routing. When the reward is held by a third-party platform, work may only
  //    start after that claim exists — and claiming is an owner action, not an agent one.
  checks.push('claim_route_known');
  const claimRoute = firstMatch(commentary, EXTERNAL_CLAIM_PLATFORM);
  if (claimRoute) {
    evidence.push(`claim_url=${clip(claimRoute[1] ?? claimRoute[0])}`);
    ownerActions.push('claim_bounty_on_the_named_platform_before_submitting_work');
    return verdict('unverifiable', 'external_claim_platform_required');
  }

  // 8. Payment conditions. No declared amount means nothing to reconcile later, and a
  //    silently assumed amount is worse than no amount.
  checks.push('payment_declared');
  const payment = firstMatch(commentary, PAYMENT_DECLARED);
  if (!payment) {
    evidence.push('payment=none_found');
    return verdict('unverifiable', 'payment_conditions_undeclared');
  }
  evidence.push(`payment=${clip(payment[0])}`);

  // 9. Acceptance criteria. Without a normative statement there is no way to prove the
  //    fix, and an unverifiable deliverable is not a deliverable.
  checks.push('acceptance_criteria_present');
  if (!ACCEPTANCE_NORMATIVE.test(body)) {
    evidence.push('acceptance=no_normative_statement_in_issue_body');
    return verdict('unverifiable', 'acceptance_criteria_undefined');
  }

  // 10. Terms and disclosure. These never block on their own, but the owner must see them
  //     before a submission, so they are recorded as evidence and as owner actions.
  checks.push('program_terms_reviewed');
  const terms = firstMatch(commentary, TERMS_REFERENCE);
  if (terms) {
    evidence.push(`terms: ${clip(terms[0])}`);
    ownerActions.push('review_program_terms_before_submission');
  }
  if (labels.length && !/disclos/i.test(commentary)) ownerActions.push('disclose_ai_authorship_in_the_pull_request');
  return verdict('payable', null);
}

/** Freshness windows. Assignment is cheaper to redo than an executed run, so it is laxer. */
export function claimFreshnessMs(scope: 'assign' | 'execute' = 'assign'): number {
  const raw = Number.parseInt(String(process.env.ZA141251SA_BOUNTY_CLAIM_FRESHNESS_MS ?? ''), 10);
  if (Number.isSafeInteger(raw) && raw >= 0) return raw;
  return scope === 'execute' ? 6 * 3600_000 : 12 * 3600_000;
}

export function isClaimFresh(checkedAt: string | null | undefined, scope: 'assign' | 'execute' = 'assign', now = Date.now()): boolean {
  const maximum = claimFreshnessMs(scope);
  if (maximum === 0) return true;
  const stamp = Date.parse(String(checkedAt ?? ''));
  if (!Number.isFinite(stamp)) return false;
  return now - stamp <= maximum && stamp - now <= 60_000;
}
