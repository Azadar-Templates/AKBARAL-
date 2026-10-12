/**
 * The readiness contract of the private mission server, in exactly one place.
 *
 * Why this file exists: `scripts/start-prod.mjs` decided whether the container's private tier had
 * started by polling `/api/health` and applying a contract it invented inline, while every other
 * consumer (the operator verify scripts, and any test that wants to prove a boot) had to guess at
 * that contract. The most expensive failure mode this repository has produced was a wrapper that
 * declared the private tier dead because its own budget and probe were wrong — and a test that
 * asserts a *different* notion of "ready" than production uses is the same mistake one level up.
 *
 * So: the production wrapper, the PostgreSQL boot test, and CI all call `waitForMissionReadiness`
 * with the same payload contract. "Ready" means the mission server answered its own health endpoint
 * with a payload that proves the boot actually finished — database, audit chain, ledger and a
 * provisioned owner — not merely that a socket accepted a connection.
 */

/** The health payload the mission server must report for this configuration. */
export function missionHealthIsReady(body, expectedDatabase) {
  return (
    body !== null &&
    typeof body === 'object' &&
    body.status === 'ok' &&
    // The service name is checked so that the public API answering on a port the mission server
    // was expected on is never mistaken for mission readiness.
    body.service === 'mission' &&
    // A migration or seed that silently targeted a different file is the failure this guards.
    (expectedDatabase === undefined || body.database === expectedDatabase) &&
    body.audit === true &&
    body.ledger === true &&
    Number.isInteger(body.ownerAccounts) &&
    // Readiness is not "listening": the private dashboard needs an owner, and a mission database
    // whose boot never reached the owner seed can be structurally fine while being unusable.
    body.ownerAccounts >= 1 &&
    body.vaultConfigured === true
  );
}

/**
 * Poll until the contract is satisfied or the budget runs out.
 *
 * Two properties were learned the hard way and are the reason both knobs exist:
 *  · `requestTimeoutMs` is per request (default 5 s, not 1 s) because a mission boot can hold the
 *    event loop in database work for longer than that. A 1 s per-request timeout produced
 *    `fetch failed` on a server that was perfectly healthy and merely busy, which read exactly
 *    like a dead one.
 *  · `timeoutMs` is the whole budget (default 180 s) because the measured production boot needed
 *    ~38 s on a PostgreSQL mission database holding the imported 4,001-agent fleet. A budget
 *    shorter than the work is not a safety margin; it is an outage that repeats on every deploy.
 *
 * While waiting, `progress` is called at least every `progressMs` with what has been observed, so
 * a slow start looks like a slow start.
 *
 * @param {{ healthUrl: string, expectedDatabase?: string|null, timeoutMs?: number,
 *   requestTimeoutMs?: number, pollMs?: number, progressMs?: number,
 *   progress?: (info: { elapsedMs: number, timeoutMs: number, lastFailure: string }) => void }} options
 */
export async function waitForMissionReadiness(options) {
  const healthUrl = String(options.healthUrl);
  const expectedDatabase = options.expectedDatabase ?? null;
  const timeoutMs = Number(options.timeoutMs ?? 180_000);
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? 5_000);
  const pollMs = Number(options.pollMs ?? 250);
  const progressMs = Number(options.progressMs ?? 10_000);
  const progress = typeof options.progress === 'function' ? options.progress : () => {};
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastFailure = 'no health response received yet';
  let nextProgress = Date.now() + progressMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        lastFailure = `health endpoint returned HTTP ${response.status}`;
      } else {
        const body = await response.json();
        if (missionHealthIsReady(body, expectedDatabase)) return body;
        lastFailure =
          `health payload did not satisfy the private readiness contract ` +
          `(status=${String(body?.status)}, service=${String(body?.service)}, database=${String(body?.database)}, ` +
          `audit=${String(body?.audit)}, ledger=${String(body?.ledger)}, ` +
          `ownerAccounts=${String(body?.ownerAccounts)}, vaultConfigured=${String(body?.vaultConfigured)})` +
          (expectedDatabase === null ? '' : `; this boot expects database=${expectedDatabase}`);
      }
    } catch (error) {
      lastFailure =
        `${error instanceof Error ? error.message : String(error)} — nothing answered ${healthUrl} within ` +
        `${requestTimeoutMs}ms, which means the service had not reached listen() yet or is bound elsewhere`;
    }
    if (Date.now() >= nextProgress) {
      progress({ elapsedMs: Math.min(timeoutMs, Date.now() - startedAt), timeoutMs, lastFailure });
      nextProgress = Date.now() + progressMs;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`private mission readiness timed out after ${timeoutMs}ms (${lastFailure}); probed ${healthUrl}`);
}
