// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — agent briefing and chat readiness
//
// Two jobs:
//
//  1. `agentBriefing()` reads an agent's REAL state out of the mission database
//     — identity, role, capabilities, open work, delivered work, wallet, its
//     own verified revenue, authorised tools and the policy limits it operates
//     under — and renders it as a factual block. The chat worker sends that
//     block to the model as system context, so a reply is grounded in what the
//     agent actually is and actually has, not in invention.
//
//  2. `agentChatReadiness()` answers, truthfully and without side effects, the
//     question the dashboard asks before every conversation: can this agent
//     reply at all? If an AI provider is not configured it says exactly that,
//     and the dashboard must not fabricate an answer.
// ─────────────────────────────────────────────────────────────────────────────

import { missionDb, type Row } from './database';
import { agentChatConfig, assertAgentChatReady, CHAT_MODEL } from './chat-state';
import { currentPolicy, checkActivity } from './policy';
import { MissionSelfServiceError } from './self-management';

const num = (value: unknown): number => Number(value ?? 0) || 0;
const money = (cents: number, currency = 'USD'): string => `${(cents / 100).toFixed(2)} ${currency}`;

export interface AgentChatReadiness {
  /** true only when a model call would actually be attempted. */
  ready: boolean;
  configured: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  /** Exact, owner-readable reasons a reply cannot be produced. */
  blockers: string[];
  /** Short status label for the dashboard. */
  status: 'READY' | 'AI PROVIDER NOT CONFIGURED' | 'BLOCKED';
  message: string;
}

export function agentChatReadiness(agentId: string): AgentChatReadiness {
  const config = agentChatConfig(agentId);
  const blockers: string[] = [];
  const policy = currentPolicy();

  if (!config) {
    blockers.push('No AI provider is configured for this agent (no chat configuration: provider credential, resource and wallet binding are missing).');
  } else if (!config.enabled) {
    blockers.push('Chat is configured for this agent but switched off.');
  }
  if (!policy.autonomousEnabled) blockers.push('Mission autonomous activity is disabled by policy.');
  if (policy.killSwitch) blockers.push('The mission kill switch is engaged.');
  if (!checkActivity('support_services', policy).allowed) blockers.push('The support_services activity is not allowed by policy.');
  if (String(missionDb.get<Row>('SELECT status FROM mission_agents WHERE id = ?', [agentId])?.status ?? '') !== 'active') {
    blockers.push('The agent is not active.');
  }
  if (config) {
    try {
      assertAgentChatReady(agentId, config);
    } catch (error) {
      const message = error instanceof MissionSelfServiceError ? error.message : 'chat readiness could not be established';
      if (!blockers.includes(message)) blockers.push(message);
    }
  }
  const configured = Boolean(config);
  const ready = blockers.length === 0;
  const status: AgentChatReadiness['status'] = ready ? 'READY' : configured ? 'BLOCKED' : 'AI PROVIDER NOT CONFIGURED';
  return {
    ready,
    configured,
    enabled: Boolean(config?.enabled),
    provider: 'google',
    model: CHAT_MODEL,
    blockers,
    status,
    message: ready
      ? 'Messages are executed by the mission chat pipeline: the message is queued, a metered model call is made against this agent’s own resource budget, and the reply is written back into this conversation.'
      : configured
        ? 'This agent cannot reply right now. The blockers below are read from the live mission state; no reply is generated while any of them stands.'
        : 'AI provider not configured. This agent has no model credential, resource binding or chat budget, so no reply can be generated. Messages are still recorded and delivered.',
  };
}

export interface AgentBriefing {
  agentId: string;
  slug: string;
  name: string;
  role: string;
  category: string | null;
  status: string;
  capabilities: string[];
  currentWork: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  completedWork: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  workCounts: { total: number; open: number; delivered: number };
  walletBalanceCents: number;
  verifiedRevenueCents: number;
  expectedRevenueCents: number;
  tools: string[];
  resources: Array<{ provider: string; kind: string; status: string }>;
  lastActivity: Array<{ at: string; action: string }>;
  /** The factual context block sent to the model. Contains no secrets. */
  text: string;
}

