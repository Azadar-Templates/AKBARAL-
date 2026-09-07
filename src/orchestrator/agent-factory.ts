import { createHash } from 'node:crypto';
import {
  createAgent,
  createAgentExecution,
  createTask,
  db,
  findAgentBySlug,
  insertAgentVersion,
  linkAgentTool,
  listAgentVersions,
  updateAgentConfig,
  updateAgentStatus,
  updateTaskStatus,
  upsertAgentMarketplace,
  listAuditLogs,
  appendTaskEvent,
} from '../db';
import { getAgentBySlug } from '../agents/registry';
import { dispatchAgentExecution } from './executor';
import { createId } from '../db';

export interface CustomAgentInput {
  userId: string;
  name: string;
  slug?: string;
  specialization: string;
  description: string;
  systemInstructions: string;
  capabilities?: string[];
  inputs?: string[];
  outputs?: string[];
  modelRequirements?: string[];
  toolPermissions?: string[];
  workflow?: string[];
  verificationRules?: string[];
  securityPermissions?: string[];
  priceCents?: number;
  categoryId?: string | null;
  projectId?: string | null;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

function computeChecksum(input: {
  name: string;
  specialization: string;
  instructions: string;
  capabilities: string[];
  tools: string[];
  workflow: string[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export interface FactoryResult {
  agentId: string;
  slug: string;
  version: string;
  status: string;
  marketplaceStatus: string;
}

export interface SecurityFinding {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  recommendation: string;
}

function securityReviewOf(agent: {
  systemInstructions: string;
  securityPermissions: string[];
  toolPermissions: string[];
}): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lower = agent.systemInstructions.toLowerCase();
  if (/skip.*(instruction|system)|ignore.*prior|jailbreak|system prompt/i.test(lower)) {
    findings.push({
      severity: 'high',
      title: 'Prompt injection / instruction override',
      detail: 'System instructions contain language that encourages overriding guardrails.',
      recommendation: 'Remove any instruction that tells the model to ignore its operators or system prompt.',
    });
  }
  if (/api[_-]?key|secret|password|token|bearer/i.test(agent.systemInstructions)) {
    findings.push({
      severity: 'high',
      title: 'Secret reference in system instructions',
      detail: 'Instructions reference secret-like values without a safe handling rule.',
      recommendation: 'Never place credentials in instructions; use environment-variable references only.',
    });
  }
  const risky = agent.toolPermissions.filter((tool) =>
    /shell|exec|sudo|delete|drop|rm -rf|credential|payment/i.test(tool),
  );
  if (risky.length > 0) {
    findings.push({
      severity: 'medium',
      title: 'Risky tool permission matrix',
      detail: `Agent may access risky tools: ${risky.join(', ')}.`,
      recommendation: 'Restrict to the minimum scope needed and require workspace isolation.',
    });
  }
  if (agent.securityPermissions.length === 0) {
    findings.push({
      severity: 'low',
      title: 'No explicit security permissions',
      detail: 'The agent has not declared security permissions.',
      recommendation: 'Declare read-only file, network and data policies explicitly.',
    });
  }
  findings.push({
    severity: 'info',
    title: 'Baseline check completed',
    detail: 'Configuration was checked against injection, secret and permission-safety rules.',
    recommendation: 'Review findings before publishing.',
  });
  return findings;
}

function benchmarkAgent(agent: {
  systemInstructions: string;
  capabilities: string[];
  workflow: string[];
  verificationRules: string[];
}): { score: number; grade: string; dimensions: Record<string, number> } {
  const dims = {
    specialization: Math.min(100, Math.round((agent.systemInstructions.length / 400) * 100)),
    capabilities: Math.min(100, agent.capabilities.length * 20),
    workflow: Math.min(100, agent.workflow.length * 25),
    verification: Math.min(100, agent.verificationRules.length * 34),
    safety: /verify|source|evidence|never fabricate|no fake/i.test(agent.systemInstructions) ? 100 : 40,
  };
  const score = Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / Object.keys(dims).length);
  return {
    score,
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
    dimensions: dims,
  };
}

function toDefinition(agent: {
  specialization: string;
  systemInstructions: string;
  capabilities: string[];
  workflow: string[];
  verificationRules: string[];
  securityPermissions: string[];
  costUsage: unknown;
  fallbackStrategy: string;
  evaluationConfig: unknown;
}): Record<string, unknown> {
  return {
    specialization: agent.specialization,
    systemInstructions: agent.systemInstructions,
    capabilities: agent.capabilities,
    workflow: agent.workflow,
    verificationRules: agent.verificationRules,
    securityPermissions: agent.securityPermissions,
    costUsage: agent.costUsage,
    fallbackStrategy: agent.fallbackStrategy,
    evaluationConfig: agent.evaluationConfig,
  };
}

function toConfig(input: CustomAgentInput): Record<string, unknown> {
  return {
    specialization: input.specialization,
    capabilities: input.capabilities ?? [],
    inputs: input.inputs ?? [],
    outputs: input.outputs ?? [],
    modelRequirements: input.modelRequirements ?? ['reasoning'],
    toolPermissions: input.toolPermissions ?? [],
    workflow: input.workflow ?? [],
    verificationRules: input.verificationRules ?? [],
    securityPermissions: input.securityPermissions ?? [],
    systemInstructions: input.systemInstructions,
  };
}

function bumpVersion(version: string): string {
  const parts = version.split('.').map((part) => Number(part) || 0);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

function hasOwner(agent: { owner_id?: string | null }, userId: string): boolean {
  // Built-in/system agents are never owned by a regular user, so mutating or
  // versioning them is intentionally forbidden.
  return Boolean(agent.owner_id) && String(agent.owner_id) === userId;
}

export class AgentFactory {
  create(input: CustomAgentInput): FactoryResult {
    if (!input.name.trim() || !input.specialization.trim() || !input.systemInstructions.trim()) {
      throw new Error('name, specialization and system_instructions are required');
    }
    const slug = input.slug ? slugify(input.slug) : `${slugify(input.specialization)}-${createId('agt').slice(-6)}`;
    if (findAgentBySlug(slug)) {
      throw new Error(`agent slug "${slug}" already exists`);
    }
    const agent = createAgent({
      name: input.name,
      slug,
      description: input.description,
      ownerId: input.userId,
      categoryId: input.categoryId ?? null,
      projectId: input.projectId ?? null,
      version: '1.0.0',
      status: 'active',
      config: toConfig(input),
    });

    const definition = {
      specialization: input.specialization,
      systemInstructions: input.systemInstructions,
      capabilities: input.capabilities ?? [],
      inputs: input.inputs ?? [],
      outputs: input.outputs ?? [],
      modelRequirements: input.modelRequirements ?? ['reasoning'],
      toolPermissions: input.toolPermissions ?? [],
      workflow: input.workflow ?? [],
      verificationRules: input.verificationRules ?? [],
      securityPermissions: input.securityPermissions ?? [],
      priceCents: input.priceCents ?? 0,
      costUsage: { estimatedTokens: 3500, estimatedCents: 2, priority: 'medium' },
      fallbackStrategy: 'If primary model unavailable, reroute to default balanced model.',
      evaluationConfig: { metrics: ['accuracy', 'verification', 'completeness'], rubric: input.verificationRules ?? [], testCases: [] },
    };
    insertAgentVersion({
      agentId: agent.id,
      version: '1.0.0',
      definition,
      checksum: computeChecksum({
        name: input.name,
        specialization: input.specialization,
        instructions: input.systemInstructions,
        capabilities: input.capabilities ?? [],
        tools: input.toolPermissions ?? [],
        workflow: input.workflow ?? [],
      }),
      status: 'active',
      createdBy: input.userId,
      changelog: 'initial custom agent',
    });
    for (const toolKey of input.toolPermissions ?? []) {
      linkAgentTool({ agentId: agent.id, toolKey, permission: 'read' });
    }
    const paid = (input.priceCents ?? 0) > 0;
    upsertAgentMarketplace({
      agentId: agent.id,
      publisherUserId: input.userId,
      priceCents: input.priceCents ?? 0,
      status: paid ? 'pending_review' : 'draft',
      tags: input.capabilities ?? [],
    });
    return {
      agentId: agent.id,
      slug,
      version: '1.0.0',
      status: 'active',
      marketplaceStatus: paid ? 'pending_review' : 'draft',
    };
  }

  async test(input: { userId: string; slug: string; goal: string }): Promise<{ taskId: string; executionId: string; result: { status: string; output: Record<string, unknown> | null; error?: string } }> {
    const agent = findAgentBySlug(input.slug);
    if (!agent) {
      throw new Error(`agent ${input.slug} not found`);
    }
    const task = createTask({
      userId: input.userId,
      title: `Factory test: ${input.goal}`,
      description: `Factory test for ${input.slug}`,
      type: 'test',
      agentId: agent.id,
      inputData: { goal: input.goal, factoryTest: true },
    });
    const execution = createAgentExecution({
      agentId: agent.id,
      taskId: task.id,
      inputData: { goal: input.goal, factoryTest: true },
    });
    appendTaskEvent({
      taskId: task.id,
      executionId: execution.id,
      message: `Factory test started for ${input.slug}`,
      level: 'info',
      type: 'status',
    });
    const result = await dispatchAgentExecution(execution.id, input.slug);
    if (result.status !== 'completed') {
      updateTaskStatus({ id: task.id, status: 'failed', completedAt: new Date().toISOString(), errorMessage: result.error ?? 'test failed' });
    }
    return { taskId: task.id, executionId: execution.id, result };
  }

  securityReview(slug: string): SecurityFinding[] {
    const agent = getAgentBySlug(slug);
    if (!agent) {
      throw new Error(`agent ${slug} not found`);
    }
    return securityReviewOf({ systemInstructions: agent.systemInstructions, securityPermissions: agent.securityPermissions, toolPermissions: agent.toolPermissions });
  }

  benchmark(slug: string): ReturnType<typeof benchmarkAgent> {
    const agent = getAgentBySlug(slug);
    if (!agent) {
      throw new Error(`agent ${slug} not found`);
    }
    return benchmarkAgent({ systemInstructions: agent.systemInstructions, capabilities: agent.capabilities, workflow: agent.workflow, verificationRules: agent.verificationRules });
  }

  version(input: { userId: string; slug: string; changelog?: string }): FactoryResult {
    const agent = findAgentBySlug(input.slug);
    if (!agent) {
      throw new Error(`agent ${input.slug} not found`);
    }
    if (!hasOwner(agent, input.userId)) {
      throw new Error('only the owner can version this agent');
    }
    const current = getAgentBySlug(input.slug);
    if (!current) {
      throw new Error(`agent ${input.slug} not found`);
    }
    const nextVersion = bumpVersion(String(agent.version ?? '1.0.0'));
    insertAgentVersion({
      agentId: agent.id,
      version: nextVersion,
      definition: toDefinition(current),
      checksum: computeChecksum({
        name: String(agent.name ?? ''),
        specialization: current.specialization,
        instructions: current.systemInstructions,
        capabilities: current.capabilities,
        tools: current.toolPermissions,
        workflow: current.workflow,
      }),
      status: 'active',
      createdBy: input.userId,
      changelog: input.changelog ?? 'new version',
    });
    db.run('UPDATE agents SET version = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [nextVersion, agent.id]);
    return { agentId: String(agent.id), slug: input.slug, version: nextVersion, status: String(current.status), marketplaceStatus: 'published' };
  }

  update(input: { userId: string; slug: string; config: Partial<CustomAgentInput> }): FactoryResult {
    const agent = findAgentBySlug(input.slug);
    if (!agent) {
      throw new Error(`agent ${input.slug} not found`);
    }
    if (!hasOwner(agent, input.userId)) {
      throw new Error('only the owner can update this agent');
    }
    const current = getAgentBySlug(input.slug);
    if (!current) {
      throw new Error(`agent ${input.slug} not found`);
    }
    const merged: CustomAgentInput = {
      userId: input.userId,
      name: input.config.name ?? String(agent.name ?? ''),
      slug: input.slug,
      specialization: input.config.specialization ?? current.specialization,
      description: input.config.description ?? String(agent.description ?? ''),
      systemInstructions: input.config.systemInstructions ?? current.systemInstructions,
      capabilities: input.config.capabilities ?? current.capabilities,
      inputs: input.config.inputs ?? current.inputs,
      outputs: input.config.outputs ?? current.outputs,
      modelRequirements: input.config.modelRequirements ?? current.modelRequirements,
      toolPermissions: input.config.toolPermissions ?? current.toolPermissions,
      workflow: input.config.workflow ?? current.workflow,
      verificationRules: input.config.verificationRules ?? current.verificationRules,
      securityPermissions: input.config.securityPermissions ?? current.securityPermissions,
    };
    updateAgentConfig(String(agent.id), toConfig(merged));
    db.run('UPDATE agents SET name = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [merged.name, agent.id]);
    return { agentId: String(agent.id), slug: input.slug, version: String(current.version), status: String(current.status), marketplaceStatus: 'updated' };
  }

  setStatus(input: { userId: string; slug: string; status: string }): FactoryResult {
    const agent = findAgentBySlug(input.slug);
    if (!agent) {
      throw new Error(`agent ${input.slug} not found`);
    }
    if (!['active', 'disabled', 'deprecated'].includes(input.status)) {
      throw new Error('invalid status');
    }
    if (!hasOwner(agent, input.userId)) {
      throw new Error('only the owner can change status');
    }
    updateAgentStatus(String(agent.id), input.status);
    return { agentId: String(agent.id), slug: input.slug, version: String(agent.version ?? ''), status: input.status, marketplaceStatus: 'published' };
  }

  rollback(input: { userId: string; slug: string; version: string }): FactoryResult {
    const agent = findAgentBySlug(input.slug);
    if (!agent) {
      throw new Error(`agent ${input.slug} not found`);
    }
    const target = listAgentVersions(String(agent.id)).find((row) => String(row.version) === input.version);
    if (!target) {
      throw new Error(`version ${input.version} not found`);
    }
    const definition = JSON.parse(String(target.definition ?? '{}')) as Record<string, unknown>;
    db.run('UPDATE agents SET version = ?, config = ?, status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [
      input.version,
      JSON.stringify(definition),
      String(target.status ?? 'active'),
      agent.id,
    ]);
    return { agentId: String(agent.id), slug: input.slug, version: input.version, status: String(target.status ?? 'active'), marketplaceStatus: 'rolled_back' };
  }

  listVersions(slug: string): Array<Record<string, unknown>> {
    const agent = findAgentBySlug(slug);
    if (!agent) {
      throw new Error(`agent ${slug} not found`);
    }
    return listAgentVersions(String(agent.id));
  }

  audit(_userId: string): ReturnType<typeof listAuditLogs> {
    return listAuditLogs(200);
  }
}

export const agentFactory = new AgentFactory();
