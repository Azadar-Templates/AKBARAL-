/**
 * WORKFORCE SERVICE IDENTITY (D5).
 *
 * Workforce tool calls used to run with `userId: ''`, which made the
 * user-scoped tools (knowledge_search, file_parse_text) fail 100% of the
 * time. They now run as a dedicated service identity that owns NOTHING by
 * default: it can only see knowledge items and files the owner explicitly
 * stages for workforce use (workforce/staging.ts). No user data is reachable
 * unless the owner stages it, item by item.
 *
 * Zero imports by design: the tool registry depends on this module, so it
 * must never depend on anything that could cycle back to the tools.
 */
export const WORKFORCE_SERVICE_USER = 'workforce:service';

export function isWorkforceService(userId: string | null | undefined): boolean {
  return userId === WORKFORCE_SERVICE_USER;
}
