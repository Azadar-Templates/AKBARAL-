# Private mission chat worker

This implements an **opt-in, text-only** Google Gemini worker. It is separate from AKBARAL! customer services, accounts and money. It does not run tools, browse, purchase resources, transfer payments or treat a message as a command. No worker or real provider call was enabled during implementation/testing.

## Owner and operator prerequisites

1. Migrate the private mission database (migration 0014 preserves existing messages and does not enqueue old history).
2. Configure a legitimate Google credential in the private encrypted vault, with `model.call` scope. Assign and provision an API resource to the intended active mission agent, with explicit `requests` and `tokens` limits and evidenced initial usage.
3. Fund that agent's private wallet with legitimate recorded funds and set a positive spend budget. Review policy caps and approval thresholds. The worker refuses calls requiring additional owner spend approval; it never invents approval.
4. Review current provider pricing, account permissions and provider-side billing limits. Supply an explicit conservative `maxCostCents` and `costBasis` through **Agent messages → Configure automatic replies**, or `POST /api/agents/:id/chat-config`. The stored cap is an **internal reservation**, not independently verified pricing or a provider-enforced hard billing cap. Provider model availability has not been live-verified.
5. The supported fixed model is `gemini-2.5-flash` at Google's fixed `generateContent` endpoint. Input bytes and maximum output tokens are bounded; thinking is disabled. No configurable endpoint, tool, grounding operation, redirect or credential in a URL is allowed.
6. Enable mission autonomous support activity only after reviewing these controls. Enable the agent's configuration. This creates no provider account and retroactively queues no messages.
7. Run the separate operator process with the **same private mission database and vault key**, after explicitly opting in:

   ```sh
   ZA141251SA_CHAT_WORKER_ENABLED=true npm run mission:chat-worker
   ```

   This command can incur real provider charges once eligible jobs and valid credentials exist. Do not run it merely to verify installation. The worker refuses startup without the opt-in, owner/vault configuration and applicable identity lock. SIGINT/SIGTERM cooperatively abort an in-flight request; abort is not proof of provider cancellation.

## Durable behavior

- Only newly stored owner messages after per-agent opt-in enqueue jobs, atomically with the message/audit. Idempotent message replay and model/agent replies do not enqueue additional jobs.
- One worker claims a queued job inside the mission transaction. The corresponding quota and financial reservations are atomic. Provider I/O occurs outside database locks.
- Active policy, agent, tool permission, credential scope, resource/credential binding and wallet authority are checked before dispatch. A configuration change blocks pending jobs and withholds in-flight results when observed before delivery.
- Actual provider usage and response identity are required. Missing usage, timeouts, interrupted workers and unknown failures retain exposure and do not generate a reply. A provider safety refusal with known usage records the usage without presenting a successful deliverable.
- A real adapter response is appended as an agent message only after quota settlement and current authority checks. Reply persistence is transactional. A crash after provider completion but before reply persistence can lose the reply; the worker **does not call the provider again** to hide that uncertainty.
- Recovery marks interrupted jobs for owner review; only an unstarted call can release its holds automatically. Blocked/interrupted jobs are not retried automatically. An owner may send a new request after reviewing why the prior one failed, but should not resend unknown external operations blindly.
- Model usage does **not** establish an invoice or financial charge. The financial hold remains until the owner separately records an actual charge/zero-charge receipt under **Tools → Resource calls**. This updates private accounting, not an external payment. If an evidenced charge is unfunded, accounting fails atomically and retains the hold until the owner addresses funding.

## Owner API

- `GET/POST /api/agents/:id/chat-config`: explicit configuration, owner-only. Required fields: `enabled`, `resourceId`, `walletId`, `model`, `maxInputBytes` (128–48000), `maxOutputTokens` (64–4096), `maxCostCents` (1–1000000), `costBasis` (12–1000 characters).
- `GET /api/agents/:id/chat-jobs?before=<message-seq>&limit=50`: bounded, stable job history with no internal configuration snapshot. Agent and read-only links cannot access these controls.
- Message reads expose `automaticRepliesConfigured` separately from the legacy `automaticReplies: false` synchronous/no-immediate-response indicator. Neither configuration nor the dashboard proves a live worker; the configuration endpoint explicitly reports `workerLivenessVerified: false`.
- No HTTP endpoint accepts an adapter, provider URL, executable, actor impersonation or raw call-dispatch instruction.

## Verification limits

Tests use synthetic adapters/HTTP responses and isolated test wallets, never real keys or money. PostgreSQL parity is recorded separately in `IMPLEMENTATION_PROGRESS.md`. This feature does not automatically wrap other existing provider paths, renew subscriptions, prove earnings, establish worker uptime or demonstrate a production deployment. Provider access, current prices and deployed runtime behavior require authorized external verification.
