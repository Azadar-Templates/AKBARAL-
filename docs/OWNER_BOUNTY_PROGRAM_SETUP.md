# Owner runbook: register bounty programs and scope

Status: **configuration only.** This runbook describes how the owner registers
bounty programs and their explicit scope in the mission control plane. It does
not seed any program or scope row. The tables stay empty until the owner
confirms each program's real, currently valid scope.

Every `file:line` reference below points at the repository at the time this
runbook was written (base `f3eec3d`). Line numbers may drift; re-check them if
the code changes.

---

## 0. Ground rules (read first)

1. **Only targets in `scope_allowlist` may be tested.** Anything else must be
   refused, even if it looks related, is a subdomain, or is a fork. The gate is
   `assertInScope()` (`src/mission/earning/bug-bounty-system.ts:120`), and it
   fails closed.
2. **Testing a target outside a program's published scope is unlawful** and can
   violate the platform's terms, get your account banned, and expose you to
   legal liability. The program's rules, not this repo, are the authority.
3. **Re-read each program's rules before every scope change.** Scope and
   out-of-scope lists change. Record the date you verified each row in
   `lastVerifiedAt`.
4. **Keep the mission server disabled.** Do not set
   `ZA141251SA_MISSION_SERVER_ENABLED` as part of this runbook.
5. **Never paste secret values into chat, Git, or this file.** Names only.

---

## 1. Prerequisites checklist

Names only. Values never belong in Git, chat, or docs.

| Env var | Purpose | Where the owner gets it | Read by | Status in the sandbox used to write this |
| --- | --- | --- | --- | --- |
| `ZA141251SA_GITHUB_TOKEN` | Owner's own GitHub personal access token for authenticated GitHub reads (optional for public reads). | GitHub → Settings → Developer settings → Personal access tokens. Use the least scope that works (read-only for discovery). | `src/mission/earning/github-bounty-client.ts:560` | Owner reports it is on Railway. **Not verifiable from the sandbox.** GitHub Actions needs it as a repository secret (see `.github/workflows/mission-bounty-worker.yml:29`). |
| `ZA141251SA_OWNER_EMAIL` | The one identity-locked mission owner email. | Your own mission owner account. | `src/mission/identity-lock.ts:27`, `scripts/mission-bounty-worker.ts:26-28` | MISSING |
| `ZA141251SA_DATABASE_URL` | Mission database connection (falls back to a local SQLite file). | Your production mission Postgres connection string. | `src/mission/database.ts:44` | MISSING |
| `ZA141251SA_SESSION_SECRET` | Session secret for mission sign-in. | Generate a long random value yourself and store it in your secret manager. | `src/mission/database.ts:47` | MISSING |
| `ZA141251SA_CREDENTIAL_KEY` | Credential-vault encryption key. Must be at least 32 characters. | Generate yourself. Must match the key that encrypted any stored model credential. | `src/mission/auth.ts:311`, `auth.ts:323` | MISSING |
| `ZA141251SA_BOUNTY_WORKER_ENABLED` | Must equal the exact string `true` to let the bounty worker run. | Set by you in GitHub repository variables. | `scripts/mission-bounty-worker.ts:22`, `.github/workflows/mission-bounty-worker.yml:22` | MISSING. Leave unset until the owner explicitly enables the worker. |
| `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST` | Immutable `sha256:<64 lowercase hex>` digest of the trusted sandbox image. | Emitted by the sandbox publish workflow (`.github/workflows/bounty-sandbox-publish.yml`). It is **not** a value you choose. | `src/mission/earning/github-bounty-sandbox.ts:89` | MISSING |
| `ZA141251SA_BOUNTY_SANDBOX_RUNTIME` | Container runtime. Defaults to `docker`; `podman` is also accepted. | Set on the host that runs the sandbox. | `src/mission/earning/github-bounty-sandbox.ts:94` | Not set. Default `docker` applies. |
| `ZA141251SA_CHAT_FREE_TIER` | Opt-in for the existing free-tier model configuration. Leave unset unless you have explicitly opted in. | Your own decision, through the existing owner flow. | `src/mission/chat-provider.ts:97` | MISSING (intentionally) |
| `ZA141251SA_MISSION_SERVER_ENABLED` | Enables the mission server. **Keep it unset for this task.** | Not applicable here. | `scripts/start-prod.mjs:94` | Not set. Must stay unset. |

