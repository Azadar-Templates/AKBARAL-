import { missionDb, missionId, nowIso, type Row } from './database';
import type { OpportunityRow } from './opportunity-catalog';

/**
 * Match opportunities to 4,001+ agents based on skills, eligibility, cost, permitted automation
 * - Preserves $1B/day per-agent objective — matching is suggestive, revenue only counted when verified received
 * - Never fabricates earnings
 * - Supports millions: pagination, indexed queries, never loads all agents or opportunities into memory
 */

export interface AgentForMatching {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  capabilities: string[]; // parsed from JSON
  status: string;
}

function parseCapabilities(row: Row): string[] {
  try {
    const raw = row.capabilities ? String(row.capabilities) : '[]';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((s: any) => String(s).toLowerCase());
    return [];
  } catch {
    return [];
  }
}

export function listAgentsForMatching(limit = 100, offset = 0): { total: number; agents: AgentForMatching[] } {
  const totalRow = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_agents WHERE status = ?', ['active']);
  const rows = missionDb.all<Row>('SELECT id, slug, name, category, capabilities, status FROM mission_agents WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', ['active', limit, offset]);
  return {
    total: Number(totalRow?.count ?? 0),
    agents: rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      category: r.category ? String(r.category) : null,
      capabilities: parseCapabilities(r),
      status: String(r.status),
    })),
  };
}

export function computeMatchScore(agent: AgentForMatching, opportunity: OpportunityRow): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Skills matching (up to 50 points)
  let oppSkills: string[] = [];
  try {
    oppSkills = JSON.parse(opportunity.skills).map((s: string) => String(s).toLowerCase());
  } catch {}
  const agentCaps = agent.capabilities.map((c) => c.toLowerCase());
  const matchingSkills = oppSkills.filter((skill) => agentCaps.some((cap) => cap.includes(skill) || skill.includes(cap) || cap === skill));
  if (matchingSkills.length > 0) {
    score += Math.min(50, matchingSkills.length * 15);
    reasons.push(...matchingSkills.slice(0, 5).map((s) => `skill:${s}`));
  } else if (agentCaps.includes('general') || oppSkills.includes('general')) {
    score += 10;
    reasons.push('skill:general');
  }

  // Category matching (up to 20 points)
  const agentCat = (agent.category ?? '').toLowerCase();
  const oppCat = opportunity.category.toLowerCase();
  if (agentCat && oppCat && (agentCat === oppCat || oppCat.includes(agentCat) || agentCat.includes(oppCat))) {
    score += 20;
    reasons.push(`category:${oppCat}`);
  }

  // Automation permission (up to 15 points) — agents can only do allowed automation
  if (opportunity.automation_permission === 'allowed') {
    score += 15;
    reasons.push('automation:allowed');
  } else if (opportunity.automation_permission === 'conditional') {
    score += 8;
    reasons.push('automation:conditional');
  } else {
    // disallowed — still possible but manual
    score += 2;
    reasons.push('automation:manual');
  }

  // Risk level (up to 10 points) — prefer low risk
  if (opportunity.risk_level === 'low') {
    score += 10;
    reasons.push('risk:low');
  } else if (opportunity.risk_level === 'medium') {
    score += 5;
    reasons.push('risk:medium');
  }

  // Verified status bonus (5 points)
  if (opportunity.status === 'verified') {
    score += 5;
    reasons.push('status:verified');
  }

  // Country eligibility — assume global for now, but check if agent has country hint in capabilities
  let countries: string[] = [];
  try {
    countries = JSON.parse(opportunity.country_eligibility);
  } catch {}
  if (countries.includes('global') || countries.includes('GLOBAL') || countries.length === 0) {
    score += 5;
    reasons.push('country:global');
  }

  return { score: Math.min(100, score), reasons };
}

