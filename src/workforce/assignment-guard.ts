import { db } from '../db/database';

/** Catalog discovery is not enrollment. Earning work needs the live 1:1 binding. */
export function assertOpportunityAssignment(opportunity: { platform_key?: string | null }, agentSlug: string): string | null {
  if (!opportunity.platform_key) return null;
  const binding = db.get<{ id: string; agent_slug: string; status: string; dedicated_account_property_id: string | null; platform_status: string }>(
    `SELECT a.id, a.agent_slug, a.status, a.dedicated_account_property_id, p.status AS platform_status
     FROM economy_opportunity_assignments a JOIN economy_platforms p ON p.platform_key = a.platform_key
     WHERE a.platform_key = ?`, [opportunity.platform_key],
  );
  if (!binding || binding.agent_slug !== agentSlug) throw new Error('platform work is not assigned to this agent; no generic fallback is permitted');
  if (binding.status !== 'active' || !binding.dedicated_account_property_id?.trim()) throw new Error('platform assignment is inactive or its dedicated account/property is missing');
  if (binding.platform_status !== 'verified') throw new Error('platform is not verified; catalog candidates are not executable earning work');
  return JSON.stringify({ assignmentId: binding.id, platformKey: opportunity.platform_key, agentSlug, accountPropertyId: binding.dedicated_account_property_id });
}
