import { findUserById } from '../db';

/**
 * Unlimited-execution entitlement.
 *
 * The designated platform owner and staff super_admins have UNLIMITED
 * legitimate platform usage: their executions must never be blocked by an
 * exhausted free-trial balance and never consume task credits.
 *
 * This lives in ONE server-side helper because the entitlement has to be
 * applied consistently at every place that inspects the credit balance:
 *
 *   - `reserveTaskCreditForUser` (the single reservation point) skips
 *     consumption and writes an audit row instead.
 *   - The pre-flight checks in the orchestrator (`createResearchTask`,
 *     `createAgentTask`) must NOT short-circuit with `requires_pro` before
 *     that reservation point is reached — otherwise a zero-balance owner is
 *     refused even though executing them costs nothing.
 *   - The automation scheduler must not auto-pause an owner's automations
 *     for "no task credits remaining".
 *
 * Normal users keep the exact free-trial / paid-credit accounting: consume
 * on success, refund on failure, `requires_pro` when nothing is left.
 */

export const UNLIMITED_EXECUTION_ROLES: readonly string[] = ['owner', 'super_admin'];

/** Role of a user id, defaulting to the least-privileged role. */
export function roleOfUser(userId: string): string {
  const user = findUserById(userId);
  return String((user as { role?: string } | undefined)?.role ?? 'user');
}

/** True when the account may execute tasks without consuming task credits. */
export function hasUnlimitedTaskCredits(userId: string): boolean {
  return UNLIMITED_EXECUTION_ROLES.includes(roleOfUser(userId));
}
