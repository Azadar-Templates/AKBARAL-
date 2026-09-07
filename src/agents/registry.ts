import { createHash } from 'node:crypto';
import {
  db,
  upsertAgentCategory,
  upsertAgent,
  insertAgentVersion,
  getLatestAgentVersion,
  linkAgentTool,
  upsertAgentMarketplace,
  listAgentTools,
} from '../db';
import {
  generateAgentDefinitions,
  AGENT_CATEGORIES,
  agentDefinitionCount,
} from './catalog';
import { syncModelCatalog } from '../models';

export interface AgentView {
  id: string;
  name: string;
  slug: string;
  ownerId: string | null;
  specialization: string;
  description: string;
  category: string;
  categorySlug: string;
  version: string;
  status: string;
  systemInstructions: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  modelRequirements: string[];
  toolPermissions: string[];
  apiRequirements: string[];
  workflow: string[];
  verificationRules: string[];
  securityPermissions: string[];
  costUsage: { estimatedTokens: number; estimatedCents: number; priority: string };
  fallbackStrategy: string;
  evaluationConfig: { metrics: string[]; rubric: string; testCases: string[] };
  tools: Array<Record<string, unknown>>;
}

export interface AgentSearchFilter {
  query?: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Synchronizes the entire agent catalog (4,000+ genuine definitions) into the
 * database. Idempotent: existing rows are updated and versions are only added
 * when the definition checksum changes.
 */
export function syncAgentRegistry(): { created: number; updated: number; total: number } {
  syncModelCatalog();
  const categories = AGENT_CATEGORIES.map((category) => upsertAgentCategory(category));

  const categoryBySlug = new Map(
    categories.map((category) => {
      const row = db.get<{ slug: string; id: string }>('SELECT slug, id FROM agent_categories WHERE id = ?', [category.id]);
      return [row?.slug ?? '', row?.id ?? ''] as const;
    }),
  );

  let created = 0;
  let updated = 0;

  for (const definition of generateAgentDefinitions()) {
    const categoryId = categoryBySlug.get(definition.categorySlug) ?? null;
    const agent = upsertAgent({
      name: definition.name,
      slug: definition.slug,
      description: definition.specialization,
      version: '1.0.0',
      categoryId,
      status: 'active',
      config: definition as unknown as Record<string, unknown>,
    });

    const checksum = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
    const latest = getLatestAgentVersion(agent.id);
    const latestChecksum = latest ? (latest.checksum as string) : null;
    if (latestChecksum !== checksum) {
      insertAgentVersion({
        agentId: agent.id,
        version: '1.0.0',
        definition,
        checksum,
        status: 'active',
        changelog: 'initial registered definition',
      });
      created += 1;
    }

    for (const toolKey of definition.toolPermissions) {
      linkAgentTool({ agentId: agent.id, toolKey, permission: 'read' });
    }
    upsertAgentMarketplace({
      agentId: agent.id,
      priceCents: definition.costUsage.estimatedCents <= 1 ? 0 : 100 * definition.costUsage.estimatedCents,
      currency: 'PKR',
      status: 'published',
      tags: definition.capabilities,
    });
  }

  return { created, updated, total: agentDefinitionCount() };
}

export function countAgentRegistry(): number {
  return db.get<{ count: number }>('SELECT COUNT(*) AS count FROM agents')?.count ?? 0;
}

export function discoverAgents(filter: AgentSearchFilter = {}): { agents: AgentView[]; total: number } {
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filter.status) {
    where.push('a.status = ?');
    params.push(filter.status);
  }
  if (filter.category) {
    where.push('c.slug = ?');
    params.push(filter.category);
  }
  if (filter.query) {
    where.push('(a.name LIKE ? OR a.slug LIKE ? OR a.description LIKE ? OR c.name LIKE ?)');
    params.push(`%${filter.query}%`, `%${filter.query}%`, `%${filter.query}%`, `%${filter.query}%`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.all(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug
     FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id
     ${whereSql}
     ORDER BY a.name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ) as Array<Record<string, unknown>>;
  const total = db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id ${whereSql}`,
    params,
  )?.count ?? 0;

  return { agents: rows.map((row) => toAgentView(row)), total };
}

export function getAgentBySlug(slug: string): AgentView | undefined {
  const row = db.get(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug
     FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id
     WHERE a.slug = ?`,
    [slug],
  ) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }
  const agent = row.id ? { id: row.id } : undefined;
  return {
    ...toAgentView(row),
    tools: agent ? listAgentTools(String(agent.id)) : [],
  };
}

export function listCategories(): Array<{ slug: string; name: string; description: string; icon: string; count: number }> {
  const rows = db.all(
    `SELECT c.slug, c.name, c.description, c.icon, COUNT(a.id) AS count
     FROM agent_categories c LEFT JOIN agents a ON a.category_id = c.id
     GROUP BY c.id ORDER BY c.name ASC`,
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ''),
    icon: String(row.icon ?? 'bot'),
    count: Number(row.count ?? 0),
  }));
}

function toAgentView(row: Record<string, unknown>): AgentView {
  const config = parseConfig(row.config as string | null);
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    specialization: String(row.description ?? ''),
    description: String(row.description ?? ''),
    category: String(row.category_name ?? ''),
    categorySlug: String(row.category_slug ?? ''),
    version: String(row.version ?? '1.0.0'),
    status: String(row.status ?? 'active'),
    systemInstructions: String(config.systemInstructions ?? ''),
    capabilities: asStringArray(config.capabilities),
    inputs: asStringArray(config.inputs),
    outputs: asStringArray(config.outputs),
    modelRequirements: asStringArray(config.modelRequirements),
    toolPermissions: asStringArray(config.toolPermissions),
    apiRequirements: asStringArray(config.apiRequirements),
    workflow: asStringArray(config.workflow),
    verificationRules: asStringArray(config.verificationRules),
    securityPermissions: asStringArray(config.securityPermissions),
    costUsage: parseCostUsage(config.costUsage),
    fallbackStrategy: String(config.fallbackStrategy ?? ''),
    evaluationConfig: parseEvalConfig(config.evaluationConfig),
    tools: [],
  };
}

function parseConfig(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function parseCostUsage(value: unknown): AgentView['costUsage'] {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    estimatedTokens: Number(record.estimatedTokens ?? 0),
    estimatedCents: Number(record.estimatedCents ?? 0),
    priority: String(record.priority ?? 'medium') as 'low' | 'medium' | 'high',
  };
}

function parseEvalConfig(value: unknown): AgentView['evaluationConfig'] {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    metrics: asStringArray(record.metrics),
    rubric: String(record.rubric ?? ''),
    testCases: asStringArray(record.testCases),
  };
}

export function registryIsSeeded(): boolean {
  const count = countAgentRegistry();
  return count >= agentDefinitionCount();
}
