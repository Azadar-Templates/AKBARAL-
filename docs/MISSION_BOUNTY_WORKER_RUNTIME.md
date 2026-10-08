# Mission bounty worker: runtime and token placement

Scope: where the GitHub-issue bounty worker runs, where it reads
`ZA141251SA_GITHUB_TOKEN`, and what it refuses to do without an authorized
program. This note does not change how the worker is invoked.

## Where it runs

- The worker entry point is `scripts/mission-bounty-worker.ts` (npm script
  `mission:bounty-worker`, `package.json`).
- It runs in GitHub Actions: `.github/workflows/mission-bounty-worker.yml`,
  on `workflow_dispatch` and a cron schedule (`17,47 * * * *`).
- It does **not** run inside Railway. Railway environment variables are not
  visible to the Actions job.

## Where the token is read

- The workflow passes the token from the repository secret
  `ZA141251SA_GITHUB_TOKEN` (`.github/workflows/mission-bounty-worker.yml:31`).
- `configuredGithubBountyClient()` reads `env.ZA141251SA_GITHUB_TOKEN`
  (`src/mission/earning/github-bounty-client.ts:560`).
- The client refuses a malformed token with `github_credentials_invalid`
  (`github-bounty-client.ts:122-123`). With no token it makes unauthenticated,
  rate-limited public reads.

**Required:** `ZA141251SA_GITHUB_TOKEN` must exist as a **GitHub Actions
repository secret** for the worker to use it. A Railway variable alone does not
reach the worker. The token is optional for public reads, but authenticated
reads are needed for the rate limits you will hit in practice.

## Scope gate (fail closed)

- With no active `bounty_programs` row, the cycle returns
  `ran: false, reason: "program_not_configured"` before any GitHub call
  (`src/mission/earning/github-bounty-scheduler.ts`). The worker prints
  `[mission:bounty] scope_gate: program_not_configured`.
- Discovery searches only repositories with an exact `repo` allow row under an
  active program (`src/mission/earning/github-bounty-scope-gate.ts`).
- Every repository-scoped outbound call and durable mutation calls
  `gateGithubRepo()` first. A refusal is recorded in `scope_gate_events` (for
  program-level decisions) or the mission audit trail, and the call is not made.

## Database the worker must see

The worker reads its programs and scope from the mission database given by
`ZA141251SA_DATABASE_URL` (`.github/workflows/mission-bounty-worker.yml:27`).
If that is not the same database where you registered programs, the worker sees
zero active programs and does nothing. This is fail-closed, but it is not what
you want. Check that the Actions secret points at the database you use for the
owner routes in `docs/OWNER_BOUNTY_PROGRAM_SETUP.md`.

## Owner checklist

1. Set `ZA141251SA_GITHUB_TOKEN` as a **GitHub Actions secret** (in addition to any Railway variable).
2. Register at least one active program with real repo scope before enabling the worker.
3. Leave `ZA141251SA_BOUNTY_WORKER_ENABLED` unset until you are ready to run it.
