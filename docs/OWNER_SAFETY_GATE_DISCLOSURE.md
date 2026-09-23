# OWNER-SAFETY / LIABILITY GATE — Risk Disclosure

**Date:** 2026-09-20
**Applies to:** All mission agents, earning connectors, and money movement before provider identity is connected
**Single identity in scope:** `zanaveed555@gmail.com` (Pakistan, Asia/Karachi) — the only owner identity the mission will ever use. Provider readiness API (`/api/settings/provider-readiness`) is the sole source of truth for activation state.

This document is a technical description of what the gate **does**, what it **does not do**, and which **external risks remain**. It does not provide legal advice and it does not claim 100% immunity from liability.

---

## 1. What the gate enforces (technical, fail-closed)

All agent actions that touch identity, money, platform scope, verification, or credentials pass through a single function: `authorizeAgentAction()` in `src/mission/owner-safety-gate.ts`.

The gate is **fail-closed**: if it cannot positively establish authorization, compliance and scope, it returns `allowed=false` with `ownerActionRequired=true` and records an immutable `OWNER_ACTION_REQUIRED` trail row. Unknown scopes are denied (`unknown_scope`).

Before any state mutation, the gate checks in this order:

| # | Check | Source of truth | Violation code |
|---|-------|-----------------|----------------|
| 0 | Kill switch (`policy.killSwitch`) | `src/mission/policy.ts` | `prohibited_activity` |
| 0b | Agent liveness/paused (`mission_agents.status`) | DB | `account_access` / `policy_violation_continuation` |
| 0c | Continuation after a recent violation (`mission_safety_violations` within 10 min) | DB | `policy_violation_continuation` |
| 1 | Prohibited / restricted activities hard deny-list | `policy.ts: PROHIBITED_ACTIVITY_KEYS` + `checkActivity()` | `prohibited_activity` + specific (`fake_identity`, `kyc_aml_bypass`, `sanctions`, `spam`) |
| 2 | KYC / identity document fabrication — only owner may create/alter via official connector flow | `KYC_KEY_PATTERN` + payload scan | `kyc_fabrication` → `fake_identity` |
| 3 | KYC/AML bypass, sanctions evasion, platform ToS bypass | payload scan + `SANCTIONS_COUNTRIES` list | `kyc_aml_bypass`, `sanctions` |
| 4 | Impersonation outside explicitly authorized account activity | `payloadClaimsOwnerIdentity()` + `ZA141251SA_OWNER_EMAIL` | `impersonation` |
| 5 | Fraudulent jobs / orders / reviews / transactions | action/payload scan | `fraudulent_job` |
| 6 | Legal / financial obligations outside approved connector contract | `platform-connectors.ts: findConnector()` | `legal_obligation` |
| 7 | Connector status & readiness (`requiresOwnerAccount`, `humanOnlyActions`, `apiPermitted`, `status`) | `platform-connectors.ts` + `provider-capability-registry.ts` | `prohibited_activity` / `unknown_scope` |
| 8 | Spam / bulk abuse | `SPAM_TRIGGERS` | `spam` |
| 9 | Hidden failure suppression | action scan | `hidden_failure` |
| 10 | False verification without independent provider evidence | `providerResponse.providerRef` + `externalId` required | `false_verification` |
| 11 | Money movement without wallet / policy authorization (`canAgentSpend`, `requireApprovalAboveCents`, `requireOwnerForPayout`) | `policy.ts:canAgentSpend()` + `mission_wallets` | `unauthorized_transfer` / `unauthorized_purchase` |
| 12 | Cross-agent / cross-account / cross-mission / credential access | `targetAgentId`, `targetAccountId`, `mission_credentials` vault | `account_access` |
| 13 | KYC / credential / private-info leak | `SECRET_KEY_PATTERN` + exfiltration markers | `credential_leak` |
| 14 | Unknown scope (connector not in registry, no task context) | `OPPORTUNITY_REGISTRY` + `findConnector()` | `unknown_scope` |

If the actor is `owner`, the gate allows after the prohibited check. No agent can impersonate the owner without the owner having explicitly delegated via `mission_credentials` with `ownerId`.

Every decision is appended to `mission_authorization_trail` (hash-chained `seq|prev_hash|hash`) and every denial also appends to `mission_safety_violations` and `mission_audit`. All three chains are verifiable via `verifyAuthorizationTrail()`, `verifySafetyViolations()`, and `verifyMissionAudit()`.

### KYC fabrication block

- There is **no agent tool** that writes KYC documents. `authorizeAgentAction` denies any `agent` actor where `action` or payload contains KYC keys (`kyc`, `passport`, `cnic`, `selfie`, `identity_document`, etc.) with `kyc_fabrication`.
- The only path that writes identity material is owner-authenticated:
  - `POST /api/credentials` (vault, AES-256-GCM, key `ZA141251SA_CREDENTIAL_KEY`)
  - `PATCH /api/payout-slots` (verified destination, owner attestation)
- `mission_kyc_submissions` (migration `0032_owner_safety_gate.sql`) is owner-only by application policy; direct agent INSERT is blocked by the gate and by `assertMoneyOwner` / `isIdentityPermitted`.

### Independent provider evidence for settlement

