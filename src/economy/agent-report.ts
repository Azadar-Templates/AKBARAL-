import { db } from '../db/database';
import { getAgentBySlug } from '../agents/registry';
import { generateAgentDefinitions } from '../agents/catalog';
import { getAgentProfileBySlug, countAgentChildren, listCommands } from '../db/economy-repositories';
import { primaryAssignmentForAgent } from '../workforce/platforms';
import { agentAccountFor } from './treasury';
import { agentQuotaStatus, delegationChain } from './hierarchy';

/**
 * PER-AGENT WORKFORCE PROFILE — one honest page per agent.
 *
 * Every figure is a live aggregation over the real tables (ledger, revenue,
 * executions, deliveries, commands, assignments, chat). Nothing is estimated
 * and nothing is cached: a zero means "nothing happened yet", never "unknown".
 * Settlements are treasury-level (no per-agent attribution exists by design),
 * so per-agent "withdrawals" are the executed treasury transfers OUT of that
 * agent — labelled exactly as such.
 */

export interface AgentWorkforceProfile {
  agent: { slug: string; name: string; specialization: string; category: string };
  status: { profile: string; paused: boolean; depth: number; parent: string | null; children: number };
  quotas: ReturnType<typeof agentQuotaStatus>;
  primary: { platformKey: string; platformName: string; status: string; propertyId: string | null; workflowKey: string } | null;
  work: { opportunities: number; executions: number; completed: number; failed: number; running: number; deliveries: number; deliveriesVerified: number };
  commands: { total: number; completed: number; verified: number; failed: number; open: number };
  chat: { messages: number; lastAt: string | null };
  finance: {
    realizedRevenueCents: number; costCents: number; transferredOutCents: number; availableCents: number;
    profitCents: number; reinvestedCents: number; reinvestProposed: number;
  };
  verification: { deliveriesVerified: number; deliveriesTotal: number; commandsVerified: number; commandsTotal: number };
  blockers: string[];
}

function count(sql: string, params: unknown[] = []): number {
  return Number(db.get<{ n: number }>(sql, params as never[])?.n ?? 0);
}

export function agentWorkforceProfile(agentSlug: string): AgentWorkforceProfile {
  const agent = getAgentBySlug(agentSlug);
  if (!agent) throw new Error(`agent "${agentSlug}" does not exist in the registry`);
  const profile = getAgentProfileBySlug(agentSlug);
  const account = agentAccountFor(agentSlug);
  const assignment = primaryAssignmentForAgent(agentSlug);
  const chain = delegationChain(agentSlug);
  const executions = count('SELECT COUNT(*) AS n FROM economy_executions WHERE agent_slug = ?', [agentSlug]);
  const completed = count("SELECT COUNT(*) AS n FROM economy_executions WHERE agent_slug = ? AND status = 'completed'", [agentSlug]);
  const failed = count("SELECT COUNT(*) AS n FROM economy_executions WHERE agent_slug = ? AND status IN ('failed','timed_out')", [agentSlug]);
  const running = count("SELECT COUNT(*) AS n FROM economy_executions WHERE agent_slug = ? AND status IN ('authorized','running')", [agentSlug]);
  const opportunities = count('SELECT COUNT(DISTINCT opportunity_id) AS n FROM economy_executions WHERE agent_slug = ?', [agentSlug]);
  const deliveries = count('SELECT COUNT(*) AS n FROM economy_deliveries WHERE agent_slug = ?', [agentSlug]);
  const deliveriesVerified = count('SELECT COUNT(*) AS n FROM economy_deliveries WHERE agent_slug = ? AND verified = 1', [agentSlug]);
  const commands = listCommands({ agentSlug, limit: 500 });
  const commandsCompleted = commands.filter((c) => c.status === 'completed').length;
  const commandsVerified = commands.filter((c) => c.verification === 'verified').length;
  const commandsFailed = commands.filter((c) => c.status === 'failed').length;
  const commandsOpen = commands.filter((c) => ['issued', 'acknowledged', 'running'].includes(c.status)).length;
  const chat = db.get<{ n: number; last: string | null }>(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM mission_chat_messages WHERE agent_slug = ?', [agentSlug],
  );
  const reinvested = Number(
    db.get<{ total: number | null }>(
      "SELECT SUM(amount_cents) AS total FROM economy_reinvestments WHERE agent_slug = ? AND status = 'executed'", [agentSlug],
    )?.total ?? 0,
  );
  const reinvestProposed = count("SELECT COUNT(*) AS n FROM economy_reinvestments WHERE agent_slug = ? AND status = 'proposed'", [agentSlug]);
  let platformName = '';
  if (assignment) {
    platformName = db.get<{ name: string }>('SELECT name FROM economy_platforms WHERE platform_key = ?', [assignment.platform_key])?.name ?? assignment.platform_key;
  }
  const blockers: string[] = [];
  if (!profile || profile.status === 'paused') blockers.push('agent is paused');
  if (!assignment) blockers.push('no primary earning opportunity assigned');
  else if (assignment.status === 'pending_account') blockers.push(`primary ${assignment.platform_key} awaits its dedicated external account (owner must create it)`);
  if (account.availableCents <= 0 && account.realizedRevenueCents <= 0) blockers.push('no realized earnings yet — nothing to spend, reinvest or withdraw');
  if (deliveries > 0 && deliveriesVerified === 0) blockers.push(`${deliveries} deliverable(s) produced, none verified yet`);
  return {
    agent: { slug: agent.slug, name: agent.name, specialization: agent.specialization, category: agent.category },
    status: {
      profile: profile?.status ?? 'no-profile',
      paused: profile?.status === 'paused',
      depth: chain.length > 0 ? Math.max(...chain.map((c) => c.depth)) : 0,
      parent: profile?.parent_agent_slug ?? null,
      children: countAgentChildren(agentSlug),
    },
    quotas: agentQuotaStatus(agentSlug),
    primary: assignment
      ? { platformKey: assignment.platform_key, platformName, status: assignment.status, propertyId: assignment.dedicated_account_property_id, workflowKey: assignment.earning_workflow_key }
      : null,
    work: { opportunities, executions, completed, failed, running, deliveries, deliveriesVerified },
    commands: { total: commands.length, completed: commandsCompleted, verified: commandsVerified, failed: commandsFailed, open: commandsOpen },
    chat: { messages: Number(chat?.n ?? 0), lastAt: chat?.last ?? null },
    finance: {
      realizedRevenueCents: account.realizedRevenueCents,
      costCents: account.costCents,
      transferredOutCents: account.transferredOutCents,
      availableCents: account.availableCents,
      profitCents: account.realizedRevenueCents - account.costCents,
      reinvestedCents: reinvested,
      reinvestProposed,
    },
    verification: { deliveriesVerified, deliveriesTotal: deliveries, commandsVerified, commandsTotal: commands.length },
    blockers,
  };
}

