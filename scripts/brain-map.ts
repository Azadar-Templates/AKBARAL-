/**
 * Brain / provider / API readiness report — `npm run brains`
 *
 * Prints, from the code and the live registry (never from a document):
 *   · one row per production capability: brain, provider, API, tool,
 *     credential, free/paid, status, blocker, owner action
 *   · the exact totals (agents, reasoning profiles, providers, tools,
 *     credentials required vs configured, executable vs blocked)
 *   · what must work for the public launch, for mission operation, and what
 *     can wait
 *
 * Reachability is measured, not assumed: unauthenticated probes run first and
 * every row that needs outbound access is resolved against the result. No
 * credential is read or sent by this script.
 *
 *   npx tsx scripts/brain-map.ts                 full report
 *   npx tsx scripts/brain-map.ts --json          machine readable
 *   npx tsx scripts/brain-map.ts --blockers      only what is not working
 *   npx tsx scripts/brain-map.ts --owner         only owner actions, in order
 *   npx tsx scripts/brain-map.ts --offline       skip the network probes
 */
import { brainMap, brainTotals, BRAIN_ROWS, type BrainMapEntry } from '../src/config/brain-map';
import { PROVIDER_SPECS, TOOL_SPECS } from '../src/models/catalog';
import { generateAgentDefinitions, agentDefinitionCount, AGENT_CATEGORIES } from '../src/agents/catalog';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyBlockers = args.includes('--blockers');
const onlyOwner = args.includes('--owner');
const offline = args.includes('--offline');

/** Unauthenticated HEAD/GET probes. No headers, no credentials, no bodies. */
async function probe(url: string): Promise<{ reachable: boolean; detail: string }> {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    return { reachable: true, detail: `HTTP ${response.status} in ${Date.now() - started}ms` };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error instanceof Error ? error.name : 'error');
    return { reachable: false, detail: `${cause} after ${Date.now() - started}ms` };
  }
}

const PROVIDER_PROBES: Array<[string, string]> = [
  ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models'],
  ['OpenAI', 'https://api.openai.com/v1/models'],
  ['Anthropic', 'https://api.anthropic.com/v1/models'],
  ['Stripe', 'https://api.stripe.com/v1'],
  ['GitHub', 'https://api.github.com/zen'],
];

/** Distinct reasoning configurations across the whole fleet. */
function reasoningProfiles(): Map<string, number> {
  const profiles = new Map<string, number>();
  for (const definition of generateAgentDefinitions()) {
    const key = [...definition.modelRequirements].sort().join('+') || 'none';
    profiles.set(key, (profiles.get(key) ?? 0) + 1);
  }
  return profiles;
}

function toolProfiles(): Map<string, number> {
  const profiles = new Map<string, number>();
  for (const definition of generateAgentDefinitions()) {
    const key = [...definition.toolPermissions].sort().join(',') || 'none';
    profiles.set(key, (profiles.get(key) ?? 0) + 1);
  }
  return profiles;
}

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