Notes:

- **The bounty worker runs in GitHub Actions, not in Railway.** The workflow
  reads `ZA141251SA_GITHUB_TOKEN`, `ZA141251SA_DATABASE_URL`,
  `ZA141251SA_SESSION_SECRET`, and `ZA141251SA_CREDENTIAL_KEY` from **repository
  secrets** and `ZA141251SA_OWNER_EMAIL`, `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST`,
  and `ZA141251SA_CHAT_FREE_TIER` from **repository variables**
  (`.github/workflows/mission-bounty-worker.yml:22-34`). Adding a token to
  Railway does not make it visible to that workflow.
- `GITHUB_TOKEN` (without the prefix) is used by other ingestion code
  (`src/mission/opportunity-ingestion.ts:590`), not by the bounty client. Do not
  rely on it for the bounty path.

---

## 2. Owner-only routes

All routes are under `/api/bounty/...`. They are handled by the `head === 'bounty'`
branch (`src/mission/server.ts:1291`) and the `programs` branch (`server.ts:1331`).
They require a signed-in owner session with role `owner`
(`requireHeadAgentOwner` → `requireOwner`, `server.ts:370-385`). Read-only roles
get `403`. Signed-out requests get `401`.

Authentication is a Bearer token from `POST /api/session/login`
(`server.ts:1494-1505`; the response includes `token`, `csrfToken`, `expiresAt`,
and `owner`, see `src/mission/auth.ts:111-116`).

| Method | Path | Body fields | Auth | Purpose | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/bounty/programs` | none | owner session | List programs | `server.ts:1336` |
| `POST` | `/api/bounty/programs` | see below | owner session | Create a program. Returns `201 { program }`. | `server.ts:1337-1341` |
| `GET` | `/api/bounty/programs/:id` | none | owner session | Read one program | `server.ts:1349` |
| `PATCH` or `PUT` | `/api/bounty/programs/:id` | partial program fields | owner session | Update a program (including `active`) | `server.ts:1350` |
| `DELETE` | `/api/bounty/programs/:id` | none | owner session | Delete a program (cascades to scope) | `server.ts:1351` |
| `GET` | `/api/bounty/programs/:id/scope` | none | owner session | List scope rows for the program | `server.ts:1345` |
| `POST` | `/api/bounty/programs/:id/scope` | see below | owner session | Add or update a scope row. Returns `201 { scope }`. | `server.ts:1346` |
| `DELETE` | `/api/bounty/programs/:id/scope/:scopeId` | none | owner session | Remove a scope row | `server.ts:1347` |
| `GET` | `/api/bounty/scope-events?programId=:id` | none | owner session | Audit trail of allowed and blocked scope decisions | `server.ts:1355-1357` |

### 2a. `POST /api/bounty/programs` body

| Field | Type | Required | Rules (source) |
| --- | --- | --- | --- |
| `platform` | string | yes | 1–80 chars, no control characters (`bug-bounty-system.ts:48-53`) |
| `programHandle` | string | yes | 1–200 chars. Unique per `platform` (migration `db/migrations-mission/0042_bug_bounty_agent_system.sql:20`). |
| `scopeUrl` | string | yes | 1–2000 chars. The URL of the program's scope page. |
| `programTermsHash` | string | yes | **Exactly 64 hex characters**, a SHA-256 of the program terms you saved (`bug-bounty-system.ts:182-183`). |
| `inScopeAssets` | string[] | no | Up to 1000 items, each up to 2048 chars (`bug-bounty-system.ts:55-61`). Informational. Does **not** grant scope; only `scope_allowlist` does. |
| `outOfScope` | string[] | no | Same as above. Informational. |
| `rateLimitPolicy` | object | no | Serialized JSON, max 16000 chars |
| `authRequired` | boolean | no | Defaults to `true` unless set to `false` (`bug-bounty-system.ts:192`) |
| `bountyRange` | object | no | Serialized JSON, max 16000 chars |
| `active` | boolean | no | **Defaults to `false`.** Set `true` to make the program eligible. A program with `active` false blocks every scope check (`bug-bounty-system.ts:128-131`). |

### 2b. `POST /api/bounty/programs/:id/scope` body

| Field | Type | Required | Rules (source) |
| --- | --- | --- | --- |
| `target` | string | yes | Normalized per `targetType` (`bug-bounty-system.ts:89-102`). |
| `targetType` | `"domain"` \| `"repo"` \| `"package"` \| `"API"` | yes | Anything else returns `400` (`bug-bounty-system.ts:33`). |
| `inScope` | boolean | yes | **Must be exactly `true` to allow.** Any other value (including omitted) is stored as an out-of-scope row (`server.ts:1346`). |
| `authRequired` | boolean | no | Defaults to `false` |
| `rateLimitPerMin` | integer or null | no | Integer from 1 to 100000, or null (`bug-bounty-system.ts:36`) |
| `lastVerifiedAt` | string | no | Up to 80 chars. Record the date you checked the program's rules. |

Scope rows are unique per `(program_id, target)` (migration `0042`, line 35).
Posting the same target again updates the existing row.

### 2c. Target types

- `domain`: hostname. Wildcards are supported in the form `*.example.com`
  (`bug-bounty-system.ts:115`). Matching is case-insensitive and strips a leading `www.`.
- `repo`: GitHub `owner/name`. Full `https://github.com/...` URLs are normalized
  (`bug-bounty-system.ts:92-94`).
