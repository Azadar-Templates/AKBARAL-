/** Explicitly enabled private worker. No customer DB, tool execution or payments. */
import { setTimeout as pause } from 'node:timers/promises';
import { applyMissionMigrations, missionDb } from '../src/mission/database';
import { ownerCount, vaultConfigured } from '../src/mission/auth';
import { enforceIdentityLock, identityLockEnabled, identityLockVerified } from '../src/mission/identity-lock';
import { runNextAgentChat } from '../src/mission/chat-worker';
import { invokeGoogleChat, chatDispatchReadiness, markLiveChatAdapter } from '../src/mission/chat-provider';

async function main() {
  if (process.env.ZA141251SA_CHAT_WORKER_ENABLED !== 'true') throw new Error('private chat worker is disabled; explicit operator opt-in is required');
  const readiness = chatDispatchReadiness();
  if (!readiness.dispatchable) throw new Error(`chat dispatch is closed: ${readiness.blockers.join(' ')}`);
  process.stdout.write(`Chat dispatch mode: ${readiness.mode} (model ${readiness.model}).\n`);
  applyMissionMigrations();
  enforceIdentityLock();
  if (!ownerCount() || !vaultConfigured() || (identityLockEnabled() && !identityLockVerified().ok)) throw new Error('private owner identity and credential vault must be configured');
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdout.write('Private mission chat worker started. Only new opted-in owner messages are eligible; no tools or payment execution.\n');
  // Tagged so the per-job billing gate still applies through the wrapper.
  const liveAdapter = markLiveChatAdapter((permit, signal, request) => invokeGoogleChat(permit, AbortSignal.any([signal, shutdown.signal]), request));
  try {
    while (!shutdown.signal.aborted) {
      const job = await runNextAgentChat(liveAdapter);
      if (!job) await pause(2000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  } finally { missionDb.close(); }
}
main().catch(() => {
  // Provider/runtime errors may contain secrets. Details remain controlled codes
  // in durable job state; never dump an SDK error or a decrypted credential.
  process.stderr.write('Private chat worker stopped or refused startup. Verified vendor billing must be implemented; also review owner/vault configuration and durable job state.\n');
  missionDb.close(); process.exitCode = 1;
});
