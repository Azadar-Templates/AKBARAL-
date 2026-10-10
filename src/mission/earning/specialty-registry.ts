/**
 * The single source of truth for what a mission specialist actually is.
 *
 * A specialist is not a renamed agent and not a different system prompt: it is an agent paired with
 * one earning venue **and** allowed to do only the kinds of work that venue pays for. That pairing is
 * a policy decision, so it lives in one config file that the catalog, the fleet gates and the owner
 * console all read — never in a prompt, never in a dashboard label.
 *
 * Two facts per specialty:
 *   · `does`       the named work kinds it is trained and graded against;
 *   · `classes`    the registry opportunity classes it may be assigned work from.
 * `classes` is what the assignment gate enforces (`specialist_specialty_mismatch`), and `does` is
 * what the evaluation suite and the owner's record view display.
 */

/** Every kind of work the mission knows how to do, verify and get paid for. */
export const WORK_KINDS = [
  'code-review',
  'smart-contract-audit',
  'test-authoring',
  'doc-authoring',
  'triage',
  'vulnerability-report',
  'contest-submission',
  'deliverable-build',
  'data-labeling',
  'model-eval',
  'grant-writing',
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export interface SpecialtyDefinition {
  readonly label: string;
  /** What the specialist is for, in the owner's words. */
  readonly does: readonly WorkKind[];
  /** Keys of `OPPORTUNITY_REGISTRY` this specialty may be assigned work from. */
  readonly classes: readonly string[];
  /** Why these kinds of work: what the venue pays for, in one line. */
  readonly rationale: string;
}

export const SPECIALIST_SPECIALTIES: Readonly<Record<string, SpecialtyDefinition>> = Object.freeze({
  github_bounty_engineer: {
    label: 'GitHub bounty engineer',
    does: ['code-review', 'test-authoring', 'doc-authoring', 'triage'],
    classes: ['github_issue_bounties', 'software_development'],
    rationale: 'Issue bounties are paid for merged patches: read the repo, change code, add the test the maintainer asked for.',
  },
  agent_deliverable_specialist: {
    label: 'Agent deliverable specialist',
    does: ['deliverable-build', 'doc-authoring', 'test-authoring'],
    classes: ['software_development', 'microtasks_labeling', 'contests_challenges'],
    rationale: 'Agent marketplaces pay for a named artifact delivered against posted acceptance criteria, not for volume.',
  },
  defi_vulnerability_hunter: {
    label: 'DeFi vulnerability hunter',
    does: ['smart-contract-audit', 'vulnerability-report', 'code-review'],
    classes: ['bug_bounties', 'contests_challenges'],
    rationale: 'Live DeFi programs pay for an exploitable, reproducible finding inside the scoped contracts.',
  },
  evm_audit_contestant: {
    label: 'EVM audit contestant',
    does: ['smart-contract-audit', 'contest-submission', 'code-review'],
    classes: ['contests_challenges', 'bug_bounties'],
    rationale: 'Audit contests score findings against the contest scope and window; the report is the deliverable.',
  },
  beginner_audit_contestant: {
    label: 'Beginner audit contestant',
    does: ['smart-contract-audit', 'test-authoring', 'contest-submission'],
    classes: ['contests_challenges'],
    rationale: 'Entry-tier contest scopes exist to be completed by a careful reader, so the fit is graded, not assumed.',
  },
  senior_audit_specialist: {
    label: 'Senior audit specialist',
    does: ['smart-contract-audit', 'code-review', 'contest-submission'],
    classes: ['contests_challenges', 'bug_bounties'],
    rationale: 'Senior pools pay for severity-qualified findings with a working PoC and a written impact chain.',
  },
  audit_network_member: {
    label: 'Audit network member',
    does: ['smart-contract-audit', 'code-review', 'doc-authoring'],
    classes: ['bug_bounties', 'contests_challenges'],
    rationale: 'Engagement networks route paid reviews to members; the work is a review packet, not a vulnerability claim.',
  },
  contract_library_reviewer: {
    label: 'Contract library reviewer',
    does: ['code-review', 'smart-contract-audit', 'doc-authoring'],
    classes: ['bug_bounties'],
    rationale: 'Library programs pay for reviewed invariants and safe-API findings against a pinned release.',
  },
  web_vulnerability_reporter: {
    label: 'Web vulnerability reporter',
    does: ['vulnerability-report', 'triage', 'test-authoring'],
    classes: ['bug_bounties'],
    rationale: 'Web platforms pay for a reproducible report inside scope, with impact and remediation, never for a scan dump.',
  },
  crowd_tester: {
    label: 'Crowd tester',
    does: ['test-authoring', 'triage', 'vulnerability-report'],
    classes: ['bug_bounties', 'microtasks_labeling'],
    rationale: 'Crowdtest scopes are enumerated and time-boxed; the earning unit is a valid, non-duplicate reproduction.',
  },
  eu_disclosure_researcher: {
    label: 'EU disclosure researcher',
    does: ['vulnerability-report', 'triage', 'doc-authoring'],
    classes: ['bug_bounties'],
    rationale: 'EU platforms reward coordinated disclosure with European-language reports and scope discipline.',
  },
  wordpress_plugin_auditor: {
    label: 'WordPress plugin auditor',
    does: ['code-review', 'vulnerability-report', 'triage'],
    classes: ['bug_bounties'],
    rationale: 'Plugin programmes pay per verified affected version range, so the audit target is a tagged release.',
  },
  wordpress_vulnerability_researcher: {
    label: 'WordPress vulnerability researcher',
    does: ['vulnerability-report', 'test-authoring', 'triage'],
    classes: ['bug_bounties'],
    rationale: 'Research disclosure on plugins and themes needs a tested proof, not a claim about code smell.',
  },
  quest_worker: {
    label: 'Quest worker',
    does: ['data-labeling', 'triage', 'doc-authoring'],
    classes: ['microtasks_labeling'],
    rationale: 'Quest/labeling venues pay per verified task; the earning unit is a graded contribution, not an opinion.',
  },
  hackathon_builder: {
    label: 'Hackathon builder',
    does: ['deliverable-build', 'test-authoring', 'doc-authoring'],
    classes: ['contests_challenges', 'open_source_sponsorship'],
    rationale: 'Hackathon prizes are judged on a running submission plus the write-up that lets a judge reproduce it.',
  },
  open_contest_auditor: {
    label: 'Open contest auditor',
    does: ['smart-contract-audit', 'contest-submission', 'code-review'],
    classes: ['contests_challenges'],
    rationale: 'Open audit contests rank findings by quality; duplicates are paid last or not at all.',
  },
  security_review_specialist: {
    label: 'Security review specialist',
    does: ['code-review', 'smart-contract-audit', 'vulnerability-report'],
    classes: ['bug_bounties', 'contests_challenges'],
    rationale: 'Review-shaped scopes pay for a documented assessment with severity, which needs both review and reporting skill.',
  },
  audit_contest_specialist: {
    label: 'Audit contest specialist',
    does: ['smart-contract-audit', 'contest-submission', 'code-review'],
    classes: ['contests_challenges', 'bug_bounties'],
    rationale: 'Contest windows are fixed, so the specialty is finding quality under a deadline with a checkable report format.',
  },
  ml_competition_modeler: {
    label: 'ML competition modeler',
    does: ['model-eval', 'data-labeling', 'test-authoring'],
    classes: ['contests_challenges', 'microtasks_labeling'],
    rationale: 'Eval competitions score a submitted artifact against a private set; medals are not revenue until a prize is paid.',
  },
  grant_writer: {
    label: 'Grant writer',
    does: ['grant-writing', 'doc-authoring', 'triage'],
    classes: ['open_source_sponsorship', 'contests_challenges'],
    rationale: 'Grants and sponsorships pay on a proposal cycle, so the work is evidence-backed writing against a stated scope.',
  },
});

export type SpecialtyKey = keyof typeof SPECIALIST_SPECIALTIES;

/** Known specialty keys, sorted, so a report can enumerate the whole surface. */
export function knownSpecialties(): string[] {
  return Object.keys(SPECIALIST_SPECIALTIES).sort();
}

export function specialtyFor(key: string | null | undefined): SpecialtyDefinition | null {
  if (!key) return null;
  return SPECIALIST_SPECIALTIES[key] ?? null;
}

export function workKindsFor(key: string | null | undefined): WorkKind[] {
  return [...(specialtyFor(key)?.does ?? [])];
}

/**
 * The one question the assignment gate asks: may this specialty be handed work of this class?
 * An unknown specialty or class is a **refusal**, never a permissive default — a specialist that
 * cannot prove its fit does not get the opportunity.
 */
export function isSpecialtyFit(specialtyKey: string | null | undefined, opportunityClass: string | null | undefined): boolean {
  const specialty = specialtyFor(specialtyKey);
  if (!specialty || !opportunityClass) return false;
  return specialty.classes.includes(opportunityClass);
}

/** Short owner-facing description, built from the config so it cannot drift from the gate. */
export function describeSpecialty(key: string | null | undefined): string {
  const specialty = specialtyFor(key);
  if (!specialty) return 'unregistered specialty';
  return `${specialty.label}: ${specialty.does.join(', ')}`;
}
