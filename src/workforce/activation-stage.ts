import { db } from '../db';
import { currentPolicy } from '../economy/policy';

/**
 * Controlled agent-activation model (read-only reporting, no side effects).
 *
 * The 4,001-agent registry has existed since agent-registry sync, but
 * "registered" has never implied "earning". This module answers, with real
 * counts only, where every registered agent actually sits on the path from
 * registration to a verified, externally-settled earning outcome — so a
 * blanket "4,001 agents active" claim can never be made without evidence.
 *
 * STAGE 0 — REGISTERED       every agent created by the registry sync.
 * STAGE 1 — POLICY-ELIGIBLE  autonomous discovery is enabled AND the kill
 *                            switch is off AND the agent's category is in
 *                            the policy's allowed discovery-category list.
 *                            (Honest by construction: while autonomy is off
 *                            by default, this is legitimately 0 — that is
 *                            not a bug, it is the safety default.)
 * STAGE 2 — ASSIGNED         holds an ACTIVE 1:1 platform assignment
 *                            (economy_opportunity_assignments, status =
 *                            'active') — i.e. a real owner-created account
 *                            is bound to exactly this agent. Exclusive by
 *                            database constraint (see migration 0021).
 * STAGE 3 — VERIFIED WORK    has at least one execution in
 *                            economy_executions with status='completed' AND
 *                            a non-empty verification_json (completion
 *                            without a verification record does not count).
 * STAGE 4 — SETTLED          participated in an execution whose opportunity
 *                            has economy_revenue in a settled/received state
 *                            WITH both `evidence` and `external_ref`
 *                            populated — a claim with no external reference
 *                            is never counted here.
 * STAGE 5 — EXPANSION-READY  policy-computed: true only once at least one
 *                            agent has reached Stage 4 AND the current
 *                            active-assignment count is below the policy's
 *                            concurrency ceiling, i.e. there is verified
 *                            evidence AND headroom to add another agent.
 *                            This function never changes the ceiling itself
 *                            — raising it is always an explicit policy edit.
 */

export interface ActivationStageCounts {
  stage0Registered: number;
  stage1PolicyEligible: number;
  stage2Assigned: number;
  stage3VerifiedWork: number;
  stage4Settled: number;
}

export interface ActivationStageReport {
  generatedAt: string;
  counts: ActivationStageCounts;
  /** Real agent_slug lists for the two smallest, highest-scrutiny stages (assigned/settled) — never for the 4,001-wide stage 0/1 counts. */
  assignedAgents: string[];
  settledAgents: string[];
  policy: {
    autonomousEnabled: boolean;
    killSwitch: boolean;
    maxConcurrentExecutions: number;
    maxEconomyAgents: number;
    discoveryCategories: string[];
  };
  stage5ExpansionReady: boolean;
  stage5Reason: string;
  /** Never invented: this function only ever reports what STAGE the platform is honestly at, not a percentage or a forecast. */
  honesty: {
    note: 'Every count is a live query result. "Registered" and "policy-eligible" are not "earning" — only stage 3 (verified work) and stage 4 (settled) represent agents that have actually produced anything.';
  };
}

interface AgentCategoryRow {
  agent_slug: string;
  categories_json: string | null;
}

function agentCategories(row: AgentCategoryRow): string[] {
  if (!row.categories_json) return [];
  try {
    const parsed = JSON.parse(row.categories_json);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export function activationStageReport(): ActivationStageReport {
  const policy = currentPolicy();

  const registeredRow = db.get<{ total: number }>('SELECT COUNT(*) AS total FROM agents');
  const stage0Registered = Number(registeredRow?.total ?? 0);

  let stage1PolicyEligible = 0;
  if (policy.autonomousEnabled && !policy.killSwitch && policy.discoveryCategories.length > 0) {
    const profileRows = db.all<AgentCategoryRow>(
      `SELECT agent_slug, categories_json FROM economy_agent_profiles WHERE status = 'active'`,
    );
    stage1PolicyEligible = profileRows.filter((row) => agentCategories(row).some((c) => policy.discoveryCategories.includes(c))).length;
  }

  const assignedRows = db.all<{ agent_slug: string }>(
    `SELECT agent_slug FROM economy_opportunity_assignments WHERE status = 'active' ORDER BY agent_slug`,
  );
  const assignedAgents = assignedRows.map((r) => r.agent_slug);

  const verifiedWorkRow = db.all<{ agent_slug: string }>(
    `SELECT DISTINCT agent_slug FROM economy_executions
     WHERE status = 'completed' AND verification_json IS NOT NULL AND TRIM(verification_json) != ''`,
  );
  const stage3VerifiedWork = verifiedWorkRow.length;

  // Stage 4: an agent that executed work whose opportunity's revenue is both
  // in a settled/received state AND carries real external evidence — never a
  // pending or unverified claim.
  const settledRows = db.all<{ agent_slug: string }>(
    `SELECT DISTINCT e.agent_slug AS agent_slug
     FROM economy_executions e
     JOIN economy_revenue r ON r.opportunity_id = e.opportunity_id
     WHERE e.status = 'completed'
       AND r.state IN ('received', 'settled')
       AND r.evidence IS NOT NULL AND TRIM(r.evidence) != ''
       AND r.external_ref IS NOT NULL AND TRIM(r.external_ref) != ''`,
  );
  const settledAgents = settledRows.map((r) => r.agent_slug);
  const stage4Settled = settledAgents.length;

  const stage5ExpansionReady = stage4Settled > 0 && assignedAgents.length < policy.maxConcurrentExecutions;
  const stage5Reason =
    stage4Settled === 0
      ? 'no agent has reached Stage 4 (verified external settlement) yet — expansion is not evidence-supported'
      : assignedAgents.length >= policy.maxConcurrentExecutions
        ? `at least one verified settlement exists, but the current concurrency ceiling (${policy.maxConcurrentExecutions}) is already reached — raise it deliberately, do not auto-expand`
        : `at least one verified settlement exists and there is headroom under the concurrency ceiling (${assignedAgents.length}/${policy.maxConcurrentExecutions}) — controlled expansion may proceed`;

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      stage0Registered,
      stage1PolicyEligible,
      stage2Assigned: assignedAgents.length,
      stage3VerifiedWork,
      stage4Settled,
    },
    assignedAgents,
    settledAgents,
    policy: {
      autonomousEnabled: policy.autonomousEnabled,
      killSwitch: policy.killSwitch,
      maxConcurrentExecutions: policy.maxConcurrentExecutions,
      maxEconomyAgents: policy.maxEconomyAgents,
      discoveryCategories: policy.discoveryCategories,
    },
    stage5ExpansionReady,
    stage5Reason,
    honesty: {
      note: 'Every count is a live query result. "Registered" and "policy-eligible" are not "earning" — only stage 3 (verified work) and stage 4 (settled) represent agents that have actually produced anything.',
    },
  };
}