- `package`: stored and matched as an exact normalized string.
- `API`: `protocol://host/path`, normalized (`bug-bounty-system.ts:95-100`).

**There is no target type for blockchain contract addresses.** For Web3 programs
you must choose a type that fits, or ask the platform how to represent the asset.
`UNKNOWN / VERIFY REQUIRED`. Do not guess.

---

## 3. Step-by-step program registration

For each platform below, the owner does the same four things:

1. Open the program's public page on the platform and copy the **in-scope asset
   list**, the **out-of-scope list**, and the **rules** (or the contest/audit
   rules for contest platforms).
2. Save a copy of the rules text and compute its SHA-256:
   `sha256sum program-rules.txt` → use the 64-hex digest as `programTermsHash`.
3. Create the program with `POST /api/bounty/programs`, with `active: false` at first.
4. Add **only the assets the program explicitly lists as in scope** with
   `POST /api/bounty/programs/:id/scope` and `inScope: true`. Then set
   `active: true` with `PATCH`.

The exact layout of each platform's pages changes over time, so the instructions
below name what to look for, not exact menu paths. Anything you cannot confirm
on the live page is marked `UNKNOWN / VERIFY REQUIRED`.

### 3.1 Immunefi (Web3 bug bounty)

- **Where to read in-scope assets:** the program's public page on Immunefi, in
  the section that lists in-scope assets (typically contract addresses, repos,
  or web/API assets). Note any asset categories or severity tiers the page
  defines. `UNKNOWN / VERIFY REQUIRED` for category names.
- **Where the rules live:** the program's rules or terms section on the same
  page, plus Immunefi's general rules. Save both.
- **Translate to rows:**
  - Web assets (domains or APIs): `targetType` `domain` or `API`.
  - Source repositories: `targetType` `repo`.
  - Smart-contract addresses: **UNKNOWN / VERIFY REQUIRED.** No matching target
    type exists in the schema (see §2c). Do not add contract addresses until you
    have confirmed how the matching behaves.
- **Bounty range:** the page shows a reward range. Record it in `bountyRange`
  only as you read it on the live page. `UNKNOWN / VERIFY REQUIRED` for any
  figure not verified on the live page. The repo does not verify any amount.

### 3.2 Code4rena (Web3 audit contests)

- **Model:** a time-boxed audit contest on a fixed commit. There is usually no
  standing bounty program. Scope is the contest's listed repositories and files.
- **Where to read scope:** the contest page's scope and out-of-scope sections,
  and the repository and commit it links.
- **Rules:** the contest rules page. Save the text. `UNKNOWN / VERIFY REQUIRED`
  for any specific rule not verified on the live page.
