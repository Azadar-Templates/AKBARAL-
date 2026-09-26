# ZA141251SA — Mission preview authentication (verified 2026-09-26)

Commit: `618933e` · Branch: `arena/01a0dd85-akbaral` (pushed)

## Owner identity

- Configured owner: `zanaveed555@gmail.com` — the only identity that can authenticate or read mission data.
- Credential storage: scrypt (N=16384, r=8, p=1, 16-byte random salt) in `mission_owner.password_hash`. No plaintext anywhere.
- The password is **not** in `.mission-secrets.env`, source, fixtures, frontend JS, logs, test artifacts or this report. `ZA141251SA_OWNER_PASSWORD` was deleted from the secrets file after provisioning.
- Identity-lock sweep suspended the previous placeholder account `owner@za141251sa.local` (status `suspended`). Owner rows = 2, authenticatable identities = 1.
- Leak scan: `grep -rF <password>` over the repo → 0 files; `strings data/mission.db | grep -cF <password>` → 0.

## Setting/rotating the password

```bash
set -a && . ./.mission-secrets.env && set +a
npm run mission:set-owner-password        # prompts on a TTY, or accepts a piped value
```

The script (`scripts/mission-set-owner-password.ts`) reads the secret from stdin only — never argv, never an env file, never echoed. Minimum 12 characters. It hashes with scrypt, then re-runs `enforceIdentityLock()`.

## Browser verification — `scripts/testing/mission-auth-verify.mjs`

Real Chromium against `http://127.0.0.1:4200` (mission) and `http://127.0.0.1:3000` (public). 10/10 PASS on three consecutive runs. Screenshots + `result.json` in `logs/browser/mission-auth/` (password scrubbed from all output).

| # | Check | Result |
|---|-------|--------|
| 1 | Preview loads signed out (`ZA141251SA — Mission Control`, "not signed in") | PASS |
| 2 | Different email denied — *"this deployment is restricted to its configured mission identity…"* | PASS |
| 3 | Owner email + wrong password denied — *"invalid credentials"* | PASS |
| 4 | Owner signs in, private dashboard opens (11 tabs, "signed in as zanaveed555@gmail.com") | PASS |
| 5 | Hard refresh keeps the authenticated session | PASS |
| 6 | Sign out returns to the sign-in panel and clears session storage | PASS |
| 7 | Refresh after logout does not restore the dashboard | PASS |
| 8 | Owner can sign in again | PASS |
| 9 | Same-origin probe from the public tier: `/api/boss/overview`, `/api/boss/agents`, `/api/boss/treasury`, `/api/boss/scheduler`, `/api/mission`, `/api/za141251sa`, `/api/treasury`, `/api/wallets`, `/mission` → all **404** | PASS |
| 10 | Public navigation and page copy contain no mission link or reference | PASS |

Unit/regression tests re-run for this change: `mission-identity-lock`, `mission-core`, `database-isolation`, `mission-server`, `app/mission-isolation` → **73/73 pass**.

Verified revenue on the mission dashboard remains **0.00 USD** (0 verified receipts).
