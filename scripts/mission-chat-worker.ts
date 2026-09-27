/** Explicitly enabled private worker. No customer DB, tool execution or payments. */
import { setTimeout as pause } from 'node:timers/promises';
import { applyMissionMigrations, missionDb } from '../src/mission/database';
import { ownerCount, vaultConfigured } from '../src/mission/auth';
import { enforceIdentityLock, identityLockEnabled, identityLockVerified } from '../src/mission/identity-lock';
import { runNextAgentChat } from '../src/mission/chat-worker';
import { googleChatAdapter } from '../src/mission/chat-provider';

async function main() {
  if (process.env.ZA141251SA_CHAT_WORKER_ENABLED !== 'true') throw new Error('private chat worker is disabled; explicit operator opt-in is required');
  // Billing authority is checked per job against its own binding: free-tier
  // bindings (zero cost, no wallet) dispatch; metered bindings stay blocked
  // until a verified vendor billing adapter exists.
  applyMissionMigrations();
  enforceIdentityLock();
  if (!ownerCount() || !vaultConfigured() || (identityLockEnabled() && !identityLockVerified().ok)) throw new Error('private owner identity and credential vault must be configured');
  const shutdown = new AbortController();
  const provider = googleChatAdapter();
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const dispatch = Object.defineProperty(
    ((permit, signal, request) => provider(permit, AbortSignal.any([signal, shutdown.signal]), request)) as typeof provider,
    Symbol.for('za141251sa.real_provider_dispatch'),
    { value: true },
  );
  process.stdout.write('Private mission chat worker started. Only new opted-in owner messages are eligible; no tools or payment execution.\n');
  try {
    while (!shutdown.signal.aborted) {
      const job = await runNextAgentChat(dispatch);
      if (!job) await pause(2000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  } finally { missionDb.close(); }
}
main().catch(() => {
  // Provider/runtime errors may contain secrets. Details remain controlled codes
  // in durable job state; never dump an SDK error or a decrypted credential.
  process.stderr.write('Private chat worker stopped or refused startup. Review owner/vault configuration, the agent chat binding and durable job state.\n');
  missionDb.close(); process.exitCode = 1;
});
