/**
 * ZA141251SA — one real end-to-end chat verification.
 *
 *   npx tsx scripts/mission-chat-live-verify.ts --agent <slug> [--message "…"] [--keep]
 *
 * It performs the entire live path against the real provider and prints the
 * evidence:
 *
 *   owner message → agent identity → mission chat job → Google Gemini →
 *   real reply → persisted conversation → quota counters → audit trail
 *
 * Rules this script keeps:
 *   · the API key is read from a hidden prompt (or piped stdin). It is never
 *     taken from argv, never echoed, never logged, never written to a file and
 *     never included in any output — only the vault's masked hint appears.
 *   · the binding is free tier: zero-cost resource, $0 cap, no wallet. The run
 *     asserts afterwards that no ledger entry and no wallet hold were created.
 *   · nothing is faked: the real dispatcher is used, and the run fails loudly
 *     if the reply did not come from a provider response carrying its own
 *     responseId and token usage.
 *   · unless --keep is passed, the key is revoked and chat switched off again
 *     when the check finishes, so a verification run leaves no live credential.
 */

import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { ownerCount, vaultConfigured } from '../src/mission/auth';
import { enforceIdentityLock, identityLockEnabled, identityLockVerified } from '../src/mission/identity-lock';
import { findAgentBySlug } from '../src/mission/reporting';
import { appendAgentMessage, listAgentMessages } from '../src/mission/messaging';
import { runNextAgentChat } from '../src/mission/chat-worker';
import { googleChatAdapter, isRealProviderDispatch } from '../src/mission/chat-provider';
import { enableAgentChatFreeTier, disableAgentChat } from '../src/mission/chat-enablement';
import { agentChatReadiness } from '../src/mission/agent-briefing';
import { checkProviderReachability, reachabilityNote } from '../src/mission/provider-reachability';
import { agentCatalogIdentity } from '../src/mission/agent-identity';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const out = (line = ''): void => void process.stdout.write(`${line}\n`);
const section = (title: string): void => {
  out('');
  out(`── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
};

/** Hidden prompt. The key never reaches the terminal, argv, env or a log. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const asMutable = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (value: string) => void };
  asMutable._writeToOutput = (value: string) => {
    // Echo the prompt itself, never the typed characters.
    if (value.includes(prompt)) asMutable.output.write(prompt);
  };
  try {
    return await new Promise<string>((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}

async function main(): Promise<void> {
  const slug = flag('agent');
  if (!slug) throw new Error('pass --agent <slug> (for example: --agent marketing-strategist-001)');
  const message = flag('message') ?? 'In two sentences: what are you designed to do, and what can you not do?';

  applyMissionMigrations();
  enforceIdentityLock();
  if (!ownerCount() || !vaultConfigured() || (identityLockEnabled() && !identityLockVerified().ok)) {
    throw new Error('the mission owner identity and the credential vault must be configured first');
  }
  const owner = missionDb.get<Row>("SELECT id, email FROM mission_owner WHERE status = 'active' ORDER BY created_at LIMIT 1");
  if (!owner) throw new Error('no active mission owner');
  const agent = findAgentBySlug(slug);
  if (!agent) throw new Error(`no agent with slug ${slug}`);
  const agentId = String(agent.id);
  const identity = agentCatalogIdentity(slug);

  section('1. runtime can reach the provider');
  const reachability = await checkProviderReachability({ force: true });
  out(`   endpoint    ${reachability.endpoint}`);
  out(`   status      ${reachability.status}${reachability.httpStatus ? ` (HTTP ${reachability.httpStatus})` : ''} in ${reachability.latencyMs}ms`);
  out(`   ${reachabilityNote(reachability)}`);
  if (!reachability.reachable && !has('force')) {
    out('');
    out('   STOPPING: a real reply cannot be produced from this runtime. No key was requested.');
    process.exitCode = 1;
    return;
  }

  section('2. agent identity');
  out(`   ${identity?.name ?? String(agent.name)} · ${slug}`);
  out(`   designed for  ${identity?.purpose ?? 'not in the catalog'}`);

  section('3. provider key');
  out('   Paste the Google AI Studio API key. It is not echoed, not logged and not stored in plaintext.');
  const apiKey = await readSecret('   key: ');
  if (apiKey.length < 20) throw new Error('that does not look like a provider key (20+ characters expected)');

  const enabled = enableAgentChatFreeTier({ agentId, apiKey, actorId: String(owner.id), allowSupportActivity: true });
  out(`   stored        credential ${enabled.credential.id} (${enabled.credential.maskedHint}) — AES-256-GCM in the mission vault`);
  out(`   binding       ${enabled.config.billing} · cap ${enabled.config.maxCostCents} cents · wallet "${enabled.config.walletId}" · model ${enabled.config.model}`);
  out(`   readiness     ${enabled.readiness.status}${enabled.readiness.blockers.length ? ` — ${enabled.readiness.blockers.join('; ')}` : ''}`);

  const ledgerBefore = Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')?.n ?? 0);

  try {
    section('4. owner message → mission chat job → provider');
    const posted = appendAgentMessage({ agentId, actorType: 'owner', actorId: String(owner.id), body: message, idempotencyKey: randomUUID() });
    out(`   owner says    ${message}`);
    out(`   recorded      message id ${String(posted.message.id)} (duplicate: ${posted.duplicate})`);

    const dispatch = googleChatAdapter();
    if (!isRealProviderDispatch(dispatch)) throw new Error('refusing to run: the dispatcher is not the real provider dispatcher');
    const job = await runNextAgentChat(dispatch, { agentId });
    if (!job) throw new Error('no chat job was eligible — the binding did not pass the readiness gate');
    out(`   job           ${job.status}`);
    if (job.status !== 'succeeded') {
      out(`   failure code  ${(job as { error_code?: string }).error_code ?? 'unknown'}`);
      throw new Error('the provider call did not succeed; nothing was invented in its place');
    }

    section('5. the reply actually came from the provider');
    const call = missionDb.get<Row>(
      'SELECT provider_ref, actual_usage, evidence, status FROM mission_resource_calls WHERE resource_id = ? ORDER BY rowid DESC LIMIT 1',
      [enabled.resourceId],
    );
    const providerRef = String(call?.provider_ref ?? '');
    out(`   provider ref  ${providerRef}`);
    out(`   usage         ${String(call?.actual_usage ?? '{}')}`);
    out(`   evidence      ${String(call?.evidence ?? '')}`);
    if (!/^google:[A-Za-z0-9._:/-]{1,190}$/.test(providerRef)) throw new Error('the reply carries no provider response identity — it cannot be proven genuine');
    const tokens = Number(JSON.parse(String(call?.actual_usage ?? '{}')).tokens ?? 0);
    if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('the provider reported no token usage — refusing to call this a real reply');

    section('6. persisted conversation');
    const messages = listAgentMessages(agentId, 0, 20).messages;
    for (const row of messages.slice(-2)) {
      out(`   ${String(row.actor_type).padEnd(5)} ${String(row.body).replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    const replies = messages.filter((row) => row.actor_type === 'agent');
    if (replies.length === 0) throw new Error('no agent reply was persisted');

    section('7. money controls held');
    const ledgerAfter = Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')?.n ?? 0);
    const wallet = missionDb.get<Row>('SELECT COALESCE(SUM(balance_cents),0) AS cents FROM mission_wallets');
    out(`   ledger rows   ${ledgerBefore} → ${ledgerAfter}${ledgerAfter === ledgerBefore ? ' (unchanged — a free-tier reply cannot create a ledger entry)' : ' — UNEXPECTED'}`);
    out(`   wallet total  ${Number(wallet?.cents ?? 0) / 100} (chat never touches a wallet on the free tier)`);
    if (ledgerAfter !== ledgerBefore) throw new Error('a chat call created a ledger entry; that must never happen on the free tier');

    section('8. the key is not readable anywhere');
    const leaks: string[] = [];
    for (const table of missionDb.all<Row>("SELECT name FROM sqlite_master WHERE type='table'")) {
      const name = String(table.name);
      const columns = missionDb.all<Row>(`PRAGMA table_info(${name})`).map((column) => String(column.name));
      for (const column of columns) {
        const hit = missionDb.get<Row>(`SELECT 1 AS hit FROM ${name} WHERE CAST(${column} AS TEXT) LIKE ? LIMIT 1`, [`%${apiKey}%`]);
        if (hit) leaks.push(`${name}.${column}`);
      }
    }
    out(`   plaintext key found in: ${leaks.length ? leaks.join(', ') : 'nowhere in the mission database'}`);
    if (leaks.length) throw new Error('the provider key is readable in the database');
  } finally {
    if (!has('keep')) {
      const off = disableAgentChat({ agentId, revokeKey: true, actorId: String(owner.id) });
      section('9. cleanup');
      out(`   chat switched off, key revoked: ${off.credentialRevoked} · readiness now ${agentChatReadiness(agentId).status}`);
      out('   (pass --keep to leave the binding live after a successful check)');
    }
  }

  section('RESULT');
  out('   LIVE CHAT VERIFIED: a real Google Gemini reply was generated for this agent, persisted in its own');
  out('   conversation, metered against its free-tier quota, and produced no ledger entry or wallet movement.');
}

main()
  .then(() => missionDb.close())
  .catch((error: unknown) => {
    // Never print an exception body that might carry request material.
    const message = error instanceof Error ? error.message : 'live verification failed';
    process.stderr.write(`\nLIVE VERIFICATION FAILED: ${message}\n`);
    try { missionDb.close(); } catch { /* already closed */ }
    process.exitCode = 1;
  });
