/** Test fixtures only. Registers an ACTIVE bounty program whose exact `repo`
 * allow rows are the given repositories. Mirrors the owner-only control plane. */
import { randomUUID } from 'node:crypto';
import { createBountyProgram, updateBountyProgram, upsertScopeAllowlist } from './bug-bounty-system';

export const FIXTURE_TERMS_HASH = 'a'.repeat(64);

export function registerFixtureRepoProgram(repos: string[], options: { active?: boolean } = {}): string {
  const program = createBountyProgram({
    platform: 'github-issues', programHandle: `fixture-${randomUUID()}`, scopeUrl: 'https://github.com/fixture-scope',
    programTermsHash: FIXTURE_TERMS_HASH, active: false,
  });
  const programId = String(program.id);
  for (const repo of repos) upsertScopeAllowlist(programId, { target: repo, targetType: 'repo', inScope: true });
  // The product only lets a program be armed once it has an in-scope row, so the fixture follows the
  // same order a person does — register, scope, then activate — instead of writing the row active.
  if (options.active ?? true) updateBountyProgram(programId, { active: true });
  return programId;
}

export const SCOPE_TABLES = ['scope_gate_events', 'scope_allowlist', 'bounty_programs'];