- `execution-pipeline.ts` enforces `provider_confirmed → settlement_verified`:
  1. `confirmProviderPayment` requires `providerRef` (provider webhook / bank reference) and marks `provider_confirmed`.
  2. `settleExecution` calls `settlement-verification.ts: verifySettlementAgainstProvider()` which requires `externalId` + `providerRef` + rail to be independently verified before any ledger credit. No estimate, listing, or agent claim is accepted.
- `authorizeAgentAction` separately denies `false_verification` when a `verification.claim` or `settlement.request` lacks `providerResponse.externalId` / `providerRef`.

### Vault scoping

- An agent may only use its own wallet (`mission_wallets` where `agent_id = actor`) and its own credential. `walletId` must resolve to the caller's agent; `targetAgentId` / `targetAccountId` referencing another agent is denied as `account_access`.
- Direct API credential reads (`mission_credentials`) are decrypted only in-process via `decryptCredential()` and never returned in API responses (masked hint only).

---

## 2. How failures are handled

- **Violation → immediate stop.** The denying gate writes `mission_authorization_trail` with `decision='owner_action_required'`, writes `mission_safety_violations` (hash-chained, `prev_hash`), writes `mission_audit`, pauses the agent (`policy_violation_continuation` for 10 min), and returns an error that the caller must surface. No continuation is permitted until the owner reviews via `clearSafetyViolation()` (audit-only, does not delete the immutable rows).
- **No hiding.** `hidden_failure` (suppress/delete/cover_up) is a deny-list. All provider failures and retries are recorded via `mission_provider_failures` and `mission_failed_learnings` with exponential backoff, not suppressed.
- **Owner action queue.** `countPendingOwnerActions()` counts `owner_action_required` trails for the dashboard.

## 3. What is still **not** protected (residual risk)

The gate is a **technical enforcement layer**. It does not eliminate exposure to:

- **Provider ToS and platform risk.** Even autonomous-approved connectors (`direct_client_research`, `direct_ai_implementation`, etc.) operate under the provider's terms (e.g., Upwork automated-bidding prohibition, PayPal not available for Pakistan local balance, Fiverr identity rules). A provider may suspend an owner account after manual review, even if the gate allowed. `provider-readiness.ts` and `platform-connectors.ts:officialUrl` must be checked at activation time.
- **Legal, tax and sanctions risk.** The gate blocks known sanctions markers and fake identities, but it is not a sanctions-screening service or a law firm. Tax withholding, KYC/AML, and export-control obligations remain the owner's responsibility and vary by jurisdiction. Using only `zanaveed555@gmail.com` and only owner-connected accounts does not guarantee compliance in every jurisdiction.
- **Financial risk.** Settlement verification requires a live bank/payout proof; until that proof arrives, there is no revenue. The engine never fabricates customers/leads/jobs/orders/reviews. Market risk (no bidders, no clients) remains.
- **Security risk.** Secrets are encrypted at rest (AES-256-GCM) and redacted in audit (`redactForAudit`), but the sandbox, OS, or provider could still be compromised. The audit trail is tamper-evident (hash chain), not tamper-proof against a DB operator with write access outside the application.
- **Agent error risk.** A fresh policy violation blocks the violating agent, but other agents continue. A provider may still see failed or incorrect deliveries as breaches of a client contract — the gate records the failure, it does not unwind a signed SOW.
- **No legal immunity claim.** This disclosure explicitly **does not claim 100% immunity** from liability. It describes implemented controls; it does not warrant that using the platform will never incur civil, regulatory, or contractual exposure.

## 4. Operational guarantees

- **Preserved:** `REAL_WORLD_ACTIVATION_CHECKLIST.md` (736 lines, 36 `EARNING_SOURCE` candidates), `earning-engine.ts` hardening (no revenue without `provider_confirmed → settlement_verified`), verified-money ledger (`mission_db` hash-chained), identity-lock (single owner identity), and 124/124 existing subtest regressions. No destructive cleanup was performed.
- **Append-only:** `mission_audit` + `mission_authorization_trail` + `mission_safety_violations` are insert-only and verified end-to-end (see `adversarial-safety.test.ts: immutable/auditable trail` which tampers and re-verifies). `mission_kyc_submissions` is owner-only append.
- **Maximal autonomy preserved:** Connectors with `requiresOwnerAccount=false` and `status=ACTIVE` (e.g., `direct_client_research`) remain fully autonomous through `execution → verification (2×0.85) → provider_confirmed → settlement_verified` without human steps, as proven by `adversarial-safety.test.ts: normal permitted work remains fully autonomous`.

## 5. How to verify

```bash
# Migrations
npx tsx -e "import('./src/mission/database').then(m=>m.applyMissionMigrations()).then(r=>console.log(r))"
# Expect total 32 including 0032_owner_safety_gate.sql

# Gate unit + adversarial proof (must be 0 failures to ship)
npx tsx --test src/mission/adversarial-safety.test.ts
# Expect 21/21 pass: 13 prohibitions + fail-closed unknown_scope + continuation + immutable trail + humanOnly + settlement evidence + amount + pipeline

# Regressions
npx tsx --test src/mission/earning/execution-pipeline.test.ts
npx tsx --test src/mission/earning/earning-engine.test.ts
npx tsx --test src/mission/mission-server.test.ts
```

All three regressions must show `pass` before the branch is merged.

---

**Contact for review:** Owner account only — any new provider account must be created manually by the owner at the provider's official URL and connected via the vault; agents never create accounts.
