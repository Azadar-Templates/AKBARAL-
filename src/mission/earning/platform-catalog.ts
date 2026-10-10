/**
 * Verified platform catalog — the fleet's list of places where real work and real payment
 * exist, with a dated evidence record behind every claim.
 *
 * WHY A SEPARATE EVIDENCE TABLE. `mission_platforms.status` answers "what has the owner
 * permitted?"; it cannot answer "is this place open for work today?". Those questions have
 * different lifetimes: Code4rena announced its wind-down on 13 May 2026, while Patchstack
 * stayed open but rewrote its rules on 1 June 2026 specifically because of low-quality
 * AI-generated reports. A status column that reads ACTIVE for both is worse than useless
 * when the fleet has to choose where to send work. So every platform carries zero or more
 * evidence rows (`mission_platform_evidence`), the newest record decides whether assignment
 * is allowed, and a stale or missing record fails closed.
 *
 * WHAT THE RECORDS BELOW ARE. Each entry is a reading taken today: what the venue is, whether
 * it is open, what an account requires, how it pays, what it says about automation, and which
 * sources the reading came from. Anything not verified today is recorded `unverified` with
 * the reason, never guessed into `active` — including platforms the owner named that could
 * not be confirmed (Paladin, Layer3, Hats Finance) and ones that turn out not to be
 * marketplaces at all (OpenZeppelin's bounty is a single program hosted on Immunefi; DoraHacks
 * refuses automated reads).
 */

import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row, type SqlValue } from '../database';
import { MoneyError, type MoneyActor } from '../money';
import { discoverPlatform, getPlatform, qualifyPlatform, submitForPolicyReview, restrictPlatform } from './platform-discovery';
import { listConnectorContracts } from './connector-execution-contracts';
import { AGENT_CLASS_CONTRACTS, type GrantablePermission } from './agent-class-contracts';

function deny(code: string, detail?: string): never {
  throw new MoneyError(code, detail ? `${code}: ${detail}` : code);
}

export type PlatformVerdict = 'active' | 'inactive' | 'blocked' | 'unsuitable' | 'unverified';
export type AutomationPolicy = 'permitted' | 'restricted' | 'prohibited' | 'unknown';
export type PlatformCategory =
  | 'github_engineering'
  | 'agent_native_marketplace'
  | 'smart_contract_security'
  | 'web_vulnerability_disclosure'
  | 'ai_eval_data_competition'
  | 'hackathon_grant'
  | 'other';

/** Owner-defined grouping labels. A label is not a credential and never implies one exists. */
export const GMAIL_GROUPS = ['mission', 'gmail-1', 'gmail-2', 'gmail-3', 'gmail-4'] as const;
export type GmailGroup = (typeof GMAIL_GROUPS)[number];

/**
 * Which groupings the owner has authorized accounts for. Standing constraint: three Gmail
 * identities are authorized for this mission, while the proposed mapping also uses `gmail-4`.
 * A platform in an unauthorized grouping can still be *specialized* — the role, rules and
 * skills are real — but its access gate stays `NEEDS_OWNER_ACTION` until the owner resolves
 * the grouping. This is recorded as data, not worked around.
 */
export const AUTHORIZED_ACCOUNT_GROUPS: readonly GmailGroup[] = ['mission', 'gmail-1', 'gmail-2', 'gmail-3'];

export interface PlatformSkillSpec {
  readonly key: string;
  readonly label: string;
  /** The evaluation task key that proves this skill, or the skill is not claimed. */
  readonly evaluatedBy: string;
}

export interface PlatformRecord {
  readonly platformId: string;
  readonly label: string;
  readonly category: PlatformCategory;
  /**
   * A key of the existing `OPPORTUNITY_REGISTRY`, never a new one. The registry already carries
   * the twelve-point class model (autonomy permission, payout verifiability, country limits,
   * account requirements, exclusivity), so a venue is mapped onto a class rather than given a
   * private label the rest of the system cannot reason about.
   */
  readonly opportunityClass: string;
  readonly gmailGroup: GmailGroup;
  readonly specialtyKey: string;
  readonly displayRole: string;
  readonly agentClass: 'bounty_research' | 'bounty_execution' | 'evidence_verification';
  readonly officialUrl: string;
  readonly verdict: PlatformVerdict;
  readonly verdictReason: string;
  readonly automationPolicy: AutomationPolicy;
  readonly openOpportunities: number | null;
  readonly maxRewardUsdCents: number | null;
  readonly accountRequirements: readonly string[];
  readonly paymentConditions: readonly string[];
  readonly submissionRequirements: readonly string[];
  readonly scopeRules: readonly string[];
  readonly rejectionCodes: readonly string[];
  readonly deadlinePolicy: string;
  readonly skills: readonly PlatformSkillSpec[];
  /** Must name a registered connector contract. A capability the fleet does not have is recorded
   * as a note, never as a tool grant: the profile lists it as unresolved and nothing is widened. */
  readonly toolKeys: readonly string[];
  readonly sourceCitations: readonly { readonly url: string; readonly note: string }[];
  readonly observedAt: string;
  /** `api` = read from a machine surface today; `none` = nothing was read, hence unverified. */
  readonly verifiedVia: 'api' | 'documented' | 'secondary_source' | 'none';
  readonly notes?: string;
}

const TODAY = '2026-10-10';

function skill(key: string, label: string, evaluatedBy: string): PlatformSkillSpec {
  return { key, label, evaluatedBy };
}

const SECURITY_SKILLS = [
  skill('asset_scope_check', 'refuse any target not explicitly in scope', 'scope'),
  skill('reproduction_writing', 'produce a report a reviewer can reproduce', 'evidence'),
  skill('severity_rubric', 'classify against the venue rubric, not intuition', 'severity'),
  skill('duplicate_screening', 'screen known issues and prior reports first', 'duplicates'),
  skill('disclosure_hygiene', 'hold disclosure until the venue and fix allow it', 'disclosure'),
];

/**
 * The owner's proposed mapping, verified today, ordered by how reachable the work actually
 * is. Inactive, blocked and unsuitable rows are present on purpose: the fleet has to be able
 * to say *why* a named platform took no agent.
 */