async function main(): Promise<void> {
  const reach = new Map<string, { reachable: boolean; detail: string }>();
  if (!offline) {
    for (const [label, url] of PROVIDER_PROBES) reach.set(label, await probe(url));
  }
  const anyReachable = [...reach.values()].some((entry) => entry.reachable);
  const entries = brainMap(process.env, anyReachable);
  const profiles = reasoningProfiles();
  const tools = toolProfiles();
  const totals = brainTotals(entries, {
    agents: agentDefinitionCount(),
    reasoningProfiles: profiles.size,
    aiProviders: PROVIDER_SPECS.length,
    toolIntegrations: TOOL_SPECS.length,
    reachableProviders: [...reach.values()].filter((entry) => entry.reachable).length,
  });

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          reachability: Object.fromEntries(reach),
          totals,
          reasoningProfiles: Object.fromEntries(profiles),
          toolProfiles: Object.fromEntries(tools),
          capabilities: entries,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (onlyOwner) {
    const actions = entries.filter((entry) => entry.ownerAction && entry.status !== 'WORKING');
    process.stdout.write('\nOWNER ACTIONS — only what Arena genuinely cannot do\n');
    process.stdout.write('═'.repeat(100) + '\n');
    const order: BrainMapEntry['launch'][] = ['AKBARAL! public launch', 'ZA141251SA mission operation', 'can be enabled later'];
    let index = 1;
    for (const group of order) {
      for (const entry of actions.filter((candidate) => candidate.launch === group)) {
        process.stdout.write(`${String(index).padStart(2)}. [${group}] ${entry.fn}\n      ${entry.ownerAction}\n`);
        index += 1;
      }
    }
    return;
  }

  process.stdout.write('\nAKBARAL! + ZA141251SA — brain / provider / API map\n');
  process.stdout.write('═'.repeat(150) + '\n');
  if (!offline) {
    process.stdout.write('Runtime reachability (unauthenticated probes, no credentials sent)\n');
    for (const [label, result] of reach) {
      process.stdout.write(`  ${result.reachable ? 'REACHABLE      ' : 'RUNTIME BLOCKED'} ${pad(label, 16)} ${result.detail}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(
    `${pad('SYSTEM', 11)}${pad('FUNCTION', 34)}${pad('BRAIN', 28)}${pad('PROVIDER', 26)}${pad('TOOL', 14)}${pad('COST', 10)}${pad('STATUS', 20)}BLOCKER\n`,
  );
  process.stdout.write('─'.repeat(150) + '\n');
  for (const entry of entries) {
    if (onlyBlockers && entry.status === 'WORKING') continue;
    process.stdout.write(
      `${pad(entry.system, 11)}${pad(entry.fn, 34)}${pad(entry.brain, 28)}${pad(entry.provider, 26)}${pad(entry.tool ?? '—', 14)}${pad(entry.cost, 10)}${pad(entry.status, 20)}${entry.blocker}\n`,
    );
  }

  process.stdout.write('\nTOTALS\n');
  process.stdout.write('─'.repeat(150) + '\n');
  const line = (label: string, value: string | number): void => {
    process.stdout.write(`  ${label.padEnd(44, '.')} ${value}\n`);
  };
  line('agent identities in the catalog', totals.agents);
  line('agent categories', AGENT_CATEGORIES.length);
  line('distinct reasoning configurations', totals.reasoningProfiles);
  line('distinct tool profiles across the fleet', tools.size);
  line('AI providers implemented', totals.aiProviders);
  line('tool integrations registered', totals.toolIntegrations);
  line('capabilities mapped', totals.capabilities);
  line('distinct external endpoints', totals.externalApis);
  line('credential names required', totals.credentialsRequired);
  line('credential names configured here', totals.credentialsConfigured);
  line('providers reachable from this runtime', offline ? 'not probed' : totals.reachableProviders);
  line('WORKING', totals.working);
  line('CODE READY', totals.codeReady);
  line('CREDENTIAL REQUIRED', totals.credentialRequired);
  line('RUNTIME BLOCKED', totals.runtimeBlocked);
  line('NOT IMPLEMENTED', totals.notImplemented);

  process.stdout.write('\nREASONING CONFIGURATIONS (capability profile → agents sharing it)\n');
  for (const [profile, count] of [...profiles].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${pad(profile, 34)} ${count} agents\n`);
  }

  process.stdout.write('\nWHAT MUST WORK, BY GROUP\n');
  process.stdout.write('─'.repeat(150) + '\n');
  for (const group of ['AKBARAL! public launch', 'ZA141251SA mission operation', 'can be enabled later'] as const) {
    const inGroup = entries.filter((entry) => entry.launch === group);
    const blocked = inGroup.filter((entry) => entry.status !== 'WORKING');
    process.stdout.write(`\n  ${group}: ${inGroup.length} capabilities, ${inGroup.length - blocked.length} working now\n`);
    for (const entry of blocked) {
      process.stdout.write(`    · ${pad(entry.fn, 40)} ${pad(entry.status, 20)} ${entry.blocker}\n`);
    }
  }
  process.stdout.write(`\n  Rows: ${BRAIN_ROWS.length}. Nothing here is hand-written status: run npx tsx --test src/config/brain-map.test.ts\n\n`);
}

void main();
