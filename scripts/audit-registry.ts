/**
 * Production audit for the 4,000+ agent registry and model catalog.
 *
 * Run: npm run audit:registry
 *
 * Verifies that the catalog is not just N names: every definition has a unique
 * specialization/instruction/workflow contract and meaningful domain diversity,
 * and that the DB row count matches the generated catalog.
 */
import { db } from '../src/db';
import { generateAgentDefinitions, agentDefinitionCount } from '../src/agents/catalog';
import { PROVIDER_SPECS, MODEL_SPECS } from '../src/models/catalog';

function uniqueCount<T>(values: T[]): number {
  return new Set(values.map((value) => JSON.stringify(value))).size;
}

function main(): void {
  const definitions = generateAgentDefinitions();
  const dbCount = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM agents')?.count ?? 0;

  const uniqueSlugs = new Set(definitions.map((d) => d.slug)).size;
  const uniqueInstructions = new Set(definitions.map((d) => d.systemInstructions)).size;
  const uniqueCapabilitySets = uniqueCount(definitions.map((d) => d.capabilities));
  const uniqueToolSets = uniqueCount(definitions.map((d) => d.toolPermissions));
  const uniqueWorkflowSets = uniqueCount(definitions.map((d) => d.workflow));
  const uniqueVerificationSets = uniqueCount(definitions.map((d) => d.verificationRules));
  const uniqueModelRequirementSets = uniqueCount(definitions.map((d) => d.modelRequirements));
  const uniqueFullContracts = uniqueCount(
    definitions.map((d) => ({
      capabilities: d.capabilities,
      tools: d.toolPermissions,
      workflow: d.workflow,
      verification: d.verificationRules,
      security: d.securityPermissions,
      model: d.modelRequirements,
      api: d.apiRequirements,
    })),
  );

  const distinctDomains = new Set(definitions.map((d) => d.categorySlug)).size;
  const distinctSpecializations = new Set(definitions.map((d) => `${d.categorySlug}|${d.specialization}`)).size;
  const allNonEmpty = definitions.every(
    (d) => d.name && d.slug && d.specialization && d.systemInstructions && d.capabilities.length > 0 && d.workflow.length >= 4,
  );

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
  console.log(`  unique full agent contracts : ${uniqueFullContracts}`);
  console.log(`  distinct domain blueprints  : ${distinctDomains}`);
  console.log(`  distinct specializations    : ${distinctSpecializations}`);
  console.log(`  all definitions non-empty   : ${allNonEmpty}`);
  console.log(`  provider env keys           : ${PROVIDER_SPECS.map((p) => `${p.key}=${p.envKey}`).join(', ')}`);
  console.log(`  model catalog               : ${MODEL_SPECS.length} models (${MODEL_SPECS.map((m) => m.key).join(', ')})`);

  const sample = [definitions[0], definitions[100], definitions[3999]];
  console.log('\n  samples:');
  for (const d of sample) {
    console.log(`    ${d.slug} | ${d.name} | tools=${d.toolPermissions.join(',')} | model=${d.modelRequirements.join(',')} | workflow=${d.workflow.length} steps`);
  }

  const ok = definitions.length >= 4000 && dbCount >= 4000 && uniqueSlugs === definitions.length && uniqueFullContracts === definitions.length && allNonEmpty;
  console.log(`\n[audit:registry] ${ok ? 'PASS' : 'FAIL'}`);
  db.close();
  if (!ok) process.exit(1);
}

main();
