# P0-0 FIX — `/api/boss/*` fail-open auth → fail-closed

All work in this document was done on disposable, temp-file database state. The real mission database was
never initialized; ZA141251SA was not deployed, started, or touched; no owner credentials, KYC, payout, or
mission revenue were created; no production database was modified.

## Original vulnerability

`src/routes/boss-dashboard.ts` is mounted at `/api/boss` on `src/app.ts` — the same public Express
application/process/port that serves AKBARAL! customer traffic, bound to `0.0.0.0` in production (confirmed
in `src/config/env.ts`: `HOST` defaults to `0.0.0.0`). Its `requireMissionAuth` middleware read:

```ts
if (!missionToken) {
  // No token configured — allow local-only access (bind is 127.0.0.1 by default)
  return next();
}
```

An unauthenticated `GET /api/boss/overview` against a disposable local instance (no `ZA141251SA_*` env set,
matching the Dockerfile's default posture) returned HTTP 500 and silently created `mission.db`/`-shm`/`-wal`
via the lazy-open `missionDb` singleton.

## Exact root cause

Traced request → route → auth → mission DB access:

1. `src/app.ts` line 207: `app.use('/api/boss', bossDashboardRouter)` — mounted on the main app, no network
   boundary of its own.
2. `requireMissionAuth` reads `ZA141251SA_DASHBOARD_TOKEN ?? MISSION_DASHBOARD_TOKEN`. When **absent**, the
   code called `next()` unconditionally — an "if configured, check it; otherwise allow" pattern.
3. The inline comment ("bind is 127.0.0.1 by default") is **factually wrong for this router**. It correctly
   describes `src/mission/server.ts` — a genuinely separate, standalone Node HTTP server (not Express, zero
   imports from the AKBARAL! app) that binds loopback by default via its own `ZA141251SA_BIND_HOST` config and
   has its own proper session-based owner/operator/access-link auth model. That separate server was never the
   problem. The comment's assumption was mistakenly carried over to `boss-dashboard.ts`, a *different* router
   that has no such network protection — it lives on the public app.
4. Once `next()` ran, the route handler executed a real SQL query via `missionDb` (`src/mission/database.ts`),
   whose `open()` is lazy — the mission database file does not exist until the first query. That first
   unauthenticated query is exactly what created it.

**Why missing configuration produced fail-open instead of fail-closed**: the code treated "no token
configured" as equivalent to "authorization not required," rather than "authorization can never be granted
because there is nothing to check the presented credential against." Those are opposite conclusions from the
same fact.

## Exact fix

`src/routes/boss-dashboard.ts`, `requireMissionAuth` rewritten to fail closed unconditionally:

- **Missing configuration** (`ZA141251SA_DASHBOARD_TOKEN` and `MISSION_DASHBOARD_TOKEN` both unset/blank) →
  `HttpError(503, 'mission dashboard is not configured', 'mission_dashboard_not_configured')`. Matches the
  existing repository convention for "a required secret is absent" (`src/billing/stripe.ts` does the same:
  `503 webhook_not_configured` when `STRIPE_WEBHOOK_SECRET` is unset).
- **Any other failure** (no `Authorization` header, wrong scheme, empty token, wrong token, a valid AKBARAL!
  customer JWT) → `HttpError(401, 'unauthorized', 'unauthorized')`.
- **Success** (exact match) → `next()`, and only then can the route handler touch `missionDb`.
- Token comparison uses `crypto.timingSafeEqual` (equal-length check first, then constant-time compare) so a
  wrong-length or wrong-content guess cannot be distinguished by timing.
- Errors are raised via `next(new HttpError(...))` instead of a bespoke `res.status().json()`, so they flow
  through the app's single shared `errorHandler` (`src/server/http.ts`) — the same code path already used by
  every other router, which never leaks a stack trace and masks internal detail in production.
- The middleware and route handlers are unchanged otherwise — no route was disabled, no functionality removed.
- **Deliberately not reused**: AKBARAL!'s customer `requireAuth`/`requireRole('owner')` middleware. Wiring
  those in would make a customer's session (even one with an `'owner'` role in the customer database) usable
  as mission authorization — exactly the "merge customer auth and mission owner auth" outcome this task
  explicitly forbids. The mission dashboard token remains its own, separate credential space.

## Affected routes (all seven, same middleware)

`GET /api/boss/overview`, `/agents`, `/agents/:id`, `/treasury`, `/scheduler`, `/blocked`, `/opportunities` —
all pass through the single `requireMissionAuth` function, so the fix applies uniformly.

## Other mission-facing routes checked for the same pattern

Per instruction, inspected before concluding this was isolated:

- `src/routes/economy.ts` (imports `missionChatHistory/WithAgent/WithGroup` from `../economy/mission-chat`):
  **not vulnerable**. The entire router is behind `router.use(requireAuth, requireRole('owner','super_admin'))`
  (line 90), applied uniformly to every route in the file, including the mission-chat ones. No fail-open path.
- `src/routes/admin.ts`, `src/routes/owner*.ts`: use the same `requireAuth + requireRole(...)` idiom — no
  fail-open path.
- `src/mission/server.ts` (the actual separate ZA141251SA mission server): a different, standalone HTTP
  server with its own proper session-based auth (owner session / operator session / scoped access link),
  loopback-bound by default, zero imports from the AKBARAL! app. Reviewed and found structurally sound —
  not sharing any code path with the defect above.
- A repository-wide search for the exact anti-pattern (`if (!token) { ...; return next(); }` /
  "allow local-only access" / "No token configured") found **exactly one occurrence**, in the original
  `boss-dashboard.ts` — now fixed. No other genuine fail-open path was found; none was manufactured to pad
  this report.

## Tests added

New file `src/routes/boss-dashboard.test.ts` (10 tests, HTTP-level, against a real `createApiServer()`
instance and a disposable temp-file mission database unique to the test run — never the real `mission.db`,
never production):

**Phase A — dashboard token entirely unconfigured:**
1. No `Authorization` header → `503 mission_dashboard_not_configured`; mission DB file confirmed absent.
2. A client-supplied bearer token (of any value) → still `503`; confirms "if configured, check it" logic is
   gone — an attacker cannot force acceptance by simply presenting *something*.
3. Every one of the 7 `/api/boss/*` routes → `503`, mission DB file confirmed absent after all of them.
4. Response body contains no stack frame pattern and no SQL/table-name text.

**Phase B — dashboard token configured (`ZA141251SA_DASHBOARD_TOKEN` set to a disposable test value):**
5. No `Authorization` header → `401`; mission DB file still absent.
6. Wrong token → `401`; mission DB file still absent.
7. Malformed scheme (`Basic ...` instead of `Bearer ...`) → `401`; mission DB file still absent.
8. Empty `Bearer` value → `401`; mission DB file still absent.
9. A **real** AKBARAL! customer session token (obtained via a live `/api/auth/register` call in the test) →
   `401` — direct proof that customer authentication cannot become mission-owner authorization.
10. The correct mission dashboard token → `200`, and only after this test explicitly calls
    `applyMissionMigrations()` (an intentional, disposable-file migration step *inside the test*, not a side
    effect of any request) does the mission DB file exist — proving the legitimate owner access path still
    works end-to-end, and that DB creation is never an unauthenticated side effect.

All 10 pass. Existing security suites re-run and unmodified/unweakened:
`src/security/three-plane-isolation.test.ts` (11/11 pass, including the pre-existing static "BOSS dashboard
does not query customer tables" check), `src/security/role-separation.test.ts`, and
`src/security/mission-cash-boundary.test.ts` — 38/38 combined, 0 fail.

## Before / after behavior

| Scenario | Before | After |
|---|---|---|
| No token configured, no `Authorization` header | `next()` called → handler ran → **HTTP 500**, `mission.db` created | **HTTP 503** `mission_dashboard_not_configured`, no DB file created |
| No token configured, any `Authorization` header | Same as above (config state ignores the header) | **HTTP 503**, no DB file created |
| Token configured, no header | `401` (already correct) | **HTTP 401** `unauthorized` (unchanged, still correct) |
| Token configured, wrong/malformed/empty token | `401` (already correct for exact mismatches; malformed header untested before) | **HTTP 401**, explicitly tested for wrong/malformed/empty |
| Token configured, valid AKBARAL! customer JWT presented as bearer | Would have been compared byte-for-byte against the mission token and rejected (`401`) — but **untested**, so this was unproven, not guaranteed | **HTTP 401**, now proven by a real end-to-end test using a live customer registration |
| Token configured, correct token | `200` (already correct) | **HTTP 200** (unchanged), now with an explicit test proving the legitimate path still works |

## Remaining blockers (unaffected by this fix)

- `artifacts/MASTER_BLOCKERS.md` B-2/B-3/B-4 (deployment identity, GHCR visibility, Railway env values) remain
  `UNKNOWN` — unrelated to this fix.
- Railway is still running an older image (confirmed in the prior P0 integration pass); this fix is not yet
  deployed there. A new image must be built/published (see below) and then deployed by the owner before
  `/api/boss/*` is actually fail-closed in production.
- Whether Railway's environment currently has `ZA141251SA_DASHBOARD_TOKEN`/`MISSION_DASHBOARD_TOKEN` set
  remains `UNKNOWN` (no Railway dashboard access from this sandbox) — now moot for the fail-open risk once
  this fix is deployed, since the route fails closed either way, but still relevant for whether the
  *legitimate* owner dashboard is currently reachable at all.
