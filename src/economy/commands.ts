import { createHash } from 'node:crypto';
import { db } from '../db/database';
import { getAgentBySlug } from '../agents/registry';
import { redactSecrets } from '../config/secrets';
import {
  getCommand,
  getExecution,
  getOpportunity,
  insertCommand,
  insertMissionMessage,
  listCommands,
  recordEconomyEvent,
  updateCommand,
  type CommandRow,
} from '../db/economy-repositories';
import { assertAgentRunnable } from './hierarchy';
import { currentPolicy } from './policy';

/**
 * OWNER → AGENT COMMAND FLOW — the last mile of mission control.
 *
 *   owner issues command → agent acknowledges → execution runs (progress via
 *   the execution row) → delivery links → verification judges.
 *
 * Guarantees:
 *   - Idempotent: the owner-supplied idempotency key makes replays return the
 *     same command instead of forking duplicate work.
 *   - Gated: kill-switch, paused agent (or paused ancestor) and unknown agent
 *     refuse with an exact reason. A command never bypasses the normal
 *     execution authorization — it LINKS to it.
 *   - Honest verification: 'verified' is set only when a real delivery row
 *     exists AND that delivery is marked verified. Anything else stays
 *     'pending' (or 'failed' when the work demonstrably failed).
 *   - Chat-linked: every command also lands in the persistent owner↔agent
 *     mission-chat thread, so the conversation and the work order never drift.
 */

export class CommandError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const MAX_INSTRUCTION_CHARS = 20_000;

function requireAgent(agentSlug: string): void {
  if (!getAgentBySlug(agentSlug)) {
    throw new CommandError(404, 'agent_not_found', `agent "${agentSlug}" does not exist in the registry`);
  }
}

export function sendCommand(input: {
  ownerUserId: string;
  agentSlug: string;
  instruction: string;
  idempotencyKey: string;
}): { command: CommandRow; duplicate: boolean } {
  const instruction = input.instruction.trim();
  if (!instruction) throw new CommandError(400, 'invalid_request', 'instruction must not be empty');
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    throw new CommandError(400, 'invalid_request', `instruction exceeds ${MAX_INSTRUCTION_CHARS} characters`);
  }
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new CommandError(400, 'invalid_request', 'idempotency_key (min 4 chars) is required');
  }
  requireAgent(input.agentSlug);
  const policy = currentPolicy();
  if (policy.killSwitch) {
    throw new CommandError(409, 'kill_switch_engaged', 'commands are refused while the kill switch is engaged');
  }
  try {
    assertAgentRunnable(input.agentSlug);
  } catch (error) {
    throw new CommandError(409, 'agent_not_runnable', error instanceof Error ? error.message : String(error));
  }
  const { row, duplicate } = insertCommand({
    idempotencyKey: input.idempotencyKey.trim(),
    ownerUserId: input.ownerUserId,
    agentSlug: input.agentSlug,
    instruction: redactSecrets(instruction),
  });
  if (duplicate) return { command: row, duplicate: true };
  // The command joins the persistent chat thread (redacted at rest).
  insertMissionMessage({
    ownerUserId: input.ownerUserId,
    agentSlug: input.agentSlug,
    direction: 'owner',
    content: redactSecrets(`[command ${row.id}] ${instruction}`.slice(0, MAX_INSTRUCTION_CHARS)),
  });
  recordEconomyEvent({
    kind: 'command_issued',
    actor: input.ownerUserId,
    summary: `command ${row.id} issued to ${input.agentSlug}`,
    details: { commandId: row.id, chars: instruction.length },
  });
  return { command: row, duplicate: false };
}