export function matchOpportunitiesToAgent(agentId: string, filters?: { category?: string; status?: string; limit?: number }): { total: number; matches: Array<{ opportunity: OpportunityRow; score: number; reasons: string[] }> } {
  const limit = Math.min(500, Math.max(1, filters?.limit ?? 50));
  const agentRow = missionDb.get<Row>('SELECT id, slug, name, category, capabilities, status FROM mission_agents WHERE id = ?', [agentId]);
  if (!agentRow) throw new Error('agent not found');
  const agent: AgentForMatching = {
    id: String(agentRow.id),
    slug: String(agentRow.slug),
    name: String(agentRow.name),
    category: agentRow.category ? String(agentRow.category) : null,
    capabilities: parseCapabilities(agentRow),
    status: String(agentRow.status),
  };

  // Fetch opportunities with pagination, not loading all
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters?.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.status) {
    where.push('status = ?');
    params.push(filters.status);
  } else {
    where.push("status IN ('verified','pending_review')");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // For scalability, we fetch a larger pool then score in memory, but never all 100M at once
  // In production, this would be a background job with batching
  const poolSize = Math.min(1000, limit * 10);
  const oppRows = missionDb.all<OpportunityRow>(`SELECT * FROM mission_opportunities ${whereSql} ORDER BY last_verified_at DESC, created_at DESC LIMIT ?`, [...params, poolSize] as any);

  const scored = oppRows.map((opp) => {
    const { score, reasons } = computeMatchScore(agent, opp);
    return { opportunity: opp, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  return { total: oppRows.length, matches: top };
}

export function matchAgentsToOpportunity(opportunityId: string, limit = 50): { totalAgents: number; matches: Array<{ agent: AgentForMatching; score: number; reasons: string[] }> } {
  const opp = missionDb.get<OpportunityRow>('SELECT * FROM mission_opportunities WHERE id = ?', [opportunityId]);
  if (!opp) throw new Error('opportunity not found');

  const totalAgentsRow = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_agents WHERE status = ?', ['active']);
  const totalAgents = Number(totalAgentsRow?.count ?? 0);

  // For 4001+ agents, we paginate through agents in batches, scoring without loading all at once
  const batchSize = 500;
  let offset = 0;
  const allMatches: Array<{ agent: AgentForMatching; score: number; reasons: string[] }> = [];

  while (offset < totalAgents && allMatches.length < limit * 5) {
    const { agents } = listAgentsForMatching(batchSize, offset);
    if (agents.length === 0) break;
    for (const agent of agents) {
      const { score, reasons } = computeMatchScore(agent, opp);
      if (score >= 20) {
        allMatches.push({ agent, score, reasons });
      }
    }
    offset += batchSize;
    // For performance, stop after 2 batches in this synchronous version — background job would do full
    if (offset >= 1000) break;
  }

  allMatches.sort((a, b) => b.score - a.score);
  return { totalAgents, matches: allMatches.slice(0, limit) };
}

export function createMatch(input: { opportunity_id: string; agent_id: string; score: number; reasons: string[]; status?: string }): Row {
  const id = missionId('mat');
  const now = nowIso();
  missionDb.run(
    `INSERT INTO mission_opportunity_matches (id, opportunity_id, agent_id, score, matched_on, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(opportunity_id, agent_id) DO UPDATE SET score = excluded.score, matched_on = excluded.matched_on, updated_at = excluded.updated_at`,
    [id, input.opportunity_id, input.agent_id, Math.max(0, Math.min(100, input.score)), JSON.stringify(input.reasons), input.status ?? 'suggested', now, now],
  );
  return missionDb.get<Row>('SELECT * FROM mission_opportunity_matches WHERE opportunity_id = ? AND agent_id = ?', [input.opportunity_id, input.agent_id])!;
}

export function listMatchesForAgent(agentId: string, limit = 50, offset = 0): { total: number; matches: Row[] } {
  const totalRow = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_opportunity_matches WHERE agent_id = ?', [agentId]);
  const rows = missionDb.all<Row>('SELECT * FROM mission_opportunity_matches WHERE agent_id = ? ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?', [agentId, limit, offset]);
  return { total: Number(totalRow?.count ?? 0), matches: rows };
}

export function listMatchesForOpportunity(opportunityId: string, limit = 50, offset = 0): { total: number; matches: Row[] } {
  const totalRow = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_opportunity_matches WHERE opportunity_id = ?', [opportunityId]);
  const rows = missionDb.all<Row>('SELECT * FROM mission_opportunity_matches WHERE opportunity_id = ? ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?', [opportunityId, limit, offset]);
  return { total: Number(totalRow?.count ?? 0), matches: rows };
}

// Batch matching job — processes opportunities in batches, never loads all 100M
export function batchMatchOpportunities(options?: { opportunityLimit?: number; agentBatchSize?: number }): { processed: number; matchesCreated: number } {
  const oppLimit = Math.min(1000, options?.opportunityLimit ?? 100);
  const agentBatch = Math.min(500, options?.agentBatchSize ?? 100);

  const opportunities = missionDb.all<OpportunityRow>(`SELECT * FROM mission_opportunities WHERE status IN ('verified','pending_review') ORDER BY created_at DESC LIMIT ?`, [oppLimit]);

  let matchesCreated = 0;
  let processed = 0;

  for (const opp of opportunities) {
    const { matches } = matchAgentsToOpportunity(opp.id, agentBatch);
    for (const m of matches.slice(0, 10)) {
      // only top 10 per opportunity to avoid explosion
      if (m.score >= 40) {
        createMatch({ opportunity_id: opp.id, agent_id: m.agent.id, score: m.score, reasons: m.reasons });
        matchesCreated += 1;
      }
    }
    processed += 1;
  }

  return { processed, matchesCreated };
}