export const VERIFIED_PLATFORM_RECORDS: readonly PlatformRecord[] = [
  {
    platformId: 'github_issue_bounties',
    label: 'GitHub funded issue bounties',
    category: 'github_engineering',
    opportunityClass: 'github_issue_bounties',
    gmailGroup: 'mission',
    specialtyKey: 'github_bounty_engineer',
    displayRole: 'GitHub bounty engineer — issues, funded work, patches, tests, pull requests',
    agentClass: 'bounty_execution',
    officialUrl: 'https://docs.github.com/en/rest/issues',
    verdict: 'active',
    verdictReason: 'read live today: thousands of open issues carry a bounty label and repository policy files are machine-readable',
    automationPolicy: 'permitted',
    openOpportunities: 3807,
    maxRewardUsdCents: 300_000,
    accountRequirements: ['owner GitHub credential', 'fork plus contents write plus pull-request write to submit'],
    paymentConditions: ['per-repository terms; most programs pay only after the maintainer merges', 'a bare label is no escrow guarantee'],
    submissionRequirements: ['reproducible fix', 'relevant tests passing', 'AI disclosure where the repository asks for it', 'one pull request per claimed issue'],
    scopeRules: ['allowlisted repositories only', 'never an issue already assigned or promised to someone else', 'no drive-by pull requests'],
    rejectionCodes: ['claimed_by_other_party', 'no_stated_amount', 'policy_forbids_ai', 'tests_not_passing', 'out_of_scope_repo'],
    deadlinePolicy: 'no fuse; a claim can be overtaken, so work is time-boxed',
    skills: [
      skill('bounty_terms_reading', 'read bounty terms and payment conditions from the issue and repository files', 'terms'),
      skill('claim_verification', 'decide payable / not_payable / unverifiable from live issue state', 'claim'),
      skill('scoped_repository_edit', 'patch inside the allowlisted repository only', 'scope'),
      skill('test_execution', 'run the repository tests in the sandbox and read the exit code', 'tests'),
      skill('disclosure_and_report', 'write a compliant pull-request body with AI disclosure', 'disclosure'),
    ],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://api.github.com/search/issues?q=label:bounty+state:open+is:issue+no:assignee', note: 'live count observed today' },
      { url: 'https://docs.github.com/en/rest/issues', note: 'official REST surface the discovery client uses' },
    ],
    observedAt: TODAY,
    verifiedVia: 'api',
    notes: 'The pool is large and mostly unusable: farms, clones and honeypots dominate. The gate that matters is the live claim recheck, not the label count.',
  },
  {
    platformId: 'frantic_agent_marketplace',
    label: 'Frantic agent bounty board',
    category: 'agent_native_marketplace',
    opportunityClass: 'software_development',
    gmailGroup: 'mission',
    specialtyKey: 'agent_deliverable_specialist',
    displayRole: 'Agent-deliverable specialist — reproducible artifacts sealed to a public receipt ledger',
    agentClass: 'bounty_execution',
    officialUrl: 'https://gofrantic.com',
    verdict: 'active',
    verdictReason: 'board read live today: 6 bounties open, 802 USD funded, 1302.85 USD settled on the public ledger',
    automationPolicy: 'permitted',
    openOpportunities: 6,
    maxRewardUsdCents: 2000,
    accountRequirements: ['agent enlistment with the owner GitHub handle and a deliverable owner email', 'email verification before any paid claim', 'one identity per operator: extra accounts to change tiers are forbidden by the venue and by us'],
    paymentConditions: ['the venue pays the worker the full posted price', 'x402 wallet payout is native, Stripe Connect is an optional bank off-ramp', 'every payout is sealed to a public receipt, which is verifiable settlement evidence'],
    submissionRequirements: ['public_url, evidence_json, receipt_ref and report bound by name', 'a durable credible host for public_url, response under 1000000 bytes', 'evidence observations must record the tool version the venue requires'],
    scopeRules: ['claim through the venue API only, never through the mirrored GitHub issues', 'deliver inside the claim fuse or the slot is lost', 'no unverifiable evidence'],
    rejectionCodes: ['oversized_artifact', 'preview_or_placeholder_host', 'self_fork_target', 'missing_evidence_404', 'claim_expired'],
    deadlinePolicy: 'claim fuse: about an hour for a new agent, up to six earned, or the poster window if longer',
    skills: [
      skill('board_reading', 'read the machine board and its per-bounty claim gate', 'board'),
      skill('eligibility_tiers', 'know which tier a fresh identity may claim', 'tier'),
      skill('artifact_packaging', 'bind named artifacts and compute the evidence digest', 'artifacts'),
      skill('durability_screening', 'reject preview hosts, oversized payloads and self-authored targets', 'durability'),
      skill('receipt_verification', 'verify a payout against its public receipt', 'receipt'),
    ],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://gofrantic.com/v1/board', note: 'live board read today, including per-bounty claim states' },
      { url: 'https://gofrantic.com/v1/policy', note: 'live economy read today' },
      { url: 'https://gofrantic.com/SKILL.md', note: 'venue rules, tiers, payout rails, refusal of multi-identity' },
      { url: 'https://github.com/auscaster/frantic-board', note: 'mirrored board issues; explicitly not the protocol surface' },
    ],
    observedAt: TODAY,
    verifiedVia: 'api',
    notes: 'One open row today is engineering work rather than third-party posting: bounty 33, 20 USD, funded, one slot.',
  },
  {
    platformId: 'immunefi',
    label: 'Immunefi',
    category: 'smart_contract_security',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-1',
    specialtyKey: 'defi_vulnerability_hunter',
    displayRole: 'DeFi vulnerability hunter — in-scope protocol research with proof of concept',
    agentClass: 'bounty_research',
    officialUrl: 'https://immunefi.com',
    verdict: 'active',
    verdictReason: 'live program pages read today (updated through September 2026); the venue absorbed Code4rena clients and researchers',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: 100_000_000,
    accountRequirements: ['human operator account', 'KYC for payout on most programs: government ID, date of birth, proof of address, OFAC screening', 'project contributors and recently-paid technical contributors are ineligible'],
    paymentConditions: ['per-program terms, often a share of funds at risk with a stated minimum', 'KYC is a precondition of payment, and KYC is a human action this fleet never performs or bypasses'],
    submissionRequirements: ['proof of concept for every severity', 'report against the venue severity classification system', 'program rules take primacy over any external rubric'],
    scopeRules: ['in-scope deployments only', 'no destructive testing, no unauthorized access, no MEV or social engineering', 'known-issue lists exclude prior reports'],
    rejectionCodes: ['kyc_pending', 'no_poc', 'known_issue', 'out_of_scope', 'ineligible_contributor', 'informational_only'],
    deadlinePolicy: 'no fuse; first-valid-report primacy, so duplicates are rejected',
    skills: SECURITY_SKILLS,
    toolKeys: [],
    sourceCitations: [
      { url: 'https://immunefi.com/bug-bounty/openzeppelin/information/', note: 'read today: 25000 USD maximum, PoC required, KYC required' },
      { url: 'https://immunefi.com/bug-bounty/immutable/information/', note: 'KYC: government ID and PII collected by an external verifier for payout' },
      { url: 'https://immunefi.com/bug-bounty/KAST/information/', note: 'eligibility criteria including OFAC SDN exclusion' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'The profile is assignable; execution and payout stay gated on owner-held identity.',
  },
  {
    platformId: 'sherlock',
    label: 'Sherlock',
    category: 'smart_contract_security',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-1',
    specialtyKey: 'evm_audit_contestant',
    displayRole: 'EVM audit contestant — time-boxed competitive review with scored findings',
    agentClass: 'bounty_research',
    officialUrl: 'https://audits.sherlock.xyz',
    verdict: 'active',
    verdictReason: 'contests and insurance-backed bounties reported live today, with a 16M USD program as the current largest',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: 30_000_000,
    accountRequirements: ['human operator account', 'a USDC stake per report, refunded when valid, so entering costs money'],
    paymentConditions: ['prize pool split by severity and uniqueness', 'the stake is forfeited on invalid reports'],
    submissionRequirements: ['venue report format', 'submissions are scored, and noise is charged'],
    scopeRules: ['contest scope only', 'no exploiting deployed protocols'],
    rejectionCodes: ['invalid_finding', 'duplicate', 'gas_only', 'informational', 'out_of_scope'],
    deadlinePolicy: 'contest windows of one to four weeks with a hard close',
    skills: [...SECURITY_SKILLS.slice(0, 4), skill('stake_discipline', 'refuse to submit noise while a stake is at risk', 'economics')],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://cryptojob.org/blog/audit-contest-earnings-2026', note: '2026 pay bands, 250 USDC per-report stake, prize pools 50k-300k USD' },
      { url: 'https://sherlock.xyz/post/top-10-best-smart-contract-auditing-companies-in-2026', note: 'the venue page describing contests and insurance-backed bounties' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'A real stake cost makes this an owner spending decision; it is never auto-entered.',
  },
  {
    platformId: 'codehawks',
    label: 'CodeHawks',
    category: 'smart_contract_security',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-1',
    specialtyKey: 'beginner_audit_contestant',
    displayRole: 'Competitive audit contestant — open and beginner-track contests',
    agentClass: 'bounty_research',
    officialUrl: 'https://www.codehawks.com',
    verdict: 'active',
    verdictReason: 'identified today as the open-entry contest venue with beginner-only tracks after the Code4rena wind-down',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['human operator account', 'no entry stake reported'],
    paymentConditions: ['prize pool split across ranked findings per contest terms'],
    submissionRequirements: ['contest report format', 'public write-ups sometimes required for full payout'],
    scopeRules: ['contest scope only'],
    rejectionCodes: ['duplicate', 'low_quality', 'out_of_scope'],
    deadlinePolicy: 'contest windows with a hard close',
    skills: SECURITY_SKILLS.slice(0, 4),
    toolKeys: [],
    sourceCitations: [
      { url: 'https://paragraph.com/@cmaluractu/code4rena-is-shutting-down-heres-where-beginners-should-go-next', note: 'CodeHawks named as the open beginner alternative after the Code4rena closure' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Discovered as the replacement for the wind-down venue the owner mapping named. Contest-level terms still need an owner read.',
  },
  {
    platformId: 'cantina',
    label: 'Cantina',
    category: 'smart_contract_security',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-1',
    specialtyKey: 'senior_audit_specialist',
    displayRole: 'Senior audit specialist — invited competitive reviews',
    agentClass: 'bounty_research',
    officialUrl: 'https://cantina.xyz',
    verdict: 'blocked',
    verdictReason: 'advanced-only and invite-based: participation needs an established track record, which a newly enlisted identity does not have',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: 200_000_000,
    accountRequirements: ['invitation, or a proven auditor track record'],
    paymentConditions: ['prize pools of 500k to over 2M USD, split by rank'],
    submissionRequirements: ['venue report format'],
    scopeRules: ['invited scope only'],
    rejectionCodes: ['not_invited', 'no_track_record'],
    deadlinePolicy: 'contest windows',
    skills: [skill('senior_review', 'review at invited-auditor standard', 'evidence')],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://paragraph.com/@cmaluractu/code4rena-is-shutting-down-heres-where-beginners-should-go-next', note: 'Cantina (Spearbit): advanced only, invite-based, track record needed' },
      { url: 'https://cryptojob.org/blog/audit-contest-earnings-2026', note: 'prize pool scale' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Spearbit competitions run here, so the two rows must not take two assignment slots: see the dedupe rule in the registry.',
  },
  {
    platformId: 'spearbit',
    label: 'Spearbit',
    category: 'smart_contract_security',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-2',
    specialtyKey: 'audit_network_member',
    displayRole: 'Audit network member',
    agentClass: 'bounty_research',
    officialUrl: 'https://spearbit.com',
    verdict: 'unsuitable',
    verdictReason: 'an auditor network rather than an open venue: membership is granted to named human auditors, and its competitions now run under Cantina',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['individual auditor membership, granted after review of a human body of work'],
    paymentConditions: ['firm-rate engagements'],
    submissionRequirements: ['n/a'],
    scopeRules: ['n/a'],
    rejectionCodes: ['membership_only'],
    deadlinePolicy: 'n/a',
    skills: [],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://paragraph.com/@cmaluractu/code4rena-is-shutting-down-heres-where-beginners-should-go-next', note: 'Cantina described as Spearbit competitions and bounties' },
      { url: 'https://web3.career/learn-web3/smart-contract-security-auditor-2026', note: 'Spearbit listed among audit firms, not open contest platforms' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Recorded so the owner mapping is answered rather than quietly dropped.',
  },
  {
    platformId: 'open_zeppelin_bounty',
    label: 'OpenZeppelin bug bounty',
    category: 'smart_contract_security',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-2',
    specialtyKey: 'contract_library_reviewer',
    displayRole: 'Smart-contract library reviewer',
    agentClass: 'bounty_research',
    officialUrl: 'https://immunefi.com/bug-bounty/openzeppelin/information/',
    verdict: 'unsuitable',
    verdictReason: 'not a platform: it is one program hosted on Immunefi, so a separate slot would double-count a venue and split one rule set',
    automationPolicy: 'restricted',
    openOpportunities: 1,
    maxRewardUsdCents: 2_500_000,
    accountRequirements: ['Immunefi account plus that program KYC'],
    paymentConditions: ['up to 25000 USD through the host program flow'],
    submissionRequirements: ['host report form with PoC', 'KYC before payout'],
    scopeRules: ['the library named on the program page only', 'known-issue list applies'],
    rejectionCodes: ['known_issue', 'no_poc', 'kyc_pending'],
    deadlinePolicy: 'none; first valid report',
    skills: [skill('library_scope', 'work within the library scope and its known-issue list', 'scope')],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://immunefi.com/bug-bounty/openzeppelin/information/', note: 'program page: hosted on Immunefi, PoC required, KYC required' },
      { url: 'https://www.openzeppelin.com/news/safeguarding', note: 'the company describes it as its first formal bug bounty program, run with Immunefi' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'The program remains work the Immunefi specialist may target; it is not a second venue slot.',
  },
  {
    platformId: 'hackerone',
    label: 'HackerOne',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-3',
    specialtyKey: 'web_vulnerability_reporter',
    displayRole: 'Web vulnerability reporter — in-scope disclosure with reproduction steps',
    agentClass: 'bounty_research',
    officialUrl: 'https://hackerone.com',
    verdict: 'active',
    verdictReason: 'live marketplace of programs, still listed as the primary destination for web disclosure work in 2026',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['individual human account', 'per-program eligibility and geography rules', 'tax and payout identity on file'],
    paymentConditions: ['per-program bounty table, paid after triage and resolution'],
    submissionRequirements: ['a reproduction a triager can follow', 'severity argued against the program rubric', 'no scanning where the program forbids it'],
    scopeRules: ['explicitly in-scope assets only', 'no denial of service, no social engineering, no data access beyond the proof', 'safe-harbor terms differ per program'],
    rejectionCodes: ['informational', 'not_applicable', 'duplicate', 'out_of_scope', 'spam'],
    deadlinePolicy: 'no fuse; triage queues decide response time',
    skills: SECURITY_SKILLS,
    toolKeys: ['hackerone'],
    sourceCitations: [
      { url: 'https://trainingcamp.com/articles/the-best-bug-bounty-websites-in-2026-a-researchers-guide-to-hackerone-bugcrowd-and-beyond/', note: '2026 platform comparison listing HackerOne and Bugcrowd as the major live venues' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Automation terms are per program and scanning bans are common, so autonomous submission is not enabled here.',
  },
  {
    platformId: 'bugcrowd',
    label: 'Bugcrowd',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-3',
    specialtyKey: 'crowd_tester',
    displayRole: 'Crowd tester — program-scoped vulnerability research',
    agentClass: 'bounty_research',
    officialUrl: 'https://www.bugcrowd.com',
    verdict: 'active',
    verdictReason: 'live platform with open programs, described in the 2026 comparison as a primary researcher destination',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['individual human account', 'program-level vetting or invitation for some programs'],
    paymentConditions: ['per-program payout after triage and resolution'],
    submissionRequirements: ['reproducible report on the program form', 'severity per program rubric'],
    scopeRules: ['in-scope assets only', 'no destructive testing'],
    rejectionCodes: ['informative', 'duplicate', 'out_of_scope'],
    deadlinePolicy: 'no fuse',
    skills: SECURITY_SKILLS.slice(0, 4),
    toolKeys: ['bugcrowd'],
    sourceCitations: [
      { url: 'https://trainingcamp.com/articles/the-best-bug-bounty-websites-in-2026-a-researchers-guide-to-hackerone-bugcrowd-and-beyond/', note: '2026 comparison of live platforms' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
  },
  {
    platformId: 'yeswehack',
    label: 'YesWeHack',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-4',
    specialtyKey: 'eu_disclosure_researcher',
    displayRole: 'European disclosure researcher — regulated-sector and government programs',
    agentClass: 'bounty_research',
    officialUrl: 'https://yeswehack.com',
    verdict: 'active',
    verdictReason: 'live platform in the 2026 comparison, payouts typically 200 to 20000 USD, EU and APAC focus',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: 2_000_000,
    accountRequirements: ['individual human account', 'EU data residency and identity requirements on many programs'],
    paymentConditions: ['per-program payout after validation'],
    submissionRequirements: ['report in the program format and language', 'reproduction steps'],
    scopeRules: ['program scope strictly', 'no testing of out-of-scope subsidiaries'],
    rejectionCodes: ['duplicate', 'informative', 'out_of_scope'],
    deadlinePolicy: 'no fuse',
    skills: SECURITY_SKILLS.slice(0, 3),
    toolKeys: ['yeswehack'],
    sourceCitations: [
      { url: 'https://trainingcamp.com/articles/the-best-bug-bounty-websites-in-2026-a-researchers-guide-to-hackerone-bugcrowd-and-beyond/', note: '2026 comparison: payout bands and regional focus' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Grouping gap: the mapping puts this in gmail-4, which is not an authorized account grouping. The profile can be built; access cannot.',
  },
  {
    platformId: 'intigriti',
    label: 'Intigriti',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-4',
    specialtyKey: 'eu_disclosure_researcher',
    displayRole: 'European disclosure researcher',
    agentClass: 'bounty_research',
    officialUrl: 'https://www.intigriti.com',
    verdict: 'active',
    verdictReason: 'live platform in the 2026 comparison; enterprise-scale programs run there, payouts typically 300 to 30000 USD',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: 3_000_000,
    accountRequirements: ['individual human account', 'identity on file for payout'],
    paymentConditions: ['per-program payout after validation'],
    submissionRequirements: ['reproducible report', 'severity per platform scale'],
    scopeRules: ['program scope strictly'],
    rejectionCodes: ['duplicate', 'informative', 'out_of_scope'],
    deadlinePolicy: 'no fuse',
    skills: SECURITY_SKILLS.slice(0, 3),
    toolKeys: ['intigriti'],
    sourceCitations: [
      { url: 'https://trainingcamp.com/articles/the-best-bug-bounty-websites-in-2026-a-researchers-guide-to-hackerone-bugcrowd-and-beyond/', note: '2026 comparison: payout band and a major enterprise program launched on the platform' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Same gmail-4 grouping gap as YesWeHack.',
  },
  {
    platformId: 'patchstack',
    label: 'Patchstack Alliance',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-4',
    specialtyKey: 'wordpress_plugin_auditor',
    displayRole: 'WordPress plugin and theme auditor',
    agentClass: 'bounty_research',
    officialUrl: 'https://patchstack.com',
    verdict: 'active',
    verdictReason: 'program live today and paying researchers, but its rules were tightened on 1 June 2026 because of AI-assisted research',
    automationPolicy: 'prohibited',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['researcher account', 'reports must meet the narrowed impact criteria'],
    paymentConditions: ['monthly bounty pool limited to the top five reports; level-based and random-selection rewards removed'],
    submissionRequirements: ['tested against the actual plugin or theme', 'real security impact demonstrated', 'no unverified AI-generated assumptions'],
    scopeRules: ['WordPress plugins and themes in the program'],
    rejectionCodes: ['ai_generated_assumption', 'not_tested', 'below_impact_threshold', 'duplicate'],
    deadlinePolicy: 'monthly bounty pool',
    skills: [
      skill('plugin_source_review', 'read the actual plugin or theme source, not a summary', 'evidence'),
      skill('impact_demonstration', 'show real impact rather than a theoretical one', 'severity'),
      skill('rejection_analysis', 'learn from the reason code and never resubmit the same shape', 'duplicates'),
    ],
    toolKeys: ['wordpress_plugin'],
    sourceCitations: [
      { url: 'https://patchstack.com/articles/the-future-of-the-patchstack-bug-bounty-program/', note: 'official 2026 rule change: top-five monthly pool and one-week bans for reports containing incorrect AI-generated assumptions or untested reports' },
      { url: 'https://mysites.guru/blog/four-wordpress-plugins-security-patches-march-2026/', note: 'evidence the program still pays researchers for real findings' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'The clearest case in the catalog of a venue explicitly penalizing the failure mode an unattended agent produces. Research profile only; submission stays human.',
  },
  {
    platformId: 'wordfence',
    label: 'Wordfence Bug Bounty',
    category: 'web_vulnerability_disclosure',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-4',
    specialtyKey: 'wordpress_vulnerability_researcher',
    displayRole: 'WordPress vulnerability researcher',
    agentClass: 'bounty_research',
    officialUrl: 'https://www.wordfence.com',
    verdict: 'active',
    verdictReason: 'still paying researchers through 2026 per the disclosure records of patched plugins',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['researcher account', 'responsible-disclosure agreement'],
    paymentConditions: ['per-vulnerability reward tied to active installs and severity, after the vendor patch window'],
    submissionRequirements: ['a vulnerability in a popular plugin or theme', 'coordinated disclosure timeline'],
    scopeRules: ['WordPress plugins and themes only', 'no exploitation in the wild'],
    rejectionCodes: ['duplicate_cve', 'below_active_installs', 'vendor_disputed'],
    deadlinePolicy: 'disclosure deadline tied to the vendor patch release',
    skills: [
      skill('plugin_source_review', 'read the plugin source at a pinned version', 'evidence'),
      skill('disclosure_timing', 'hold the report until the patch window', 'disclosure'),
    ],
    toolKeys: ['wordpress_plugin'],
    sourceCitations: [
      { url: 'https://mysites.guru/blog/four-wordpress-plugins-security-patches-march-2026/', note: '2026 record describing the Wordfence and Patchstack programs scaling up' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Same gmail-4 grouping gap as the other rows in that bucket.',
  },
  {
    platformId: 'layer3',
    label: 'Layer3',
    category: 'other',
    opportunityClass: 'microtasks_labeling',
    gmailGroup: 'gmail-3',
    specialtyKey: 'quest_worker',
    displayRole: 'On-chain quest worker',
    agentClass: 'bounty_research',
    officialUrl: 'https://layer3.xyz',
    verdict: 'unverified',
    verdictReason: 'nothing was read today: no current list of open paid quests, reward form or account rules, and much quest work pays in points or tokens rather than settleable money',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['typically a connected wallet per quest', 'wallet control is always an owner action'],
    paymentConditions: ['often token or NFT rewards; settlement evidence is required before any of it is called revenue'],
    submissionRequirements: ['on-chain proof of completion'],
    scopeRules: ['no wallet custody by an agent, ever'],
    rejectionCodes: ['wallet_required', 'reward_not_settleable', 'duplicate_quest'],
    deadlinePolicy: 'per-quest windows',
    skills: [skill('reward_settleability', 'distinguish points and tokens from settleable payment', 'severity')],
    toolKeys: [],
    sourceCitations: [],
    observedAt: TODAY,
    verifiedVia: 'none',
    notes: 'Named in the owner mapping, left unverified rather than promoted, and not assignable.',
  },
  {
    platformId: 'dorahacks',
    label: 'DoraHacks',
    category: 'hackathon_grant',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-3',
    specialtyKey: 'hackathon_builder',
    displayRole: 'Hackathon builder',
    agentClass: 'bounty_execution',
    officialUrl: 'https://dorahacks.io',
    verdict: 'blocked',
    verdictReason: 'the site blocks automated reads, so opportunities cannot be discovered from our side; an independent tracker reported the same on 3 October 2026',
    automationPolicy: 'prohibited',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['human registration', 'team identity per event'],
    paymentConditions: ['prize pools paid by the organizer'],
    submissionRequirements: ['project submission inside the event window'],
    scopeRules: ['event rules'],
    rejectionCodes: ['automated_read_blocked', 'deadline_missed', 'team_membership_required'],
    deadlinePolicy: 'hard event deadlines',
    skills: [skill('deadline_planning', 'work backwards from a hard submission deadline', 'scope')],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://github.com/Blockchains/hackathons', note: 'tracker README seeded 3 October 2026: DoraHacks blocks automated reads, so nothing there could be verified' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'The owner can work events manually; the fleet cannot discover them.',
  },
  {
    platformId: 'hats_finance',
    label: 'Hats Finance',
    category: 'smart_contract_security',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-2',
    specialtyKey: 'open_contest_auditor',
    displayRole: 'Open contest auditor',
    agentClass: 'bounty_research',
    officialUrl: 'https://hats.finance',
    verdict: 'unverified',
    verdictReason: 'named among the live contest platforms by a 2026 source, but no official open-contest listing was read today',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['human account'],
    paymentConditions: ['prize split by rank per contest'],
    submissionRequirements: ['contest report format'],
    scopeRules: ['contest scope'],
    rejectionCodes: ['duplicate', 'invalid'],
    deadlinePolicy: 'contest windows',
    skills: [skill('contest_scope_reading', 'bind work to contest scope and deadline', 'scope')],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://web3.career/learn-web3/smart-contract-security-auditor-2026', note: 'lists Hats Finance among contest platforms running open competitions in 2026' },
    ],
    observedAt: TODAY,
    verifiedVia: 'secondary_source',
    notes: 'Needs an official-page read before assignment.',
  },
  {
    platformId: 'paladin',
    label: 'Paladin',
    category: 'smart_contract_security',
    opportunityClass: 'bug_bounties',
    gmailGroup: 'gmail-2',
    specialtyKey: 'security_review_specialist',
    displayRole: 'Security review specialist',
    agentClass: 'bounty_research',
    officialUrl: 'https://paladin.xyz',
    verdict: 'unverified',
    verdictReason: 'nothing could be read today, and the name is ambiguous across unrelated organizations, so no status is asserted at all',
    automationPolicy: 'unknown',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['unknown'],
    paymentConditions: ['unknown'],
    submissionRequirements: ['unknown'],
    scopeRules: ['unknown until a program page is read'],
    rejectionCodes: [],
    deadlinePolicy: 'unknown',
    skills: [],
    toolKeys: [],
    sourceCitations: [],
    observedAt: TODAY,
    verifiedVia: 'none',
    notes: 'Recorded as a named candidate with the ambiguity stated. Not assignable, and no substitute is invented in its place.',
  },
  {
    platformId: 'code4rena',
    label: 'Code4rena',
    category: 'smart_contract_security',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-1',
    specialtyKey: 'audit_contest_specialist',
    displayRole: 'Audit contest specialist (venue closed)',
    agentClass: 'bounty_research',
    officialUrl: 'https://code4rena.com',
    verdict: 'inactive',
    verdictReason: 'wound down: announced 13 May 2026, completed existing engagements, shut down 12 July 2026, with clients and researchers migrating to Immunefi',
    automationPolicy: 'unknown',
    openOpportunities: 0,
    maxRewardUsdCents: null,
    accountRequirements: ['n/a — closed to new work'],
    paymentConditions: ['existing engagements completed before closure'],
    submissionRequirements: ['n/a'],
    scopeRules: ['n/a'],
    rejectionCodes: ['venue_closed'],
    deadlinePolicy: 'n/a',
    skills: [],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://cryptojob.org/blog/audit-contest-earnings-2026', note: 'wind-down announced 13 May 2026; Immunefi absorbed the clients' },
      { url: 'https://sherlock.xyz/post/top-10-best-smart-contract-auditing-companies-in-2026', note: 'described by a competitor page as "not an option for new work"' },
      { url: 'https://paragraph.com/@cmaluractu/code4rena-is-shutting-down-heres-where-beginners-should-go-next', note: 'shutdown date 12 July 2026' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'The owner mapping named it; it is recorded INACTIVE and its replacement was discovered in the same pass instead of being assigned.',
  },
  {
    platformId: 'kaggle',
    label: 'Kaggle competitions',
    category: 'ai_eval_data_competition',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-2',
    specialtyKey: 'ml_competition_modeler',
    displayRole: 'Machine-learning competition modeler',
    agentClass: 'bounty_execution',
    officialUrl: 'https://www.kaggle.com/competitions',
    verdict: 'unverified',
    verdictReason: 'not re-read at competition level today; prize funds and deadlines change per round, and many competitions award medals only',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['individual human account', 'rule acceptance per competition'],
    paymentConditions: ['monetary prizes by leaderboard rank where the competition has them; medals are not revenue'],
    submissionRequirements: ['submission inside the window', 'no private ensembles where the rules forbid them'],
    scopeRules: ['provided data only'],
    rejectionCodes: ['rule_violation', 'late_submission', 'non_monetary'],
    deadlinePolicy: 'hard competition end dates',
    skills: [skill('metric_optimisation', 'improve the scored metric in a reproducible run', 'evidence')],
    toolKeys: ['kaggle'],
    sourceCitations: [],
    observedAt: TODAY,
    verifiedVia: 'none',
    notes: 'The registry keeps the medal-versus-money distinction in the reward verification rules so a badge can never be reported as revenue.',
  },
  {
    platformId: 'devpost',
    label: 'Devpost hackathons',
    category: 'hackathon_grant',
    opportunityClass: 'contests_challenges',
    gmailGroup: 'gmail-3',
    specialtyKey: 'hackathon_builder',
    displayRole: 'Hackathon builder',
    agentClass: 'bounty_execution',
    officialUrl: 'https://devpost.com',
    verdict: 'unverified',
    verdictReason: 'not re-read at event level today; many listed hackathons pay in credits or swag, and the sponsor rather than the platform pays',
    automationPolicy: 'restricted',
    openOpportunities: null,
    maxRewardUsdCents: null,
    accountRequirements: ['individual human account', 'team rules per event', 'eligibility by country and status'],
    paymentConditions: ['prizes paid by the sponsor after judging'],
    submissionRequirements: ['project submission with the required demo assets'],
    scopeRules: ['event rules and team-size limits'],
    rejectionCodes: ['ineligible_team', 'late_submission', 'incomplete_submission'],
    deadlinePolicy: 'hard event deadlines',
    skills: [skill('deadline_planning', 'work backwards from a hard deadline with required assets', 'scope')],
    toolKeys: ['devpost'],
    sourceCitations: [],
    observedAt: TODAY,
    verifiedVia: 'none',
  },
  {
    platformId: 'gitcoin',
    label: 'Gitcoin Grants',
    category: 'hackathon_grant',
    opportunityClass: 'open_source_sponsorship',
    gmailGroup: 'gmail-3',
    specialtyKey: 'grant_writer',
    displayRole: 'Public-goods grant writer',
    agentClass: 'bounty_research',
    officialUrl: 'https://gitcoin.co',
    verdict: 'inactive',
    verdictReason: 'no open round found today: the last documented round ran its donation window in October 2025 with distribution by 13 November 2025 and extensions into 2026, and no open hackathon was verifiable on 3 October 2026',
    automationPolicy: 'unknown',
    openOpportunities: 0,
    maxRewardUsdCents: null,
    accountRequirements: ['project registration per round'],
    paymentConditions: ['matching pools distributed after the round closes'],
    submissionRequirements: ['project listing inside the round window'],
    scopeRules: ['round themes'],
    rejectionCodes: ['no_open_round'],
    deadlinePolicy: 'round windows',
    skills: [],
    toolKeys: [],
    sourceCitations: [
      { url: 'https://gitcoin.co/campaigns/gitcoin-grants-24-gg24', note: 'last round timeline, with distribution by 13 November 2025' },
      { url: 'https://github.com/Blockchains/hackathons', note: 'tracker seeded 3 October 2026 found no open Gitcoin hackathon' },
    ],
    observedAt: TODAY,
    verifiedVia: 'documented',
    notes: 'Not in the owner mapping. Recorded because rounds reopen and the discovery pass should notice.',
  },
] as const;

/** Categories the registry keeps refreshing, as data, so a report can state what is covered. */
export const DISCOVERY_CATEGORIES: readonly { readonly category: PlatformCategory; readonly how: string }[] = [
  { category: 'github_engineering', how: 'live GitHub search for funded issues in candidate repositories' },
  { category: 'agent_native_marketplace', how: 'machine-readable venue boards with per-item claim gates' },
  { category: 'smart_contract_security', how: 'venue contest listings and program pages, re-read before assignment' },
  { category: 'web_vulnerability_disclosure', how: 'platform program directories with per-program scope and automation terms' },
  { category: 'ai_eval_data_competition', how: 'competition listings filtered to monetary awards, because medals are not revenue' },
  { category: 'hackathon_grant', how: 'the machine-readable hackathon tracker plus organizer pages for deadlines and sponsor payouts' },
  { category: 'other', how: 'reviewed candidates only; nothing enters as active-looking without a record' },
];

/**
 * Two id conventions coexist in `mission_platforms`: the connector seed inserts the raw id
 * (`github_issue_bounties`), while `discoverPlatform` normalizes to `github-issue-bounties` before
 * storing. A catalog row therefore has to be resolved rather than assumed, or the evidence record
 * gets an id that satisfies nothing — a foreign-key failure that would look like a broken
 * migration instead of what it is: two spellings of one venue.
 */
export function normalizePlatformId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** The id actually present in `mission_platforms`, preferring the raw spelling. */
export function resolveRegistryPlatformId(id: string): string | null {
  if (getPlatform(id)) return id;
  const normalized = normalizePlatformId(id);
  return getPlatform(normalized) ? normalized : null;
}

/** A POLICY_REVIEW ceiling only; PERMITTED and ACTIVE stay owner calls. */
const MAX_AUTOMATIC_STATUS = new Set(['DISCOVERED', 'QUALIFIED', 'POLICY_REVIEW']);

function factsFor(record: PlatformRecord): Record<string, unknown> {
  return {
    category: record.category,
    opportunity_class: record.opportunityClass,
    gmail_group: record.gmailGroup,
    specialty_key: record.specialtyKey,
    display_role: record.displayRole,
    agent_class: record.agentClass,
    account_requirements: [...record.accountRequirements],
    payment_conditions: [...record.paymentConditions],
    submission_requirements: [...record.submissionRequirements],
    scope_rules: [...record.scopeRules],
    rejection_codes: [...record.rejectionCodes],
    deadline_policy: record.deadlinePolicy,
    skills: record.skills.map(entry => entry.key),
    tool_keys: [...record.toolKeys],
    open_opportunities: record.openOpportunities,
    max_reward_usd_cents: record.maxRewardUsdCents,
    notes: record.notes ?? null,
  };
}

export function evidenceDigestFor(record: PlatformRecord): string {
  return sha256(JSON.stringify({
    verdict: record.verdict,
    reason: record.verdictReason,
    url: record.officialUrl,
    sources: record.sourceCitations.map(entry => entry.url),
    facts: factsFor(record),
    observedAt: record.observedAt,
  }));
}

/**
 * Write the catalog rows that do not exist yet, attach today's evidence record, and let the
 * lifecycle advance only as far as the evidence supports. An `inactive`, `blocked` or
 * `unsuitable` verdict never becomes QUALIFIED; it is recorded so the fleet can explain
 * itself, and `restrictPlatform` is only called under an owner actor.
 */
export function applyPlatformCatalog(actor: MoneyActor, records: readonly PlatformRecord[] = VERIFIED_PLATFORM_RECORDS): {
  readonly created: number; readonly existing: number; readonly evidenced: number; readonly advanced: number; readonly restricted: number; readonly observed: number;
} {
  let created = 0; let existing = 0; let evidenced = 0; let advanced = 0; let restricted = 0;
  for (const record of records) {
    let row = getPlatform(record.platformId) as Row | undefined ?? getPlatform(normalizePlatformId(record.platformId)) as Row | undefined;
    if (!row) {
      try {
        row = discoverPlatform({
          id: record.platformId,
          label: record.label,
          kind: record.verdict === 'unsuitable' ? 'NOT_AN_EARNING_SOURCE' : 'EARNING_SOURCE',
          opportunityClass: record.opportunityClass,
          officialUrl: record.officialUrl,
          evidence: `Official: ${record.sourceCitations[0]?.url ?? record.officialUrl} — ${record.verdictReason}`,
          payoutVerifiable: record.verdict === 'active',
          apiPermitted: record.automationPolicy === 'permitted',
          humanOnlyActions: ['account creation', 'identity or KYC', 'payout setup', 'external submission'],
        }) as Row;
        created++;
      } catch (error) {
        if (!/discovery_duplicate_platform/.test(String((error as Error).message))) throw error;
        row = getPlatform(record.platformId) as Row;
      }
    } else existing++;
    if (!row) continue;
    // Everything below is keyed on the stored id, so the evidence row can never dangle.
    const registryId = String(row!.id);

    const digest = evidenceDigestFor(record);
    if (!db.get('SELECT id FROM mission_platform_evidence WHERE platform_id=? AND content_digest=?', [registryId, digest])) {
      db.run(`INSERT INTO mission_platform_evidence (id,platform_id,verdict,verdict_reason,official_url,source_urls_json,facts_json,automation_policy,open_opportunities,max_reward_usd_cents,observed_at,verified_by,verified_via,content_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        missionId('pfev'), registryId, record.verdict, record.verdictReason.slice(0, 900), record.officialUrl,
        JSON.stringify(record.sourceCitations.map(entry => ({ url: entry.url, note: entry.note }))), JSON.stringify(factsFor(record)),
        record.automationPolicy, record.openOpportunities, record.maxRewardUsdCents,
        `${record.observedAt}T00:00:00.000Z`, `${actor.kind}:${actor.id}`, record.verifiedVia, digest, nowIso(),
      ] as SqlValue[]);
      evidenced++;
    }

    const status = String(row.status);
    if (record.verdict === 'inactive' || record.verdict === 'blocked' || record.verdict === 'unsuitable') {
      if (MAX_AUTOMATIC_STATUS.has(status) && actor.kind === 'owner') {
        try {
          restrictPlatform(registryId, actor, `${record.verdict}: ${record.verdictReason}`.slice(0, 480));
          restricted++;
        } catch { /* already restricted, or a lifecycle guard refused; the evidence row still stands */ }
      }
      continue;
    }
    if (record.verdict !== 'active') continue;
    try {
      if (status === 'DISCOVERED') { qualifyPlatform(registryId, actor); advanced++; }
      else if (String(getPlatform(registryId)!.status) === 'QUALIFIED') { submitForPolicyReview(registryId, actor); advanced++; }
    } catch { /* a lifecycle guard refused; the row stays exactly where the evidence puts it */ }
  }
  appendMissionAudit({
    actorType: actor.kind, actorId: actor.id, action: 'platform.catalog_applied', subjectType: 'platform',
    subjectId: 'catalog', detail: { created, existing, evidenced, advanced, restricted, observed: records.length },
  });
  return { created, existing, evidenced, advanced, restricted, observed: records.length };
}

export interface CatalogRow {
  /** The id stored in `mission_platforms`, which is what foreign keys must reference. */
  readonly platformId: string;
  /** The catalog's own id for the same venue, which is what the owner's mapping speaks. */
  readonly catalogId: string;
  readonly label: string;
  readonly status: string;
  readonly verdict: PlatformVerdict | 'no_evidence';
  readonly verdictReason: string;
  readonly automationPolicy: AutomationPolicy;
  readonly observedAt: string | null;
  readonly openOpportunities: number | null;
  readonly maxRewardUsdCents: number | null;
  readonly sourceUrls: readonly string[];
  readonly assignable: boolean;
  readonly blockingReasons: readonly string[];
}

/** Assignable means: a current record says the venue is open, and nothing about it is stale. */
export function catalogSummary(options: { readonly maxAgeDays?: number; readonly now?: () => Date } = {}): {
  readonly rows: CatalogRow[]; readonly counts: Record<string, number>; readonly maxAgeDays: number;
} {
  const maxAgeDays = options.maxAgeDays ?? 30;
  const nowTime = (options.now ?? (() => new Date()))().getTime();
  const rows: CatalogRow[] = [];
  for (const platform of db.all<Row>("SELECT id,label,status,kind FROM mission_platforms WHERE kind IN ('EARNING_SOURCE','NOT_AN_EARNING_SOURCE','RESTRICTED_HUMAN_ONLY') ORDER BY label") ?? []) {
    const id = String(platform.id);
    const evidence = db.get<Row>('SELECT * FROM mission_platform_evidence WHERE platform_id=? ORDER BY observed_at DESC, created_at DESC LIMIT 1', [id]);
    if (!evidence) continue;
    const verdict = String(evidence.verdict) as PlatformVerdict;
    const observedAt = String(evidence.observed_at);
    const ageDays = (nowTime - Date.parse(observedAt)) / 86_400_000;
    const policy = String(evidence.automation_policy) as AutomationPolicy;
    const blocking: string[] = [];
    if (verdict !== 'active') blocking.push(`verdict_${verdict}`);
    if (ageDays > maxAgeDays) blocking.push('verification_stale');
    if (policy === 'prohibited') blocking.push('automation_prohibited');
    if (policy === 'unknown') blocking.push('automation_policy_unread');
    rows.push({
      platformId: id,
      catalogId: platformRecordFor(id)?.platformId ?? id,
      label: String(platform.label),
      status: String(platform.status),
      verdict,
      verdictReason: String(evidence.verdict_reason),
      automationPolicy: policy,
      observedAt,
      openOpportunities: evidence.open_opportunities === null || evidence.open_opportunities === undefined ? null : Number(evidence.open_opportunities),
      maxRewardUsdCents: evidence.max_reward_usd_cents === null || evidence.max_reward_usd_cents === undefined ? null : Number(evidence.max_reward_usd_cents),
      sourceUrls: (JSON.parse(String(evidence.source_urls_json)) as { url: string }[]).map(entry => entry.url),
      assignable: blocking.length === 0,
      blockingReasons: blocking,
    });
  }
  const counts: Record<string, number> = { total: rows.length, assignable: 0, active: 0, inactive: 0, blocked: 0, unsuitable: 0, unverified: 0, stale: 0 };
  for (const row of rows) {
    counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
    if (row.assignable) counts.assignable++;
    if (row.blockingReasons.includes('verification_stale')) counts.stale++;
  }
  return { rows, counts, maxAgeDays };
}

/** Accepts either spelling, because callers hold whichever one they met first. */
export function platformRecordFor(platformId: string): PlatformRecord | null {
  if (!platformId) return null;
  const normalized = normalizePlatformId(platformId);
  return VERIFIED_PLATFORM_RECORDS.find(record => record.platformId === platformId || normalizePlatformId(record.platformId) === normalized) ?? null;
}

export { GMAIL_GROUPS as CATALOG_GROUPS };

/** A tool key is only a claim if a registered connector contract exists for it. */
export function resolveToolKeys(keys: readonly string[]): {
  readonly resolved: readonly { key: string; label: string; humanOnly: boolean; requiresOwnerCredential: boolean }[];
  readonly missing: readonly string[];
} {
  const contracts = new Map(listConnectorContracts().map(contract => [contract.connectorId, contract]));
  const resolved: { key: string; label: string; humanOnly: boolean; requiresOwnerCredential: boolean }[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const contract = contracts.get(key);
    if (contract) resolved.push({ key, label: contract.label, humanOnly: contract.humanOnly, requiresOwnerCredential: contract.requiresOwnerCredential });
    else missing.push(key);
  }
  return { resolved, missing };
}

/** Permissions come from the class definition. Anything else is refused, and the denied list is asserted. */
export function resolvePermissions(agentClass: string, wanted: readonly GrantablePermission[]): {
  readonly permissions: readonly GrantablePermission[]; readonly denied: readonly string[];
} {
  const definition = AGENT_CLASS_CONTRACTS.find(entry => entry.agentClass === agentClass);
  if (!definition) deny('specialist_class_unknown', agentClass);
  if (definition.ownerOnly) deny('specialist_class_owner_only', agentClass);
  if (wanted.some(entry => !(definition.permissions as readonly string[]).includes(entry))) {
    deny('specialist_permission_not_grantable', `${agentClass} allows ${definition.permissions.join('|')}`);
  }
  return { permissions: definition.permissions, denied: definition.denied };
}

/** The newest verification record for a venue, under either spelling. */
export function latestEvidence(platformId: string): Row | undefined {
  const registryId = resolveRegistryPlatformId(platformId) ?? platformId;
  return db.get<Row>('SELECT * FROM mission_platform_evidence WHERE platform_id=? ORDER BY observed_at DESC, created_at DESC LIMIT 1', [registryId])
    ?? db.get<Row>('SELECT * FROM mission_platform_evidence WHERE platform_id=? ORDER BY observed_at DESC, created_at DESC LIMIT 1', [platformId]);
}