const TRANSITIONS: Record<string, string[]> = {
  issued: ['acknowledged', 'cancelled'],
  acknowledged: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

function move(id: string, to: string, actor: string, note: string): CommandRow {
  const command = getCommand(id);
  if (!command) throw new CommandError(404, 'command_not_found', `command "${id}" does not exist`);
  if (!TRANSITIONS[command.status]?.includes(to)) {
    throw new CommandError(409, 'invalid_transition', `command is '${command.status}' — cannot move to '${to}'`);
  }
  updateCommand(id, { status: to });
  recordEconomyEvent({ kind: 'command_status', actor, summary: `command ${id} → ${to}: ${note}`, details: { commandId: id } });
  return getCommand(id)!;
}

export function acknowledgeCommand(id: string, actor: string): CommandRow {
  return move(id, 'acknowledged', actor, 'agent acknowledged the order');
}

/**
 * Link the command to the real authorized work (opportunity + execution).
 * Both rows must exist and the execution must belong to the commanded agent —
 * a command can never claim somebody else's work.
 */
export function linkCommandWork(input: { id: string; opportunityId: string; executionId: string; actor: string }): CommandRow {
  const command = getCommand(input.id);
  if (!command) throw new CommandError(404, 'command_not_found', `command "${input.id}" does not exist`);
  if (command.status !== 'acknowledged') {
    throw new CommandError(409, 'invalid_transition', `command is '${command.status}' — link work only after acknowledgement`);
  }
  const opportunity = getOpportunity(input.opportunityId);
  if (!opportunity) throw new CommandError(404, 'opportunity_not_found', `opportunity "${input.opportunityId}" does not exist`);
  const execution = getExecution(input.executionId);
  if (!execution) throw new CommandError(404, 'execution_not_found', `execution "${input.executionId}" does not exist`);
  if (execution.opportunity_id !== input.opportunityId) {
    throw new CommandError(400, 'invalid_request', 'execution does not belong to the given opportunity');
  }
  if (execution.agent_slug !== command.agent_slug) {
    throw new CommandError(400, 'invalid_request', `execution runs as ${execution.agent_slug}, not the commanded ${command.agent_slug}`);
  }
  updateCommand(input.id, { status: 'running', opportunityId: input.opportunityId, executionId: input.executionId });
  recordEconomyEvent({
    kind: 'command_status', actor: input.actor,
    summary: `command ${input.id} running: ${input.opportunityId}/${input.executionId}`,
    details: { commandId: input.id },
  });
  return getCommand(input.id)!;
}

interface DeliveryLink { id: string; verified: number | boolean; execution_id: string; agent_slug: string }

/**
 * Close the command with its real outcome. verification='verified' requires a
 * real delivery row that is itself marked verified; otherwise the command
 * honestly stays 'pending' (work finished, proof not yet verified) or the
 * caller declares 'failed' with a reason.
 */
export function completeCommand(input: {
  id: string;
  actor: string;
  resultSummary: string;
  deliveryId?: string | null;
  failed?: boolean;
  failureReason?: string;
}): CommandRow {
  const command = getCommand(input.id);
  if (!command) throw new CommandError(404, 'command_not_found', `command "${input.id}" does not exist`);
  if (command.status !== 'running') {
    throw new CommandError(409, 'invalid_transition', `command is '${command.status}' — only running commands complete`);
  }
  const summary = input.resultSummary.trim().slice(0, 2000);
  if (!summary) throw new CommandError(400, 'invalid_request', 'result_summary is required');
  if (input.failed) {
    updateCommand(input.id, { status: 'failed', resultSummary: redactSecrets(summary), verification: 'failed' });
    recordEconomyEvent({
      kind: 'command_status', actor: input.actor,
      summary: `command ${input.id} FAILED: ${redactSecrets(input.failureReason ?? summary).slice(0, 200)}`,
      details: { commandId: input.id },
    });
    return getCommand(input.id)!;
  }
  let verification: 'verified' | 'pending' = 'pending';
  let deliveryId: string | null = null;
  if (input.deliveryId) {
    const delivery = db.get<DeliveryLink>('SELECT id, verified, execution_id, agent_slug FROM economy_deliveries WHERE id = ?', [input.deliveryId]);
    if (!delivery) throw new CommandError(404, 'delivery_not_found', `delivery "${input.deliveryId}" does not exist`);
    if (command.execution_id && delivery.execution_id !== command.execution_id) {
      throw new CommandError(400, 'invalid_request', 'delivery does not belong to the commanded execution');
    }
    if (delivery.agent_slug !== command.agent_slug) {
      throw new CommandError(400, 'invalid_request', 'delivery was produced by a different agent');
    }
    deliveryId = delivery.id;
    verification = Number(delivery.verified) === 1 ? 'verified' : 'pending';
  }
  updateCommand(input.id, { status: 'completed', resultSummary: redactSecrets(summary), deliveryId, verification });
  recordEconomyEvent({
    kind: 'command_status', actor: input.actor,
    summary: `command ${input.id} completed (verification: ${verification})`,
    details: { commandId: input.id, deliveryId },
  });
  return getCommand(input.id)!;
}

export function cancelCommand(id: string, reason: string, actor: string): CommandRow {
  if (!reason || reason.trim().length < 4) throw new CommandError(400, 'invalid_request', 'a cancel reason is required');
  return move(id, 'cancelled', actor, reason.trim().slice(0, 200));
}

/** Full status: command + linked opportunity/execution/delivery + chat depth. */
export function commandStatus(id: string): {
  command: CommandRow;
  opportunity: ReturnType<typeof getOpportunity> | null;
  execution: ReturnType<typeof getExecution> | null;
  deliveryVerified: boolean | null;
} {
  const command = getCommand(id);
  if (!command) throw new CommandError(404, 'command_not_found', `command "${id}" does not exist`);
  const opportunity = command.opportunity_id ? (getOpportunity(command.opportunity_id) ?? null) : null;
  const execution = command.execution_id ? (getExecution(command.execution_id) ?? null) : null;
  let deliveryVerified: boolean | null = null;
  if (command.delivery_id) {
    const delivery = db.get<{ verified: number }>('SELECT verified FROM economy_deliveries WHERE id = ?', [command.delivery_id]);
    deliveryVerified = delivery ? Number(delivery.verified) === 1 : null;
  }
  return { command, opportunity, execution, deliveryVerified };
}

export function commandFingerprint(instruction: string): string {
  return createHash('sha256').update(instruction.trim()).digest('hex').slice(0, 16);
}

export { listCommands };