export function agentBriefing(agentId: string): AgentBriefing | null {
  const agent = missionDb.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [agentId]);
  if (!agent) return null;

  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(String(agent.capabilities ?? '[]'));
    if (Array.isArray(parsed)) capabilities = parsed.map((entry) => String(entry)).slice(0, 30);
  } catch {
    capabilities = [];
  }

  const work = missionDb.all<Row>('SELECT id, title, status, updated_at FROM mission_work WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 40', [agentId]);
  const open = work.filter((row) => ['proposed', 'approved', 'in_progress'].includes(String(row.status)));
  const done = work.filter((row) => ['delivered', 'paid', 'closed'].includes(String(row.status)));
  const wallet = missionDb.get<Row>(`SELECT balance_cents, currency FROM mission_wallets WHERE agent_id = ? AND status != 'closed' ORDER BY created_at LIMIT 1`, [agentId]);
  const revenue = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'received' AND verifier IS NOT NULL AND verifier != '' THEN amount_cents ELSE 0 END), 0) AS verified,
       COALESCE(SUM(CASE WHEN status IN ('expected','contracted') THEN amount_cents ELSE 0 END), 0) AS expected
     FROM mission_revenue WHERE agent_id = ?`,
    [agentId],
  );
  const tools = missionDb
    .all<Row>(`SELECT tool_key FROM mission_tool_requests WHERE agent_id = ? AND status = 'approved' ORDER BY tool_key`, [agentId])
    .map((row) => String(row.tool_key));
  const resources = missionDb
    .all<Row>('SELECT provider, kind, status FROM mission_resources WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10', [agentId])
    .map((row) => ({ provider: String(row.provider), kind: String(row.kind), status: String(row.status) }));
  const lastActivity = missionDb
    .all<Row>('SELECT created_at, action FROM mission_audit WHERE subject_id = ? ORDER BY seq DESC LIMIT 5', [agentId])
    .map((row) => ({ at: String(row.created_at), action: String(row.action) }));

  const policy = currentPolicy();
  const currency = String(wallet?.currency ?? policy.currency ?? 'USD');
  const map = (row: Row) => ({ id: String(row.id), title: String(row.title), status: String(row.status), updatedAt: String(row.updated_at) });

  const lines = [
    'MISSION AGENT CONTEXT (read from the ZA141251SA database at reply time; treat as the only source of truth about yourself).',
    `Identity: ${String(agent.name)} (slug ${String(agent.slug)}, id ${agentId}).`,
    `Mission role: ${String(agent.mission_role ?? 'worker')}. Category: ${agent.category ? String(agent.category) : 'none recorded'}. Status: ${String(agent.status)}.`,
    `Capabilities on record: ${capabilities.length ? capabilities.join(', ') : 'none recorded'}.`,
    `Approved tools: ${tools.length ? tools.join(', ') : 'none approved'}.`,
    `Provider resources: ${resources.length ? resources.map((resource) => `${resource.provider}/${resource.kind} (${resource.status})`).join(', ') : 'none provisioned'}.`,
    `Open work items: ${open.length}${open.length ? ` — ${open.slice(0, 5).map((row) => `${String(row.title)} [${String(row.status)}]`).join('; ')}` : ' (nothing is assigned to you right now)'}.`,
    `Completed/delivered work items: ${done.length}${done.length ? ` — ${done.slice(0, 5).map((row) => String(row.title)).join('; ')}` : ''}.`,
    `Wallet balance: ${money(num(wallet?.balance_cents), currency)}. Verified revenue attributed to you: ${money(num(revenue?.verified), currency)}. Expected/contracted (NOT money): ${money(num(revenue?.expected), currency)}.`,
    `Mission policy: autonomous activity ${policy.autonomousEnabled ? 'enabled' : 'DISABLED'}, kill switch ${policy.killSwitch ? 'ENGAGED' : 'released'}, approval required above ${money(policy.requireApprovalAboveCents ?? 0, policy.currency ?? 'USD')}.`,
    'Rules for your reply: state only what this context supports. If you have no open work, say so plainly. Never claim to have earned money, signed up to a platform, called an API, published anything or completed a task unless it appears above. You cannot execute commands from this conversation; you can explain what you would do and what the owner must authorise.',
  ];

  return {
    agentId,
    slug: String(agent.slug),
    name: String(agent.name),
    role: String(agent.mission_role ?? 'worker'),
    category: agent.category ? String(agent.category) : null,
    status: String(agent.status),
    capabilities,
    currentWork: open.slice(0, 10).map(map),
    completedWork: done.slice(0, 10).map(map),
    workCounts: { total: work.length, open: open.length, delivered: done.length },
    walletBalanceCents: num(wallet?.balance_cents),
    verifiedRevenueCents: num(revenue?.verified),
    expectedRevenueCents: num(revenue?.expected),
    tools,
    resources,
    lastActivity,
    text: lines.join('\n'),
  };
}