- **Translate to rows:** `targetType` `repo` with the repository URL. Record the
  commit in the program's `scopeUrl` or `rateLimitPolicy` note field. Use one program per contest
  so scope can expire cleanly by setting `active: false` after the contest ends.
- **Bounty range:** `UNKNOWN / VERIFY REQUIRED`.

### 3.3 Sherlock (Web3 audit contests)

- **Model:** audit contests, like Code4rena. Scope is the contest's listed
  repositories and commit.
- **Where to read scope:** the contest or competition page on Sherlock's site,
  including its scope and out-of-scope sections. `UNKNOWN / VERIFY REQUIRED`
  for exact section names.
- **Rules:** the Sherlock contest rules and any program-specific terms. Save them.
- **Translate to rows:** the same as Code4rena. One program per contest, with
  `targetType` `repo`.
- **Bounty range:** `UNKNOWN / VERIFY REQUIRED`.

### 3.4 HackerOne (web bug bounty)

- **Where to read in-scope assets:** the program's **Scope** section on the
  HackerOne program page. It lists assets with their types (for example
  `URL`, `Wildcard`, or `Other`). Read the exact labels on the live page.
  `UNKNOWN / VERIFY REQUIRED` for label names.
- **Where the rules live:** the program's policy text on the same page, and
  HackerOne's disclosure guidelines. Save both.
- **Translate to rows:**
  - Wildcard entries such as `*.example.com` → `domain` with the wildcard form.
  - Specific hosts → `domain`.
  - API endpoints listed as URLs → `API`, using the exact base path.
  - Repositories → `repo`.
  - Mobile or other asset types → `package` or `UNKNOWN / VERIFY REQUIRED`.
- **Bounty range:** shown on the program page. Record it only as read.

### 3.5 Bugcrowd (web bug bounty)

- **Where to read in-scope assets:** the program's **Target** or **Scope**
  section on the Bugcrowd engagement page. Bugcrowd lists targets with a tag
  for in-scope and out-of-scope. Read the live labels. `UNKNOWN / VERIFY REQUIRED`.
- **Where the rules live:** the engagement's rules or terms page. Save it.
- **Translate to rows:** the same as HackerOne. Only targets tagged in-scope
  get `inScope: true`. Record out-of-scope targets as `inScope: false` if you
  want an explicit deny. An explicit deny always wins (`bug-bounty-system.ts:134-138`).
- **Bounty range:** `UNKNOWN / VERIFY REQUIRED`.

---

## 4. Copy-paste request examples

**All values below are PLACEHOLDERS.** Replace them with the real values from
the program's live page. Never use placeholder values as real scope.

Set these shell variables in your terminal. Do not commit them.

```bash
# PLACEHOLDERS ONLY. Do not commit real values.
export MISSION_BASE_URL="http://localhost:4200"   # PLACEHOLDER: your mission server base URL
export MISSION_EMAIL="owner@example.invalid"      # PLACEHOLDER
export MISSION_PASSWORD="REPLACE_WITH_YOUR_PASSWORD"  # PLACEHOLDER: type it, don't store it
```

### 4a. Sign in and capture the Bearer token

```bash
MISSION_TOKEN=$(curl -sS -X POST "$MISSION_BASE_URL/api/session/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$MISSION_EMAIL\",\"password\":\"$MISSION_PASSWORD\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
```

### 4b. Create a program (starts inactive)

`programTermsHash` must be the 64-hex SHA-256 of your saved rules text.

```bash
TERMS_HASH=$(sha256sum program-rules.txt | cut -d' ' -f1)   # program-rules.txt is YOUR saved copy

curl -sS -X POST "$MISSION_BASE_URL/api/bounty/programs" \
  -H "Authorization: Bearer $MISSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"platform\": \"PLACEHOLDER_PLATFORM_NAME\",
    \"programHandle\": \"PLACEHOLDER_PROGRAM_HANDLE\",
    \"scopeUrl\": \"https://PLACEHOLDER.invalid/scope-page\",
    \"programTermsHash\": \"$TERMS_HASH\",
    \"inScopeAssets\": [\"PLACEHOLDER_ASSET_1\"],
    \"outOfScope\": [\"PLACEHOLDER_OUT_OF_SCOPE_1\"],
    \"authRequired\": true,
    \"bountyRange\": {\"note\": \"UNKNOWN / VERIFY REQUIRED\"},
    \"rateLimitPolicy\": {\"note\": \"PLACEHOLDER\"},
    \"active\": false
  }"
```

