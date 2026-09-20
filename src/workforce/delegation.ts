import { getAgentBySlug } from '../agents/registry';
import { insertExecutionParticipant, recordEconomyEvent } from '../db/economy-repositories';
import { evaluateSpawn, recordSpawnDecision } from '../economy/hierarchy';
import { expandCapability } from '../economy/treasury';
import { setAgentOverlay } from './repositories';

/**
 * WORKFORCE DELEGATION — agents creating/managing subordinate agents through
 * the Agent Factory, under the hierarchy gates.
 *
 * Guarantees:
 *   · unique identities (Factory slug uniqueness);
 *   · clear responsibilities (gap + objectives recorded);
 *   · lifecycle/status tracking (expansion row + profile status);
 *   · budgets (child budget granted at creation; parent charged spawn cost);
 *   · permissions WITHOUT escalation (child tools ⊆ parent tools ∩ catalog);
 *   · audit logs (delegation row with every gate verdict + economy event);
 *   · parent-agent relationship (profile parent link + delegation chain);
 *   · failure handling (child pause/reassign primitives, never silent).
 */

export class DelegationError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'DelegationError';
  }
}

export interface DelegateInput {
  parentAgentSlug: string;
  gap: string;
  specialization: string;
  systemInstructions: string;
  childBudgetCents?: number;
  /** Requested tool keys for the child; silently intersected with the parent's (no escalation). */
  requestedTools?: string[];
  /** Categories the child will serve (subset of the parent's eligibility). */
  categories?: string[];
  executionId?: string;
  role?: string;
}

export interface DelegateOutcome {
  expansionId: string;
  childAgentSlug: string;
  status: string;
  grantedTools: string[];
  categories: string[];
  blockedReason?: string;
}

export function delegateWork(input: DelegateInput): DelegateOutcome {
  const parent = getAgentBySlug(input.parentAgentSlug);
  if (!parent) {
    throw new DelegationError(404, 'parent_not_found', `parent agent "${input.parentAgentSlug}" does not exist in the registry`);
  }
  if (!input.gap.trim() || !input.specialization.trim() || !input.systemInstructions.trim()) {
    throw new DelegationError(400, 'invalid_request', 'gap, specialization and system_instructions are required');
  }
  // No permission escalation: the child receives at most the parent's tools.
  const parentTools = new Set(parent.toolPermissions);
  const requested = input.requestedTools ?? ['web_search', 'page_fetch'];
  const granted = [...new Set(requested)].filter((tool) => parentTools.has(tool));
  if (granted.length === 0) {
    throw new DelegationError(400, 'no_permitted_tools', 'the child would have no tools: requested tools must overlap the parent\'s tool permissions');
  }

  const decision = evaluateSpawn({
    parentAgentSlug: input.parentAgentSlug,
    actor: input.parentAgentSlug,
    gap: input.gap,
    initiatedBy: 'agent',
    ...(input.childBudgetCents !== undefined ? { childBudgetCents: input.childBudgetCents } : {}),
  });
  if (!decision.allowed) {
    recordSpawnDecision({ decision, parentAgentSlug: input.parentAgentSlug, gap: input.gap, actor: input.parentAgentSlug });
    recordEconomyEvent({
      kind: 'expansion', actor: input.parentAgentSlug,
      summary: `delegation REJECTED for ${input.parentAgentSlug}: ${decision.reason} — ${decision.reasonDetail}`,
    });
    return { expansionId: '', childAgentSlug: '', status: 'rejected', grantedTools: granted, categories: [], blockedReason: `${decision.reason} (${decision.reasonDetail})` };
  }

  const created = expandCapability({
    gap: input.gap,
    specialization: input.specialization,
    systemInstructions: `${input.systemInstructions}\n\nDelegation constraint: you are a subordinate of ${input.parentAgentSlug}. Operate only within your granted tools (${granted.join(', ')}) and budget. Never claim revenue without evidence. Escalate failures to your parent.`,
    parentAgentSlug: input.parentAgentSlug,
    actor: input.parentAgentSlug,
    initiatedBy: 'agent',
    ...(input.childBudgetCents !== undefined ? { childBudgetCents: input.childBudgetCents } : {}),
  });
  if (created.status === 'rejected' || !created.agentSlug) {
    return { expansionId: created.expansionId, childAgentSlug: '', status: 'rejected', grantedTools: granted, categories: [], blockedReason: created.blockedReason ?? 'rejected by policy' };
  }
  const categories = (input.categories ?? []).slice(0, 20);
  setAgentOverlay(created.agentSlug, { capabilities: granted, categories });
  if (input.executionId) {
    insertExecutionParticipant({ executionId: input.executionId, agentSlug: created.agentSlug, role: input.role ?? 'worker', costShareCents: 0 });
  }
  recordEconomyEvent({
    kind: 'expansion', actor: input.parentAgentSlug,
    summary: `delegation AUTHORIZED: ${input.parentAgentSlug} → ${created.agentSlug} for "${input.gap.slice(0, 120)}" (tools: ${granted.join(', ')})`,
    details: { expansionId: created.expansionId, executionId: input.executionId ?? null },
  });
  return { expansionId: created.expansionId, childAgentSlug: created.agentSlug, status: created.status, grantedTools: granted, categories };
}
