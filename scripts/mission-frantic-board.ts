/**
 * Read the agent-native bounty board, screen it, and stop.
 *
 *   npm run board:frantic              # human-readable board + per-bounty verdicts
 *   npm run board:frantic -- --json    # the same facts, machine-readable
 *
 * This command never writes: no registration, no claim, no delivery, no payout setup, no
 * database row. Registering on a third-party venue means creating an account on the owner's
 * email and GitHub identity, and every claim gate on the board today is answered by a human
 * identity check — so the fleet's job is to report exactly which work is reachable and what
 * stands in front of it. Network egress here must reach the venue host; where it does not,
 * the command says so instead of reporting an empty board.
 */
import { createFranticBoardClient, screenFranticBounty, FranticBoardError } from '../src/mission/earning/frantic-board';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const unknown = argv.filter(entry => entry !== '--json');
if (unknown.length > 0) {
  process.stderr.write(`unknown argument: ${unknown[0]} (expected --json)\n`);
  process.exit(2);
}

function dollars(cents: number): string {
  return cents < 0 ? 'unreadable' : `$${(cents / 100).toFixed(2)}`;
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(34, '.')} ${value}\n`);
}

async function main(): Promise<void> {
try {
  const client = createFranticBoardClient();
  const read = await client.read();
  const rows = read.board.bounties.map(bounty => ({ bounty, screen: screenFranticBounty(bounty) }));
  const reachable = rows.filter(entry => entry.screen.screen === 'eligible_for_agent_work').length;
  const ownerGated = rows.filter(entry => entry.screen.screen === 'blocked_by_owner_action').length;
  const refused = rows.filter(entry => entry.screen.screen === 'refused_policy').length;
  const unclear = rows.filter(entry => entry.screen.screen === 'unverifiable').length;

  if (json) {
    process.stdout.write(`${JSON.stringify({
      asOf: read.asOf,
      board: read.board.stats,
      policy: read.policy,
      counts: { open: rows.length, reachable, ownerGated, refused, unclear },
      bounties: rows.map(({ bounty, screen }) => ({
        number: bounty.number,
        title: bounty.title,
        price_usd_cents: bounty.priceUsdCents,
        funded: bounty.funded,
        visibility: bounty.visibility,
        slots_available: bounty.slotsAvailable,
        claim_state: bounty.claim?.state ?? null,
        claim_requires: bounty.claim?.requires ?? [],
        screen: screen.screen,
        reasons: screen.reasons,
        evidence: screen.evidence,
        owner_actions: screen.ownerActions,
      })),
    }, null, 2)}\n`);
    process.exit(0);
  }

  process.stdout.write('\nagent-native bounty board — read-only survey, nothing claimed\n');
  process.stdout.write('═'.repeat(78) + '\n');
  const stats = read.board.stats as Record<string, unknown>;
  line('board open / day', `${String(stats.bounties_open ?? rows.length)} open · day ${String(stats.day ?? '?')}`);
  line('venue money moved', stats.moved_usd !== undefined ? `$${Number(stats.moved_usd).toFixed(2)} settled on the public ledger` : 'not reported');
  line('operators / sworn', `${String(stats.operators_enlisted ?? '?')} enlisted · ${String(stats.sworn_count ?? '?')} sworn`);
  line('economy (from /v1/policy)', read.policy.rentCentsPerDay === null
    ? 'unavailable'
    : `clock rent ${dollars(read.policy.rentCentsPerDay)}/day · welcome runway ${read.policy.welcomeRunwayDays ?? '?'}d · cap ${read.policy.maxRunwayDays ?? '?'}d (venue states it never charges the agent)`);
  line('verdicts', `${reachable} agent-work ready · ${ownerGated} blocked on an owner action · ${refused} refused by policy · ${unclear} unverifiable`);

  for (const { bounty, screen } of rows) {
    process.stdout.write(`\n  #${bounty.number} ${bounty.title}\n`);
    process.stdout.write(`      ${dollars(bounty.priceUsdCents)} · ${bounty.slotsAvailable} open slot(s) · ${bounty.visibility} · funded=${bounty.funded ? 'yes' : 'no'} · claim=${bounty.claim?.state ?? 'unknown'}\n`);
    process.stdout.write(`      screen: ${screen.screen}${screen.reasons.length ? ` · ${screen.reasons.join(', ')}` : ''}\n`);
    for (const evidence of screen.evidence.slice(0, 3)) process.stdout.write(`        · ${evidence.slice(0, 160)}\n`);
    for (const action of screen.ownerActions) process.stdout.write(`      owner action: ${action}\n`);
  }
  process.stdout.write('\n  Nothing was registered, claimed or delivered. A claim needs the owner\u2019s\n'
    + '  verified identity on the venue; the mirrored GitHub issues are not the contract there.\n\n');
} catch (error) {
  const code = error instanceof FranticBoardError ? error.code : 'frantic_transport_failure';
  const detail = error instanceof Error ? error.message : String(error);
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, code, detail: detail.slice(0, 200) }, null, 2)}\n`);
  else process.stdout.write(`\n  board unavailable: ${code} (${detail.slice(0, 160)})\n`
    + '  this host may not have egress to the venue; report it as unverified, never as an empty board\n\n');
  process.exitCode = 1;
}
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`board probe failed: ${detail.slice(0, 200)}\n`);
  process.exitCode = 1;
});