/** Fleet rollup for the workforce overview: totals + per-status counts. */
export function workforceOverview(): {
  agents: number; catalogAgents: number; spawnedAgents: number; profiles: number; paused: number;
  primaries: number; pendingAccounts: number;
  opportunities: number; executions: number; deliveries: number; deliveriesVerified: number;
  commands: number; commandsVerified: number;
  realizedRevenueCents: number; costCents: number; settledCents: number;
} {
  return {
    agents: count('SELECT COUNT(*) AS n FROM agents'),
    catalogAgents: generateAgentDefinitions().length,
    spawnedAgents: count('SELECT COUNT(*) AS n FROM economy_expansions WHERE agent_slug IS NOT NULL'),
    profiles: count('SELECT COUNT(*) AS n FROM economy_agent_profiles'),
    paused: count("SELECT COUNT(*) AS n FROM economy_agent_profiles WHERE status = 'paused'"),
    primaries: count('SELECT COUNT(*) AS n FROM economy_opportunity_assignments'),
    pendingAccounts: count("SELECT COUNT(*) AS n FROM economy_opportunity_assignments WHERE status = 'pending_account'"),
    opportunities: count('SELECT COUNT(*) AS n FROM economy_opportunities'),
    executions: count('SELECT COUNT(*) AS n FROM economy_executions'),
    deliveries: count('SELECT COUNT(*) AS n FROM economy_deliveries'),
    deliveriesVerified: count('SELECT COUNT(*) AS n FROM economy_deliveries WHERE verified = 1'),
    commands: count('SELECT COUNT(*) AS n FROM economy_commands'),
    commandsVerified: count("SELECT COUNT(*) AS n FROM economy_commands WHERE verification = 'verified'"),
    realizedRevenueCents: Number(db.get<{ t: number | null }>("SELECT SUM(amount_cents) AS t FROM economy_ledger WHERE direction = 'credit'")?.t ?? 0),
    costCents: Number(db.get<{ t: number | null }>("SELECT SUM(amount_cents) AS t FROM economy_ledger WHERE direction = 'debit'")?.t ?? 0),
    settledCents: Number(db.get<{ t: number | null }>("SELECT SUM(amount_cents) AS t FROM economy_ledger WHERE direction = 'debit' AND category = 'settlement'")?.t ?? 0),
  };
}
