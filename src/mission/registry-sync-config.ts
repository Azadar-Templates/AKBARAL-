/**
 * ZA141251SA registry sync — the two decisions `scripts/mission-sync-registry.ts` makes about
 * *how* it runs, separated from the run itself so they can be tested without a database.
 *
 * This file exists for one reason: those helpers used to live in the sync script, and a script with
 * a top-level `main()` is not importable — `import { probeDiagnosis } from '../scripts/…'` runs the
 * sync as a side effect. A pure decision that can only be exercised by running the thing it
 * configures tends to stay untested, and untested knobs in a command that writes 11,000 rows are how
 * a typo becomes an outage.
 */

/** Printed next to any failure that could have been avoided by knowing the budget. */
export const PG_SYNC_PROBE_BUDGET_NOTE =
  'the mission driver bounds one attempt with AKBARAL_PG_CONNECT_TIMEOUT_MS (30000) and AKBARAL_PG_QUERY_TIMEOUT_MS (120000)';

export const DEFAULT_SYNC_BATCH_AGENTS = 500;
export const MAX_SYNC_BATCH_AGENTS = 1000;

/**
 * How many agents go into one transaction. Default 500, tunable with ZA141251SA_SYNC_BATCH
 * (1–1000) because the cost of a batch is not a constant: on the managed PostgreSQL deployment a
 * batch's work is (existing-row read + upsert + wallet provisioning + audit append) per agent, and
 * an operator on a cold or distant database needs one knob to make the batches smaller and the
 * per-batch log line faster, without touching code. Batches stay transactional at any size, so a
 * lower number never risks a half-written agent — it only trades rows-per-commit for
 * commits-per-second.
 */
export function syncBatchSize(raw: string | undefined = process.env.ZA141251SA_SYNC_BATCH): number {
  const value = String(raw ?? '').trim();
  if (value.length === 0) return DEFAULT_SYNC_BATCH_AGENTS;
  const parsed = Number.parseInt(value, 10);
  // A typo must not silently sync in batches of 1 (hours) or 100000 (one giant transaction), and it
  // must not be rounded or clamped into a number its author never asked for.
  if (!Number.isFinite(parsed) || String(parsed) !== value || parsed < 1 || parsed > MAX_SYNC_BATCH_AGENTS) {
    throw new Error(
      `ZA141251SA_SYNC_BATCH must be a whole number of agents per transaction between 1 and ${MAX_SYNC_BATCH_AGENTS}, got "${value}".`,
    );
  }
  return parsed;
}

/**
 * What a failed pre-flight probe actually means, in operator terms.
 *
 * A log that cannot distinguish these cases is how a 15-second question ("is the database asleep?")
 * turns into an hour. A substring test on the word "timeout" alone would be a lie, because the
 * budget names this command prints contain it — so the patterns key on socket-level evidence, and an
 * unclassified error says so instead of guessing.
 */
export type ProbeFailureKind = 'refused' | 'reset' | 'slow' | 'not-postgres' | 'unclassified';

export function classifyProbeFailure(reason: string): ProbeFailureKind {
  if (/econnrefused/i.test(reason)) return 'refused';
  if (/econnreset|enotfound|eai_again|eaddrnotavail/i.test(reason)) return 'reset';
  if (/timed out|etimedout|timeout exceeded/i.test(reason)) return 'slow';
  if (/connection terminated unexpectedly|server closed the connection|invalid password|no pg_hba|unsupported frontend protocol/i.test(reason)) {
    return 'not-postgres';
  }
  return 'unclassified';
}

export function probeDiagnosis(reason: string): string {
  const common =
    'Nothing was written and no batch was started. Lower AKBARAL_PG_CONNECT_TIMEOUT_MS / ' +
    'AKBARAL_PG_QUERY_TIMEOUT_MS for a faster failure, or fix the database.';
  const kind = classifyProbeFailure(reason);
  if (kind === 'refused') {
    return (
      'The socket was REFUSED: nothing is listening at that host and port — a stopped local cluster, a wrong ' +
      `port, or a paused serverless endpoint. ${common}`
    );
  }
  if (kind === 'reset') {
    return (
      'The connection was RESET or the host never resolved: the address is reachable in shape but the session ' +
      `cannot be established (DNS, a stopped interface, or a pooler at its connection limit). ${common}`
    );
  }
  if (kind === 'slow') {
    return (
      'The attempt ran OUT OF TIME rather than being refused: a suspended serverless database waking up, a ' +
      'pooler that accepts and stalls, or a network that drops packets looks like this. Raise ' +
      `AKBARAL_PG_CONNECT_ATTEMPTS, or warm the database and re-run. ${common}`
    );
  }
  if (kind === 'not-postgres') {
    return (
      'Something answered, but not as a usable PostgreSQL session: the wrong service on that port, a proxy in the ' +
      'wrong mode, TLS requirements the server will not accept, or a handshake closed mid-flight. Check that ' +
      `ZA141251SA_DATABASE_URL points at the database and not at an HTTP tier. ${common}`
    );
  }
  return `The probe failed for a reason this command does not classify; the message above is the database's own. ${common}`;
}
