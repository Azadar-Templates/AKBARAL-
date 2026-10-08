/**
 * Scope gate for the GitHub-issue bounty path.
 *
 * Every outbound GitHub action in github-bounty-workflow.ts for a repository
 * must pass gateGithubRepo() first. The decision is an exact match on a
 * `repo` row in scope_allowlist belonging to an ACTIVE bounty_programs row.
 * Anything else is refused, and the refusal is recorded:
 *   - program-level decisions go through assertInScope() -> scope_gate_events
 *   - decisions with no program to attach to go to the mission audit trail
 *
 * Fail-closed: zero active programs means no discovery, no fetch, no draft.
 */
import { missionDb as db, appendMissionAudit, type Row } from '../database';
import { assertInScope, BountyScopeError, type ScopeMatch } from './bug-bounty-system';

export type RepoScopeBlockReason = 'program_not_configured' | 'program_inactive' | 'explicitly_out_of_scope' | 'target_not_allowlisted';

export type RepoScopeDecision =
  | { allowed: true; repo: string; programId: string }
  | { allowed: false; repo: string; reason: RepoScopeBlockReason; programId: string | null };

export interface RepoGateContext { agentType?: string; runId?: string }

/** GitHub owner/name, bounded and case-insensitive. Anything else is refused. */
const REPO_PATTERN = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/;
/** Caps GitHub search fan-out per discovery pass. Repos beyond this are not searched. */
export const MAX_SCOPED_SEARCH_REPOS = 10;

export function normalizeRepoFullName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const repo = input.trim().toLowerCase();
  if (!REPO_PATTERN.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) return null;
  return repo;
}

/** Pure decision. Does not write anything; the gate below does the recording. */
export function decideRepoScope(input: string): RepoScopeDecision {
  const repo = normalizeRepoFullName(input);
  if (!repo) return { allowed: false, repo: String(input ?? '').slice(0, 200), reason: 'target_not_allowlisted', programId: null };
  const activeCount = Number(db.get<Row>('SELECT COUNT(*) AS n FROM bounty_programs WHERE active=1')?.n ?? 0);
  if (activeCount === 0) return { allowed: false, repo, reason: 'program_not_configured', programId: null };
  const rows = db.all<Row>(
    `SELECT s.program_id AS programId, s.in_scope AS inScope, p.active AS active
       FROM scope_allowlist s JOIN bounty_programs p ON p.id = s.program_id
      WHERE s.target_type = 'repo' AND s.target = ?
      ORDER BY s.program_id, s.id`,
    [repo],
  );
  const activeDeny = rows.find(row => Number(row.active) === 1 && Number(row.inScope) !== 1);
  if (activeDeny) return { allowed: false, repo, reason: 'explicitly_out_of_scope', programId: String(activeDeny.programId) };
  const activeAllow = rows.find(row => Number(row.active) === 1 && Number(row.inScope) === 1);
  if (activeAllow) return { allowed: true, repo, programId: String(activeAllow.programId) };
  const inactiveAllow = rows.find(row => Number(row.active) !== 1 && Number(row.inScope) === 1);
  if (inactiveAllow) return { allowed: false, repo, reason: 'program_inactive', programId: String(inactiveAllow.programId) };
  return { allowed: false, repo, reason: 'target_not_allowlisted', programId: null };
}

/** Repos that may be searched: exact allow rows under active programs that no
 * active program denies. Sorted and capped so one pass has bounded fan-out. */
export function allowlistedRepoNames(): { repos: string[]; truncated: number } {
  const candidates = db.all<Row>(
    `SELECT DISTINCT s.target AS target FROM scope_allowlist s JOIN bounty_programs p ON p.id = s.program_id
      WHERE p.active = 1 AND s.in_scope = 1 AND s.target_type = 'repo' ORDER BY s.target`,
  ).map(row => String(row.target)).filter(repo => decideRepoScope(repo).allowed);
  return { repos: candidates.slice(0, MAX_SCOPED_SEARCH_REPOS), truncated: Math.max(0, candidates.length - MAX_SCOPED_SEARCH_REPOS) };
}

function recordRefusal(decision: Extract<RepoScopeDecision, { allowed: false }>, context: RepoGateContext): void {
  appendMissionAudit({
    actorType: 'system', actorId: null, action: 'bounty.scope_gate_blocked', subjectType: 'github_repo', subjectId: decision.repo,
    detail: { reason: decision.reason, programId: decision.programId, agentType: context.agentType ?? null, runId: context.runId ?? null },
  });
}

/** Mandatory before any outbound call or durable mutation for a repository.
 * Returns the scope match on allow; throws BountyScopeError on refusal. */
export function gateGithubRepo(input: string, context: RepoGateContext = {}): ScopeMatch {
  const decision = decideRepoScope(input);
  if (decision.allowed) return assertInScope(decision.programId, decision.repo, context);
  if (decision.programId) {
    // Program-level refusal: assertInScope records the event and throws the
    // matching reason. If it unexpectedly does not throw, fall through and fail closed.
    assertInScope(decision.programId, decision.repo, context);
  }
  recordRefusal(decision, context);
  throw new BountyScopeError(decision.programId ?? 'none', decision.repo, decision.reason);
}

/** Non-throwing variant for list filtering. Logs every refusal it returns. */
export function filterInScopeRepos<T>(items: T[], repoOf: (item: T) => string, context: RepoGateContext = {}): T[] {
  return items.filter(item => {
    const decision = decideRepoScope(repoOf(item));
    if (decision.allowed) return true;
    recordRefusal(decision, context);
    return false;
  });
}

/** Records that a discovery pass was skipped because no program is active. */
export function recordNoActiveProgram(context: RepoGateContext = {}): void {
  appendMissionAudit({
    actorType: 'system', actorId: null, action: 'bounty.scope_gate_program_not_configured', subjectType: 'github_bounty_worker', subjectId: 'github-issue-bounty',
    detail: { reason: 'program_not_configured', agentType: context.agentType ?? null, runId: context.runId ?? null },
  });
}
