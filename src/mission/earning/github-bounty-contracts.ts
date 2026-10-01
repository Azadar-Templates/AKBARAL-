/** GitHub-issue bounty primitives. Discovery and repo-policy checks use GitHub's
 * public REST API (explicitly permitted for automation — see docs.github.com
 * site policy). PR submission uses the SAME GitHub identity/token the owner
 * already controls for this account — never a new earning-platform account,
 * never KYC, never a fabricated identity. Actual bounty CASH settlement (e.g.
 * via Algora/boss.dev/a maintainer's own payout) is a separate, deliberately
 * unwired boundary: see github-bounty-workflow.ts. No pretend settlement
 * adapter is installed here.
 */

/** A candidate bounty lead discovered from a public, unauthenticated search —
 * NOT a claimed task, NOT executable, NOT a guarantee of payment. */
export interface BountyLead {
  readonly kind: 'github_bounty_lead';
  readonly repoFullName: string;
  readonly issueNumber: number;
  readonly issueUrl: string;
  readonly title: string;
  readonly labels: readonly string[];
  /** Only present when a bounty amount is textually explicit in labels/title
   * (e.g. "$250 bounty"); this is a HINT for prioritization, never trusted as
   * a guaranteed payable amount. */
  readonly hintedAmountCents: number | null;
  readonly observedAt: string;
  readonly executable: false;
}

/** Best-effort, conservative classification of whether a repository's own
 * published policy (CONTRIBUTING.md / AI.md / README.md) allows AI-assisted
 * contributions. Defaults to requiring disclosure and owner review; never
 * treats silence as unconditional permission. */
export interface RepoPolicyProof {
  readonly repoFullName: string;
  readonly aiContributionsAllowed: boolean;
  readonly disclosureRequired: boolean;
  readonly policySource: string | null;
  readonly policyExcerpt: string;
  readonly checkedAt: string;
}

export interface CandidateSubmission {
  readonly repoFullName: string;
  readonly baseBranch: string;
  readonly branchName: string;
  readonly filePath: string;
  readonly fileContent: string;
  readonly commitMessage: string;
  readonly prTitle: string;
  readonly prBody: string;
}

export interface PullRequestProof {
  readonly repoFullName: string;
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly state: 'open' | 'merged' | 'closed_unmerged';
  readonly mergedAt: string | null;
}