The response is `201 { "program": { "id": "bpr_…", … } }`. Copy the `id`
(a `bpr_…` value) from the response. Do not guess it.

### 4c. Add one in-scope scope entry

```bash
PROGRAM_ID="bpr_REPLACE_WITH_ID_FROM_4b"   # PLACEHOLDER: copy the real id from the 4b response

curl -sS -X POST "$MISSION_BASE_URL/api/bounty/programs/$PROGRAM_ID/scope" \
  -H "Authorization: Bearer $MISSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"target\": \"placeholder-asset.example.invalid\",
    \"targetType\": \"domain\",
    \"inScope\": true,
    \"authRequired\": false,
    \"rateLimitPerMin\": 10,
    \"lastVerifiedAt\": \"YYYY-MM-DD\"
  }"
```

`lastVerifiedAt` should be the date you verified this row on the live program
page. Use `YYYY-MM-DD`. It is informational and does not affect the gate.

### 4d. Add an explicit out-of-scope deny (optional)

```bash
curl -sS -X POST "$MISSION_BASE_URL/api/bounty/programs/$PROGRAM_ID/scope" \
  -H "Authorization: Bearer $MISSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target\": \"placeholder-excluded.example.invalid\", \"targetType\": \"domain\", \"inScope\": false}"
```

### 4e. Activate the program only after scope is verified

