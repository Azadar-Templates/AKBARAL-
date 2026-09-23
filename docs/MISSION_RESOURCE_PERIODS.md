# Evidence-backed resource renewal accounting

**Tools → Resources → Review periods** records an already-evidenced provider billing period. It does not buy, activate or renew an external subscription. The resource's `auto_renew` field remains intent, not payment authority or evidence.

An owner must supply:

- The expected prior expiry and a current provider period: start at/after the old expiry, start no later than now, end later than now. Missing/changed expiry and overlapping or future-only periods are rejected.
- The new quota limits and an explicit actual starting value for every counter. Unknown usage must not be submitted as zero.
- An explicit actual charge, currency, provider charge reference and non-secret evidence. The amount must fit the approved resource quote and current policy. Positive costs require an authorized funded private mission wallet, including an eligible private reserve. Customer wallets are never consulted.

All reserved/dispatched/uncertain quota calls and all outstanding financial holds must be resolved first. Owner review must establish actual usage and financial evidence; expiration is not proof of cancellation or zero cost. Recording a period archives the previous usage/limits/expiry, records any evidenced charge atomically in private accounting, and starts the new cumulative counters. Old settled call receipts cannot add old usage into the new period.

Receipts are immutable and idempotent. A charge reference cannot be reused across initial provisioning, metered-call charge accounting and period renewal. If evidence cannot uniquely establish a charge/period, leave it unresolved rather than inventing a reference or receipt. Changing the approved plan/quote, paying a provider and configuring its actual billing limits remain separate authorized actions.

Owner-only endpoints:

- `GET /api/resources/:id/periods?before=<period-id>&limit=50`
- `POST /api/resources/:id/periods` with `idempotencyKey`, `expectedExpiresAt`, `periodStart`, `periodEnd`, `limits`, `startingUsage`, `actualCostCents`, `currency`, optional `walletId`, `providerRef`, `evidence`.

The API returns `externalPaymentExecuted: false` and `providerVerified: false`. A successful record can restore local quota readiness, but does not prove provider access or independent invoice verification. Automatic provider purchasing/self-funding activation is not implemented by this accounting path.
