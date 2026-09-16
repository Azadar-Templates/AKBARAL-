/**
 * Production audit for the 4,000+ agent registry and model catalog.
 *
 * Run:  npm run audit:registry                 (human report, exits 1 on a broken contract)
 *       npm run audit:registry -- --json       (machine-readable, one verdict per agent)
 *       npm run audit:registry -- --json --out=registry-audit.json
 *
 * Two jobs:
 *
 *  1. CATALOG INTEGRITY (unchanged): the catalog is not N names — every
 *     definition has a distinct specialization/instruction/workflow contract
 *     and meaningful domain diversity, and the DB row count matches it.
 *
 *  2. PER-AGENT EXECUTABILITY VERDICT (Section 12 of the final build scope):
 *     for every registered agent, validate its definition, category, lifecycle
 *     state, workflow, permissions, tool compatibility, routing compatibility,
 *     failure handling, verification rules and audit hooks — then say what it
 *     ACTUALLY is *today*, in this environment:
 *
 *       ACTIVE               every requirement is satisfied and every declared
 *                            dependency resolves right now
 *       NEEDS_CONFIGURATION  it would work, a credential is missing
 *       MISSING_DEPENDENCY   it needs a handler/integration that is not built
 *       BLOCKED              it is deliberately not executable (lifecycle state,
 *                            unroutable category, disabled)
 *       FAILED               its own contract is broken (no workflow, no
 *                            verification rules, no definition, no DB row)
 *
 *     The verdict is NOT a complement to being in the database: an agent that
 *     merely exists and cannot execute is reported as such. Precedence is
 *     FAILED → BLOCKED → MISSING_DEPENDENCY → NEEDS_CONFIGURATION → ACTIVE.
 *
 * Exits 1 when an agent's contract is FAILED (or the catalog check fails) so
 * the audit can gate CI. `--allow-degraded` reports without failing, for
 * environments that are intentionally unconfigured (a laptop, a preview).
 */
import fs from 'node:fs';
import { db } from '../src/db';
import { generateAgentDefinitions, agentDefinitionCount } from '../src/agents/catalog';
import { PROVIDER_SPECS, MODEL_SPECS } from '../src/models/catalog';
import { listImplementedTools } from '../src/tools';
import { listCategorySlugs } from '../src/agents/catalog';
import { listSpecializationKeys } from '../src/agents/catalog';

type Verdict = 'ACTIVE' | 'NEEDS_CONFIGURATION' | 'MISSING_DEPENDENCY' | 'BLOCKED' | 'FAILED';

interface AgentVerdict {
  slug: string;
  name: string;
  category: string;
  status: string;
  verdict: Verdict;
  reasons: string[];
  checks: {
    definition: boolean;
    category: boolean;
    lifecycle: boolean;
    workflow: boolean;
    permissions: boolean;
    toolCompatibility: boolean;
    routing: boolean;
    failureHandling: boolean;
    verification: boolean;
    auditLogging: boolean;
  };
  declaredTools: string[];
}

interface RegistryAuditReport {
  generatedAt: string;
  environment: { nodeEnv: string; database: string };
  catalog: Record<string, number | boolean>;
  totals: {
    registered: number;
    verdicts: Record<Verdict, number>;
    activeShare: number;
  };
  dependencySummary: Record<string, number>;
  agents: AgentVerdict[];
}

function uniqueCount<T>(values: T[]): number {
  return new Set(values.map((value) => JSON.stringify(value))).size;
}

