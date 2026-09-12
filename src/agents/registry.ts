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
  /**
   * When set, the result excludes agents that are private to another user
   * (custom agents that are not published). Built-ins and published marketplace
   * agents remain visible.
   */
  userId?: string;
  /**
   * Restrict to platform registry agents (owner_id IS NULL) — used by the
   * public catalog endpoint, which must never expose user-created agents.
   */
  platformOnly?: boolean;
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
      currency: 'USD',
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
    // Match ANY query term (OR) so multi-term queries are not treated as one
    // contiguous phrase; relevance ranking below orders the pool so agents
    // matching more (and more specific) terms surface first.
    const terms = searchTerms(filter.query);
    const termPattern = terms.length > 0 ? terms : [filter.query.toLowerCase()];
    const columns = ['a.name', 'a.slug', 'a.description', 'c.name'];
    const likes: string[] = [];
    for (const term of termPattern) {
      for (const column of columns) {
        likes.push(`${column} LIKE ?`);
        params.push(`%${term}%`);
      }
    }
    if (likes.length > 0) {
      where.push(`(${likes.join(' OR ')})`);
    }
  }
  if (filter.platformOnly) {
    where.push('a.owner_id IS NULL');
  }
  if (filter.userId) {
    where.push(
      '(a.owner_id IS NULL OR a.owner_id = ? OR EXISTS (SELECT 1 FROM agent_marketplace m WHERE m.agent_id = a.id AND m.status = \'published\'))',
    );
    params.push(filter.userId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id ${whereSql}`,
    params,
  )?.count ?? 0;

  // Ranked search: when a text query is present, rank the LIKE-match pool by
  // real relevance (specialization/role matches beat description mentions)
  // instead of returning alphabetical order. Without a query the listing
  // stays a stable alphabetical browse.
  if (filter.query) {
    const pool = db.all(
      `SELECT a.*, c.name AS category_name, c.slug AS category_slug
       FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id
       ${whereSql}
       ORDER BY a.name ASC LIMIT ?`,
      [...params, SEARCH_RANK_POOL],
    ) as Array<Record<string, unknown>>;
    const ranked = pool
      .map((row) => ({ row, score: searchRelevance(toAgentView(row), filter.query!) }))
      .sort((a, b) => b.score - a.score || String(a.row.name).localeCompare(String(b.row.name)))
      .slice(offset, offset + limit)
      .map((entry) => entry.row);
    return { agents: ranked.map((row) => toAgentView(row)), total };
  }

  const rows = db.all(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug
     FROM agents a LEFT JOIN agent_categories c ON c.id = a.category_id
     ${whereSql}
     ORDER BY a.name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ) as Array<Record<string, unknown>>;

  return { agents: rows.map((row) => toAgentView(row)), total };
}

/** Candidate pool size for ranked search (matches above this are cut). */
const SEARCH_RANK_POOL = 500;

const SEARCH_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'best', 'ai', 'agent', 'agents']);

function searchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((word) => word.length >= 2 && !SEARCH_STOPWORDS.has(word)))];
}

/**
 * Relevance score of an agent for a search query. Weighted by where terms
 * match: exact slug segments and names rank highest, then specialization,
 * category, capabilities, and finally loose substring mentions.
 */
export function searchRelevance(agent: AgentView, query: string): number {
  const terms = searchTerms(query);
  if (terms.length === 0) {
    return 0;
  }
  const squish = (text: string): string => text.replace(/[-\s]/g, '');
  const lower = {
    slug: agent.slug.toLowerCase(),
    name: agent.name.toLowerCase(),
    specialization: agent.specialization.toLowerCase(),
    category: `${agent.category} ${agent.categorySlug}`.toLowerCase().replace(/-/g, ' '),
    capabilities: agent.capabilities.join(' ').toLowerCase(),
    outputs: agent.outputs.join(' ').toLowerCase(),
    description: agent.description.toLowerCase(),
  };
  const squished = {
    slug: squish(lower.slug),
    category: squish(lower.category),
    specialization: squish(lower.specialization),
  };
  let score = 0;
  for (const term of terms) {
    if (lower.slug.split('-').includes(term) || (term.length >= 4 && squished.slug.startsWith(`${term}-`))) {
      score += 8;
    } else if (lower.slug.includes(term) || (term.length >= 4 && squished.slug.includes(term))) {
      score += 3;
    }
    if (lower.name.includes(term)) {
      score += 6;
    }
    if (lower.specialization.includes(term) || (term.length >= 4 && squished.specialization.includes(term))) {
      score += 5;
    }
    if (lower.category.includes(term) || (term.length >= 4 && squished.category.includes(term))) {
      score += 4;
    }
    if (lower.capabilities.includes(term) || lower.outputs.includes(term)) {
      score += 2;
    } else if (lower.description.includes(term)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Agent visibility rule used by all public APIs.
 *
 * Built-in/system agents and published marketplace agents are public. A custom
 * agent that is not published is private to its owner. This is what prevents a
 * user from reading, installing, saving or executing another user's unpublished
 * agent by guessing a slug.
 */
export function isAgentVisibleToUser(agent: AgentView, userId: string): boolean {
  if (!agent.ownerId || agent.ownerId === userId) {
    return true;
  }
  const published = db.get<{ id: string }>(
    "SELECT id FROM agent_marketplace WHERE agent_id = ? AND status = 'published'",
    [agent.id],
  );
  return Boolean(published);
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
