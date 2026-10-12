/**
 * The one PostgreSQL failure a boot-time seed must never be allowed to leave behind.
 *
 * On SQLite a failed statement can be caught and the transaction can keep going. On PostgreSQL it
 * cannot: the first error aborts the entire transaction, and every statement after it fails with
 * "current transaction is aborted, commands ignored until end of transaction block" until the
 * transaction ends. So any seed that catches its own error and continues does not merely skip — it
 * hands a broken session to whatever runs next.
 *
 * That is how a mission boot came to print a `[mission] boot seed skipped (…)` line and then hang
 * forever instead of failing: the health endpoint never answered, the wrapper waited out its budget,
 * and the container restarted. A hang at boot is the worst possible outcome of a non-fatal seed,
 * because it looks identical from outside to a database that is merely slow.
 *
 * This classifier is exported separately from `src/mission/server.ts` so it can be tested on its own
 * — the way it behaves decides whether a boot exits with a reason or sits there.
 */
const ABORTED_SESSION = /current transaction is aborted|commands ignored until end of transaction block|can't execute a statement in an aborted transaction/i;

export function isAbortedSessionError(message: string): boolean {
  return ABORTED_SESSION.test(String(message ?? ''));
}

/**
 * The advice that turns this class of failure from a mystery into a to-do item. Kept next to the
 * classifier so a log line and its remedy cannot drift apart.
 */
export const ABORTED_SESSION_HINT =
  'the session is inside an ABORTED PostgreSQL transaction: an earlier statement in it failed and '
  + 'the failure was swallowed. Continuing is not an option — every later statement, including the one /api/health '
  + 'depends on, would fail or block. Each boot seed now owns its own transaction boundary so a swallowed '
  + 'failure cannot be inherited; if you are reading this, the seed named above failed for real and its own '
  + 'earlier error is the one to fix.';