```bash
curl -sS -X PATCH "$MISSION_BASE_URL/api/bounty/programs/$PROGRAM_ID" \
  -H "Authorization: Bearer $MISSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

---

## 5. Explicit warning section

- **Only targets listed in `scope_allowlist` with `inScope: true` may be tested.**
  Everything else must be refused.
- **Do not add scope rows from memory, from a forum, from an AI answer, or from
  a guess.** Copy them from the program's own live page, and record the date in
  `lastVerifiedAt`.
- **Testing outside a published scope is unlawful** and can breach the platform's
  terms. Do not rely on this system to stop you. The gate only protects the
  paths it covers (see §6).
- **Re-verify before every change.** Programs add, remove, and reclassify assets.
  Set `active: false` if you cannot confirm the current scope.
- **Do not add wildcards you have not verified.** A `*.example.com` row covers
  every subdomain, including ones the program may exclude.
- **Out-of-scope rows win.** An explicit `inScope: false` row blocks a target even
  if a broader allow row also matches (`bug-bounty-system.ts:134-138`).

---

## 6. Verification steps

### 6a. Confirm the program exists

```bash
curl -sS "$MISSION_BASE_URL/api/bounty/programs" -H "Authorization: Bearer $MISSION_TOKEN"
```

Healthy: HTTP `200`, JSON with `programs` containing your entry, `empty: false`.
`active` should be `true` only after you completed step 4e.

### 6b. Confirm scope rows

```bash
curl -sS "$MISSION_BASE_URL/api/bounty/programs/$PROGRAM_ID/scope" -H "Authorization: Bearer $MISSION_TOKEN"
```

Healthy: `scope` contains each row you added, with `inScope: true` for allowed
targets and `inScope: false` for explicit denies. `empty: false`.

### 6c. Confirm the gate is working

The scope check runs inside the server. There is no public "check this target"
route. Verify with the scope audit trail:

```bash
curl -sS "$MISSION_BASE_URL/api/bounty/scope-events?programId=$PROGRAM_ID" -H "Authorization: Bearer $MISSION_TOKEN"
```

- An allowed target shows `decision: "allowed"` and `reason: "explicit_allowlist_match"`
  (`bug-bounty-system.ts:144`).
- An out-of-scope target shows `decision: "blocked"` and one of:
  - `program_not_configured`: no program row (`bug-bounty-system.ts:125`)
  - `program_inactive`: `active` is false (`bug-bounty-system.ts:129`)
  - `explicitly_out_of_scope`: a matching row has `inScope: false` (`bug-bounty-system.ts:136`)
  - `target_not_allowlisted`: no matching allow row (`bug-bounty-system.ts:141`)

The error the gate raises is `BountyScopeError` with code
`target_out_of_scope` and status `403` (`bug-bounty-system.ts:15-21`). That
error is raised inside the process. It is not a public HTTP route. A blocked
decision is visible in `scope-events`.

### 6d. Confirm nothing was seeded by accident

Before you add anything, `GET /api/bounty/programs` should return
`empty: true`. If it returns programs you did not create, stop and investigate.

---

## 7. What will not work yet

Each item below is a real limitation in the current code. Do not expect them
to work until the owner has finished the separate work.

1. **Sandbox image is not provisioned.** Without
   `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST`, `OciBountySandboxRunner.image` is
   empty and `available()` returns false (`github-bounty-sandbox.ts:93`, `:97`).
   The workflow then returns `sandbox_unavailable` and performs no execution
   (`github-bounty-workflow.ts:346`, `:364`, `:369`).
   - The image name is **hard-coded** to
     `ghcr.io/azadar-templates/akbaral-bounty-sandbox`
     (`github-bounty-sandbox.ts:34`). It is **not** your own registry. Your own
     registry would need a code change, which this task does not make.
2. **Settlement adapter is absent.** Bounty acceptance cannot credit cash yet.
   This is the owner's stated status; I did not re-verify it in code. Confirm
   the current state in `src/mission/earning/settlement-verification.ts` before
   relying on any payout.
3. **Mission server is disabled.** Do not set
   `ZA141251SA_MISSION_SERVER_ENABLED`. The `/api/bounty/...` routes exist in code
   but are only reachable when the server runs (`scripts/start-prod.mjs:94`).
4. **No auto-submission.** The control plane has no code path that submits a
   report to a platform. Reports require owner review (`bug-bounty-system.ts`,
   `reportWriter` and quality gates).
5. **GitHub bounty worker is not scope-gated.** `runGithubBountyCycle` and the
   GitHub bounty workflow never call `assertInScope` (the only callers are
   `bug-bounty-system.ts`, `discipline-engine.ts`, `model-layer.ts`, and
   `platform-adapters.ts`). Adding `repo` scope rows does **not** restrict the
   GitHub issue bounty worker. The legacy `/api/bounty/...` GitHub route refuses
   with `409 scope_control_plane_required` (`server.ts:1392-1395`), but the
   worker path is not that route. Treat this as a known gap until it is fixed.
6. **Programs are inactive by default.** Scope checks fail with
   `program_inactive` until you set `active: true`.
7. **Bounty amounts and platform terms are not verified by this repo.** Every
   amount, range, and rule in this runbook is `UNKNOWN / VERIFY REQUIRED` unless
   you confirmed it on the live page.

---

## 8. Owner setup required (names only)

**Env vars still missing in the sandbox used to write this runbook:**
`ZA141251SA_OWNER_EMAIL`, `ZA141251SA_DATABASE_URL`, `ZA141251SA_SESSION_SECRET`,
`ZA141251SA_CREDENTIAL_KEY`, `ZA141251SA_BOUNTY_WORKER_ENABLED` (keep unset until
ready), `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST`.
`ZA141251SA_GITHUB_TOKEN` is reported present on Railway; it must also be a
GitHub repository secret for the Actions worker.

**Owner routes to call:** `POST /api/session/login`, then
`POST /api/bounty/programs`, then `POST /api/bounty/programs/:id/scope`,
then `PATCH /api/bounty/programs/:id` with `active: true`. Verify with the GET
routes in §6.

**Platforms to look up before registering scope:**

1. Immunefi (in-scope assets, rules, reward range)
2. Code4rena (contest scope and commit, contest rules)
3. Sherlock (contest scope and commit, contest rules)
4. HackerOne (scope table, policy)
5. Bugcrowd (target list with in/out-of-scope tags, rules)

Record each verification date in `lastVerifiedAt`.