function argValue(flag: string): string | null {
  const prefix = `${flag}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

/**
 * Evaluate one agent. `tools`/`categories`/`roles` come from the live database,
 * `implementedTools` from the tool registry, so every claim is checkable.
 */
function evaluateAgent(input: {
  slug: string;
  name: string;
  categorySlug: string;
  status: string;
  systemInstructions: string;
  workflow: string[];
  verificationRules: string[];
  fallbackStrategy: string;
  toolPermissions: string[];
  capabilities: string[];
  modelRequirements: string[];
  validCategories: Set<string>;
  toolCredentials: Map<string, string[]>;
  implementedTools: Set<string>;
  providerConfigured: Map<string, boolean>;
  hasAuditTables: boolean;
}): AgentVerdict {
  const reasons: string[] = [];
  let verdict: Verdict = 'ACTIVE';

  const escalate = (next: Verdict, reason: string): void => {
    const order: Verdict[] = ['ACTIVE', 'NEEDS_CONFIGURATION', 'MISSING_DEPENDENCY', 'BLOCKED', 'FAILED'];
    reasons.push(reason);
    if (order.indexOf(next) > order.indexOf(verdict)) verdict = next;
  };

  // 1. definition — a real contract, not an empty shell
  const definition = Boolean(input.slug && input.name && input.systemInstructions.length >= 40 && input.capabilities.length > 0);
  if (!definition) escalate('FAILED', 'definition incomplete: name/instructions/capabilities missing');

  // 2. category — must resolve to a real registry category
  const category = input.validCategories.has(input.categorySlug);
  if (!category) escalate('FAILED', `category "${input.categorySlug}" is not a registry category`);

  // 3. lifecycle — only 'active' is executable
  const lifecycle = input.status === 'active';
  if (!lifecycle) escalate('BLOCKED', `lifecycle state is "${input.status}"`);

  // 4. workflow — an agent with no executable steps cannot run
  const workflow = Array.isArray(input.workflow) && input.workflow.length >= 4;
  if (!workflow) escalate('FAILED', `workflow has ${input.workflow?.length ?? 0} step(s); at least 4 are required`);

  // 5. permissions — declared tool permissions must be sane strings
  const permissions = Array.isArray(input.toolPermissions) && input.toolPermissions.every((tool) => typeof tool === 'string' && /^[a-z_]+$/.test(tool));
  if (!permissions) escalate('FAILED', 'tool permissions are malformed');

  // 6. tool compatibility — every declared tool must have a handler; a handler
  //    that needs a credential must have it, otherwise the agent will fail at
  //    execution time and that is a configuration fact, not a broken contract.
  let toolCompatibility = true;
  for (const tool of input.toolPermissions) {
    if (!input.implementedTools.has(tool)) {
      toolCompatibility = false;
      escalate('MISSING_DEPENDENCY', `tool "${tool}" has no handler in the tool registry`);
      continue;
    }
    if (input.toolCredentials.has(tool)) {
      const missing = (input.toolCredentials.get(tool) ?? []).filter((key) => key !== '');
      if (missing.length > 0) {
        toolCompatibility = false;
        escalate('NEEDS_CONFIGURATION', `tool "${tool}" requires ${missing.join(', ')}`);
      }
    }
  }

  // 7. routing — the planner routes by category/specialization; a routable
  //    agent must declare the model capabilities it needs, and every model
  //    provider it names must be configured (or the run cannot start).
  let routing = workflow && category && lifecycle;
  for (const requirement of input.modelRequirements) {
    const configured = input.providerConfigured.get(requirement);
    if (configured === false) {
      routing = false;
      escalate('NEEDS_CONFIGURATION', `model capability "${requirement}" has no configured provider`);
    }
  }
  if (!routing && verdict === 'ACTIVE') escalate('BLOCKED', 'agent is not routable in its current state');

  // 8. failure handling — an agent with no fallback strategy has no defined
  //    behaviour when its provider or tool fails.
  const failureHandling = Boolean(input.fallbackStrategy && input.fallbackStrategy.trim().length > 0);
  if (!failureHandling) escalate('FAILED', 'no fallback strategy (undefined behaviour on failure)');

  // 9. verification — the verifier gates completion on these rules
  const verification = Array.isArray(input.verificationRules) && input.verificationRules.length > 0;
  if (!verification) escalate('FAILED', 'no verification rules (output could never be verified)');

  // 10. audit logging — execution/audit tables must exist for a run to be
  //     observable; without them the agent's work would be invisible.
  if (!input.hasAuditTables) escalate('FAILED', 'audit/execution tables are missing');

  return {
    slug: input.slug,
    name: input.name,
    category: input.categorySlug,
    status: input.status,
    verdict,
    reasons,
    checks: {
      definition,
      category,
      lifecycle,
      workflow,
      permissions,
      toolCompatibility,
      routing,
      failureHandling,
      verification,
      auditLogging: input.hasAuditTables,
    },
    declaredTools: input.toolPermissions,
  };
}

function main(): void {
  const asJson = hasFlag('--json');
  const allowDegraded = hasFlag('--allow-degraded');
  const outPath = argValue('--out');

  // Operator-facing guard: an unmigrated database must produce an actionable
  // message, not a raw SQLite "no such table" traceback.
  if (!db.tableExists('agents')) {
    console.error(
      '[audit:registry] database is not initialized — run `npm run db:migrate` (and `npm run db:seed` ' +
        'for the registry) against DATABASE_URL before auditing.',
    );
    process.exit(1);
  }

  const definitions = generateAgentDefinitions();
  const dbCount = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM agents')?.count ?? 0;

  const uniqueSlugs = new Set(definitions.map((d) => d.slug)).size;
  const uniqueInstructions = new Set(definitions.map((d) => d.systemInstructions)).size;
  const uniqueCapabilitySets = uniqueCount(definitions.map((d) => d.capabilities));
  const uniqueToolSets = uniqueCount(definitions.map((d) => d.toolPermissions));
  const uniqueWorkflowSets = uniqueCount(definitions.map((d) => d.workflow));
  const uniqueVerificationSets = uniqueCount(definitions.map((d) => d.verificationRules));
  const uniqueModelRequirementSets = uniqueCount(definitions.map((d) => d.modelRequirements));
  const uniqueCostSets = uniqueCount(definitions.map((d) => d.costUsage));
  const uniqueFallbackSets = uniqueCount(definitions.map((d) => d.fallbackStrategy));
  const uniqueApiRequirementSets = uniqueCount(definitions.map((d) => d.apiRequirements));
  const uniqueFullContracts = uniqueCount(
    definitions.map((d) => ({
      capabilities: d.capabilities,
      tools: d.toolPermissions,
      workflow: d.workflow,
      verification: d.verificationRules,
      security: d.securityPermissions,
      model: d.modelRequirements,
      api: d.apiRequirements,
      cost: d.costUsage,
      fallback: d.fallbackStrategy,
      inputs: d.inputs,
      outputs: d.outputs,
    })),
  );
  const versionCount = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM agent_versions')?.count ?? 0;
  const dbSlugCount = db.get<{ count: number }>('SELECT COUNT(DISTINCT slug) AS count FROM agents')?.count ?? 0;

  const distinctDomains = new Set(definitions.map((d) => d.categorySlug)).size;
  const distinctSpecializations = new Set(definitions.map((d) => `${d.categorySlug}|${d.specialization}`)).size;
  const allNonEmpty = definitions.every(
    (d) => d.name && d.slug && d.specialization && d.systemInstructions && d.capabilities.length > 0 && d.workflow.length >= 4,
  );

  // ── per-agent verdict pass ────────────────────────────────────────────────
  const validCategories = new Set(listCategorySlugs());
  const implementedTools = new Set(listImplementedTools());
  const toolCredentials = new Map<string, string[]>();
  for (const row of db.all<{ key: string; required_credential_env_key: string | null }>(
    'SELECT key, required_credential_env_key FROM tools',
  )) {
    const keys = (row.required_credential_env_key ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .filter((key) => !process.env[key]);
    if (keys.length > 0) toolCredentials.set(row.key, keys);
  }
  // Capability → "is there a configured provider that offers it?" The answer is
  // derived from the real model catalog (capability tags × the provider's env
  // key), so an agent requiring "reasoning" is only executable when some
  // reasoning model's provider credential actually exists in this environment.
  const providerKeyConfigured = new Map<string, boolean>();
  for (const provider of PROVIDER_SPECS) providerKeyConfigured.set(provider.key, Boolean(process.env[provider.envKey]));
  const providerConfigured = new Map<string, boolean>();
  const capabilityProviders = new Map<string, Set<string>>();
  for (const model of MODEL_SPECS) {
    for (const capability of model.capabilities) {
      const bucket = capabilityProviders.get(capability) ?? new Set<string>();
      bucket.add(model.providerKey);
      capabilityProviders.set(capability, bucket);
    }
  }
  for (const [capability, providers] of capabilityProviders) {
    providerConfigured.set(capability, [...providers].some((provider) => providerKeyConfigured.get(provider) === true));
  }
  const hasAuditTables =
    db.tableExists('agent_executions') && db.tableExists('agent_execution_logs') && db.tableExists('audit_logs');
  const validRoles = new Set(listSpecializationKeys());

  const rows = db.all<{
    slug: string;
    name: string;
    category_id: string | null;
    status: string;
    config: string | null;
  }>('SELECT slug, name, category_id, status, config FROM agents');

  const categoryById = new Map(
    db.all<{ id: string; slug: string }>('SELECT id, slug FROM agent_categories').map((row) => [row.id, row.slug]),
  );

  const verdicts: AgentVerdict[] = [];
  const dependencySummary: Record<string, number> = {};
  for (const row of rows) {
    const definition = definitions.find((d) => d.slug === row.slug);
    const config = (() => {
      try {
        return JSON.parse(row.config ?? '{}') as { workflow?: string[]; verificationRules?: string[]; toolPermissions?: string[]; capabilities?: string[]; modelRequirements?: string[]; fallbackStrategy?: string; systemInstructions?: string };
      } catch {
        return {} as Record<string, never>;
      }
    })();
    const verdict = evaluateAgent({
      slug: row.slug,
      name: row.name,
      categorySlug: categoryById.get(String(row.category_id)) ?? 'unknown',
      status: row.status,
      systemInstructions: String(config.systemInstructions ?? definition?.systemInstructions ?? ''),
      workflow: config.workflow ?? definition?.workflow ?? [],
      verificationRules: config.verificationRules ?? definition?.verificationRules ?? [],
      fallbackStrategy: config.fallbackStrategy ?? definition?.fallbackStrategy ?? '',
      toolPermissions: config.toolPermissions ?? definition?.toolPermissions ?? [],
      capabilities: config.capabilities ?? definition?.capabilities ?? [],
      modelRequirements: config.modelRequirements ?? definition?.modelRequirements ?? [],
      validCategories,
      toolCredentials,
      implementedTools,
      providerConfigured,
      hasAuditTables,
    });
    verdicts.push(verdict);
    for (const reason of verdict.reasons) {
      if (verdict.verdict === 'NEEDS_CONFIGURATION' || verdict.verdict === 'MISSING_DEPENDENCY') {
        const key = reason.replace(/^.*requires /, '').slice(0, 80);
        dependencySummary[key] = (dependencySummary[key] ?? 0) + 1;
      }
    }
  }

  const tally: Record<Verdict, number> = { ACTIVE: 0, NEEDS_CONFIGURATION: 0, MISSING_DEPENDENCY: 0, BLOCKED: 0, FAILED: 0 };
  for (const verdict of verdicts) tally[verdict.verdict] += 1;

  const catalog = {
    definitions: definitions.length,
    expectedCount: agentDefinitionCount(),
    databaseRows: dbCount,
    databaseDistinctSlugs: dbSlugCount,
    versions: versionCount,
    uniqueSlugs,
    uniqueSystemInstructions: uniqueInstructions,
    uniqueCapabilitySets,
    uniqueToolSets,
    uniqueWorkflowSets,
    uniqueVerificationSets,
    uniqueModelRequirementSets,
    uniqueCostSets,
    uniqueFallbackSets,
    uniqueApiRequirementSets,
    uniqueFullContracts,
    distinctDomains,
    distinctSpecializations,
    distinctSpecializationRoles: validRoles.size,
    allDefinitionsNonEmpty: allNonEmpty,
  };

  const contractOk =
    definitions.length >= 4000 &&
    dbCount >= 4000 &&
    dbSlugCount >= 4000 &&
    uniqueSlugs === definitions.length &&
    uniqueFullContracts === definitions.length &&
    allNonEmpty &&
    definitions.every((d) => Boolean(d.fallbackStrategy) && d.costUsage?.estimatedCents >= 0 && d.evaluationConfig?.metrics?.length > 0);

  const report: RegistryAuditReport = {
    generatedAt: new Date().toISOString(),
    environment: { nodeEnv: process.env.NODE_ENV ?? 'development', database: process.env.DATABASE_URL ?? '(default)' },
    catalog,
    totals: {
      registered: verdicts.length,
      verdicts: tally,
      activeShare: verdicts.length > 0 ? Number((tally.ACTIVE / verdicts.length).toFixed(4)) : 0,
    },
    dependencySummary,
    agents: verdicts,
  };

  if (asJson) {
    const payload = JSON.stringify(report, null, 2);
    if (outPath) {
      fs.writeFileSync(outPath, `${payload}\n`);
      console.log(`[audit:registry] machine-readable report written to ${outPath}`);
    } else {
      process.stdout.write(`${payload}\n`);
    }
  } else {
    console.log('[audit:registry]');
    console.log(`  generated definitions      : ${definitions.length}`);
    console.log(`  database agent rows         : ${dbCount}`);
    console.log(`  expected count              : ${agentDefinitionCount()}`);
    console.log(`  unique slugs                : ${uniqueSlugs}`);
    console.log(`  unique system instructions   : ${uniqueInstructions}`);
    console.log(`  unique capability sets      : ${uniqueCapabilitySets}`);
    console.log(`  unique tool sets            : ${uniqueToolSets}`);
    console.log(`  unique workflow sets        : ${uniqueWorkflowSets}`);
    console.log(`  unique verification sets    : ${uniqueVerificationSets}`);
    console.log(`  unique model-requirement sets: ${uniqueModelRequirementSets}`);
    console.log(`  unique cost-metadata sets    : ${uniqueCostSets}`);
    console.log(`  unique fallback sets         : ${uniqueFallbackSets}`);
    console.log(`  unique api-requirement sets  : ${uniqueApiRequirementSets}`);
    console.log(`  unique full agent contracts : ${uniqueFullContracts}`);
    console.log(`  distinct domain blueprints  : ${distinctDomains}`);
    console.log(`  distinct specializations    : ${distinctSpecializations}`);
    console.log(`  all definitions non-empty   : ${allNonEmpty}`);
    console.log(`  database distinct slugs      : ${dbSlugCount}`);
    console.log(`  agent version rows          : ${versionCount}`);
    console.log(`  provider env keys           : ${PROVIDER_SPECS.map((p) => `${p.key}=${p.envKey}`).join(', ')}`);
    console.log(`  model catalog               : ${MODEL_SPECS.length} models (${MODEL_SPECS.map((m) => m.key).join(', ')})`);

    const sample = [definitions[0], definitions[100], definitions[3999]];
    console.log('\n  samples:');
    for (const d of sample) {
      console.log(`    ${d.slug} | ${d.name} | tools=${d.toolPermissions.join(',')} | model=${d.modelRequirements.join(',')} | workflow=${d.workflow.length} steps`);
    }

    // ── executability, stated per agent and in aggregate ────────────────────
    console.log('\n  executability (contract validated, dependencies resolved against THIS environment):');
    for (const key of ['ACTIVE', 'NEEDS_CONFIGURATION', 'MISSING_DEPENDENCY', 'BLOCKED', 'FAILED'] as Verdict[]) {
      const share = verdicts.length > 0 ? ((tally[key] / verdicts.length) * 100).toFixed(1) : '0.0';
      console.log(`    ${key.padEnd(20)} ${String(tally[key]).padStart(6)}  (${share}%)`);
    }
    const topDependencies = Object.entries(dependencySummary).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (topDependencies.length > 0) {
      console.log('\n  unmet dependencies blocking execution:');
      for (const [dependency, count] of topDependencies) {
        console.log(`    ${String(count).padStart(6)}  ${dependency}`);
      }
    }
    const failures = verdicts.filter((verdict) => verdict.verdict === 'FAILED').slice(0, 10);
    if (failures.length > 0) {
      console.log('\n  agents with a BROKEN contract (first 10):');
      for (const failure of failures) console.log(`    ${failure.slug}: ${failure.reasons.join(' | ')}`);
    }

    const ok = contractOk && tally.FAILED === 0;
    console.log(`\n[audit:registry] ${ok ? 'PASS' : 'FAIL'}${allowDegraded && !ok ? ' (degraded environment allowed)' : ''}`);
    console.log(
      `[audit:registry] note: ${tally.ACTIVE} of ${verdicts.length} agents are executable in this environment right now; ` +
        'the rest are reported above as configuration (credential), dependency (handler) or lifecycle facts — never as working.',
    );
    if (!ok && !allowDegraded) {
      db.close();
      process.exit(1);
    }
  }

  db.close();
  if (!asJson && !contractOk && !allowDegraded) process.exit(1);
  if (asJson && tally.FAILED > 0 && !allowDegraded) process.exit(1);
}

main();
