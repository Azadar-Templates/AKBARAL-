// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — agent catalog identity
//
// The mission database stores an agent's *operational* state (slug, name,
// category, capabilities, status, work, wallet). What it never stored is the
// agent's *designed* identity: what this specific specialist exists to do, the
// workflow it follows, the inputs it expects, the outputs it produces, the
// verification rules it is held to and the tools its domain needs.
//
// That identity already exists, deterministically, in the AKBARAL! registry
// catalog: 80 domain blueprints × 50 specialist archetypes (+ the flagship web
// research agent) = 4,001 definitions, addressed by exactly the same slug the
// mission registry-sync imported. This module is the read-only lookup between
// the two, so the owner console can show "YouTube Content Author — produces
// polished, accurate content, verifies facts, respects asset rights" instead of
// a bare row, and so the chat briefing can tell the model what it is.
//
// Isolation: `src/agents/catalog.ts` is pure static source data with no imports,
// no database access and no customer state — the same read-only metadata export
// the mission already consumes through registry-sync. Nothing here reads, writes
// or reaches the AKBARAL! customer database.
// ─────────────────────────────────────────────────────────────────────────────

import { generateAgentDefinitions, type AgentDefinition } from '../agents/catalog';

export interface AgentCatalogIdentity {
  slug: string;
  /** Registry key shared by every agent of this domain+archetype pair. */
  key: string;
  name: string;
  categorySlug: string;
  /** "YouTube / Content Author" — domain and specialist archetype. */
  specialization: string;
  /** The domain half of the specialization ("YouTube"). */
  domain: string;
  /** The archetype half ("Content Author"). */
  archetype: string;
  /** One sentence: what this agent is designed to do. */
  purpose: string;
  /** The full system instructions the model is given for this identity. */
  systemInstructions: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  workflow: string[];
  verificationRules: string[];
  securityPermissions: string[];
  /** Tool keys this agent's domain is designed to use (still owner-gated). */
  toolPermissions: string[];
  modelRequirements: string[];
  apiRequirements: string[];
  costUsage: AgentDefinition['costUsage'];
  fallbackStrategy: string;
}

let catalogBySlug: Map<string, AgentCatalogIdentity> | null = null;

/** "You are the X within AKBARAL!..." → the role sentence, without the prefix. */
function purposeOf(definition: AgentDefinition): string {
  const role = definition.systemInstructions
    .split('\n')
    .find((line) => line.startsWith('Your role:'));
  const sentence = (role ?? '').replace(/^Your role:\s*/, '').replace(/\.+$/, '');
  return sentence || `${definition.specialization} specialist.`;
}

function build(): Map<string, AgentCatalogIdentity> {
  const map = new Map<string, AgentCatalogIdentity>();
  for (const definition of generateAgentDefinitions()) {
    const [domain, archetype] = definition.specialization.split(' / ');
    map.set(definition.slug, {
      slug: definition.slug,
      key: definition.key,
      name: definition.name,
      categorySlug: definition.categorySlug,
      specialization: definition.specialization,
      domain: domain ?? definition.categorySlug,
      archetype: archetype ?? '',
      purpose: purposeOf(definition),
      systemInstructions: definition.systemInstructions,
      capabilities: definition.capabilities,
      inputs: definition.inputs,
      outputs: definition.outputs,
      workflow: definition.workflow,
      verificationRules: definition.verificationRules,
      securityPermissions: definition.securityPermissions,
      toolPermissions: definition.toolPermissions,
      modelRequirements: definition.modelRequirements,
      apiRequirements: definition.apiRequirements,
      costUsage: definition.costUsage,
      fallbackStrategy: definition.fallbackStrategy,
    });
  }
  return map;
}

/** Cached: 4,001 deterministic definitions, built once per process. */
export function agentCatalogIndex(): Map<string, AgentCatalogIdentity> {
  if (!catalogBySlug) catalogBySlug = build();
  return catalogBySlug;
}

/** The designed identity for a mission agent slug, or null for a custom agent. */
export function agentCatalogIdentity(slug: string): AgentCatalogIdentity | null {
  return agentCatalogIndex().get(slug) ?? null;
}

/**
 * Search terms for an agent, so the fleet can be searched by what an agent IS
 * (role, archetype, purpose, capability, tool) and not only by its name.
 * Returned lowercase and de-duplicated; the caller decides how to match.
 */
export function agentSearchTerms(slug: string): string[] {
  const identity = agentCatalogIdentity(slug);
  if (!identity) return [];
  return [
    ...new Set(
      [
        identity.name,
        identity.slug,
        identity.key,
        identity.domain,
        identity.archetype,
        identity.purpose,
        ...identity.capabilities,
        ...identity.toolPermissions,
        ...identity.outputs,
      ]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter((term) => term.length > 1),
    ),
  ];
}

let haystacks: Array<{ slug: string; text: string }> | null = null;

/**
 * Slugs whose designed identity matches every whitespace-separated token in the
 * query. Matches role/archetype/purpose/capability/tool text that lives in the
 * catalog rather than in the mission row, so "seo engineer", "security review"
 * or "vision" find the right specialists. Bounded by `cap` so the caller can
 * embed the result in a SQL IN () list safely.
 */
export function matchCatalogSlugs(query: string, cap = 2000): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  if (!haystacks) {
    haystacks = [...agentCatalogIndex().values()].map((identity) => ({
      slug: identity.slug,
      text: [
        identity.name,
        identity.slug,
        identity.key,
        identity.domain,
        identity.archetype,
        identity.purpose,
        identity.capabilities.join(' '),
        identity.toolPermissions.join(' '),
        identity.outputs.join(' '),
        identity.inputs.join(' '),
      ]
        .join(' ')
        .toLowerCase(),
    }));
  }
  const matches: string[] = [];
  for (const entry of haystacks) {
    if (tokens.every((token) => entry.text.includes(token))) {
      matches.push(entry.slug);
      if (matches.length >= cap) break;
    }
  }
  return matches;
}

/** Compact identity for list rows: enough to tell two agents apart at a glance. */
export function agentCatalogSummary(slug: string): {
  specialization: string;
  purpose: string;
  archetype: string;
  domain: string;
  toolPermissions: string[];
} | null {
  const identity = agentCatalogIdentity(slug);
  if (!identity) return null;
  return {
    specialization: identity.specialization,
    purpose: identity.purpose,
    archetype: identity.archetype,
    domain: identity.domain,
    toolPermissions: identity.toolPermissions,
  };
}
