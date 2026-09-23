import { missionDb } from './database';
/** A provider charge cannot be reused across provisioning, usage and renewal.
 * Usage-only request references are deliberately not financial receipts. */
export function providerChargeRecorded(provider: string, reference: string): boolean {
  return Boolean(
    missionDb.get('SELECT id FROM mission_resources WHERE provider = ? AND provisioning_ref = ?', [provider, reference]) ||
    missionDb.get('SELECT id FROM mission_resource_periods WHERE provider = ? AND provider_ref = ?', [provider, reference]) ||
    missionDb.get('SELECT b.call_id FROM mission_resource_call_budgets b JOIN mission_resource_calls c ON c.id = b.call_id JOIN mission_resources r ON r.id = c.resource_id WHERE r.provider = ? AND b.provider_ref = ?', [provider, reference]),
  );
}
