// ─────────────────────────────────────────────────────────────────────────────
// Brain / provider / API map
//
// For every production capability in AKBARAL! and ZA141251SA this answers the
// same ten questions:
//
//   what performs the reasoning · which model/provider · which API · which tool
//   · which data source · which credential · configured now · reachable now ·
//   free or paid · what breaks without it
//
// Every row points at the source symbol that actually performs the work.
// brain-map.test.ts fails the build when a component file or exported symbol
// does not exist, when a tool key is not in the model catalog, or when an env
// var is missing from the dependency matrix. A row therefore cannot claim a
// capability the code does not have.
//
// Status is COMPUTED, never written down: it comes from whether the required
// variables are set in the environment being inspected and whether the
// provider host is reachable from this runtime.
// ─────────────────────────────────────────────────────────────────────────────

import { DEPENDENCY_ROWS } from './dependency-matrix';

/** What actually produces the answer. */
export type BrainKind =
  /** A language model chosen at runtime by src/models/router.ts. */
  | 'LLM (AKBARAL model router)'
  /** A language model called directly, one fixed endpoint. */
  | 'LLM (direct provider call)'
  /** Rules, scoring or arithmetic in our own code. No model involved. */
  | 'deterministic engine'
  /** A third-party API is the authority; we only call and record it. */
  | 'external API'
  /** Only a human can perform it (consent, KYC, bank login). */
  | 'owner action'
  /** Storage/transport with no decision logic. */
  | 'infrastructure';

export type CostClass = 'FREE' | 'FREE TIER' | 'PAID' | 'OWNER PAYMENT REQUIRED' | 'OPTIONAL';

export type LaunchGroup =
  | 'AKBARAL! public launch'
  | 'ZA141251SA mission operation'
  | 'can be enabled later';

/** Project status vocabulary. Nothing else may be used. */
export type BrainStatus =
  | 'WORKING'
  | 'CODE READY'
  | 'CREDENTIAL REQUIRED'
  | 'RUNTIME BLOCKED'
  | 'NOT IMPLEMENTED';

export interface BrainRow {
  system: 'AKBARAL!' | 'ZA141251SA';
  /** Capability name, as the owner asked for it. */
  fn: string;
  /** Source file that performs it, relative to the repository root. */
  component: string;
  /** Exported symbol inside that file. */
  symbol: string;
  brain: BrainKind;
  /** Vendor, or 'none (own code)'. */
  provider: string;
  /** Concrete endpoint or protocol, null when nothing leaves the process. */
  api: string | null;
  /** Tool key from src/models/catalog.ts TOOL_SPECS, when a tool is involved. */
  tool: string | null;
  /** Database or store that holds its data. */
  dataSource: string;
  /**
   * Environment variables required for the capability to do its real job.
   * A nested array means "any one of these" (alternatives).
   */
  requires: Array<string | string[]>;
  /** True when the capability must open an outbound connection. */
  egress: boolean;
  cost: CostClass;
  launch: LaunchGroup;
  /** Exact behaviour when the credential is absent. Never "it fails". */
  degraded: string;
  /** What only the owner can do, '' when nothing. */
  ownerAction: string;
  /** Test or script that proves the path, '' when only reachable code exists. */
  verifiedBy: string;
}

const NO_ENV: Array<string | string[]> = [];
/** One LLM credential — any of these unlocks every routed reasoning step. */
const ANY_LLM: Array<string | string[]> = [['GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OMNIROUTE_API_KEY']];

export const BRAIN_ROWS: BrainRow[] = [
  // ── AKBARAL! — reasoning core ───────────────────────────────────────────
  {
    system: 'AKBARAL!', fn: 'Goal understanding', component: 'src/orchestrator/goal-analyzer.ts', symbol: 'analyzeGoal',
    brain: 'LLM (AKBARAL model router)', provider: 'Google / OpenAI / Anthropic / OmniRoute (whichever is configured)',
    api: 'POST {provider}/…:generateContent | /v1/chat/completions | /v1/messages', tool: null,
    dataSource: 'AKBARAL! SQLite/Postgres (agent_categories, agents)', requires: ANY_LLM, egress: true,
    cost: 'FREE TIER', launch: 'AKBARAL! public launch',
    degraded: 'Falls back to deterministic keyword analysis (mode="heuristic"); categories and roles still resolve, nuance is lost.',
    ownerAction: 'Create one free Google AI Studio key and store it as GOOGLE_API_KEY.',
    verifiedBy: 'src/orchestrator/goal-analyzer.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Intent classification', component: 'src/orchestrator/goal-analyzer.ts', symbol: 'analyzeGoal',
    brain: 'LLM (AKBARAL model router)', provider: 'routed LLM', api: 'provider chat endpoint', tool: null,
    dataSource: 'category + role registry', requires: ANY_LLM, egress: true, cost: 'FREE TIER',
    launch: 'AKBARAL! public launch',
    degraded: 'Keyword intent rules still classify the goal; prompt-injection guard and slug validation run in both modes.',
    ownerAction: '', verifiedBy: 'src/orchestrator/goal-analyzer.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Planner', component: 'src/orchestrator/planner.ts', symbol: 'createExecutionPlan',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'agents, agent_versions', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: planning is pure code and never needs a provider.',
    ownerAction: '', verifiedBy: 'src/orchestrator/master-flow.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'MASTER orchestrator', component: 'src/orchestrator/executor.ts', symbol: 'dispatchAgentExecution',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'tasks, agent_executions, execution_logs', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Orchestration runs; the specialist step inside it fails honestly with provider_not_configured and the free credit is refunded.',
    ownerAction: '', verifiedBy: 'src/orchestrator/executor.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Agent router / agent selection', component: 'src/orchestrator/planner.ts', symbol: 'selectBestAgent',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'agents (4,001 rows), agent_categories (80)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: selection is capability//category scoring over the registry.',
    ownerAction: '', verifiedBy: 'src/orchestrator/master-flow.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Model/provider routing', component: 'src/models/router.ts', symbol: 'ModelRouter',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'models (12), model_providers (4)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Routing still scores models; every candidate reports available=false and the aggregated error names every accepted env var.',
    ownerAction: '', verifiedBy: 'src/models/router.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Specialist agent reasoning', component: 'src/orchestrator/executor.ts', symbol: 'createAgentTask',
    brain: 'LLM (AKBARAL model router)', provider: 'routed LLM', api: 'provider chat endpoint', tool: null,
    dataSource: 'agent_versions.system_instructions', requires: ANY_LLM, egress: true, cost: 'FREE TIER',
    launch: 'AKBARAL! public launch',
    degraded: 'No output is produced: the run fails with provider_not_configured and the consumed credit is refunded. No fabricated answer.',
    ownerAction: 'Provide one LLM key.', verifiedBy: 'src/orchestrator/executor.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Multi-agent orchestration', component: 'src/orchestrator/workflow-runner.ts', symbol: 'runWorkflow',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'workflows, workflow_steps', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Step sequencing runs; each step that needs a model fails honestly and the workflow records the failure.',
    ownerAction: '', verifiedBy: 'src/orchestrator/master-flow.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Tool selection', component: 'src/orchestrator/executor.ts', symbol: 'dispatchAgentExecution',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'agent_tools (per-agent permissions)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: at most two permitted pre-stage tools run; an unavailable tool is logged and skipped, never faked.',
    ownerAction: '', verifiedBy: 'src/orchestrator/tool-stage.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Tool execution', component: 'src/tools/registry.ts', symbol: 'runTool',
    brain: 'deterministic engine', provider: 'none (own code) + per-tool vendors', api: null, tool: null,
    dataSource: 'tools (18 registered, 18 implemented)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Credential-free tools run; credential tools return a typed "missing credential" result naming the env var.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },

  // ── AKBARAL! — research and knowledge ──────────────────────────────────
  {
    system: 'AKBARAL!', fn: 'Web search', component: 'src/agents/search-providers.ts', symbol: 'resolveSearchProvider',
    brain: 'external API', provider: 'Wikipedia (keyless, free) by default; Tavily / Brave / Serper / Google CSE when a key exists',
    api: 'https://en.wikipedia.org/w/api.php | https://api.tavily.com | https://api.search.brave.com | https://google.serper.dev | https://www.googleapis.com/customsearch/v1',
    tool: 'web_search', dataSource: 'none (live web)',
    requires: NO_ENV,
    egress: true, cost: 'FREE', launch: 'AKBARAL! public launch',
    degraded: 'No credential is needed: the default provider is the free keyless Wikipedia API (encyclopaedic sources only, not a general web index). Zero results are reported as zero, never invented.',
    ownerAction: 'Nothing to buy. A keyed provider (Tavily/Brave/Serper) adds general web coverage and should be funded from verified mission revenue, not upfront.',
    verifiedBy: 'src/agents/search-providers.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Page fetching', component: 'src/agents/web-research.ts', symbol: 'fetchPage',
    brain: 'external API', provider: 'the page host itself', api: 'GET {public URL} (SSRF-guarded)', tool: 'page_fetch',
    dataSource: 'none (live web)', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing to configure; without outbound access every fetch reports a transport error.',
    ownerAction: '', verifiedBy: 'src/agents/web-research.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Web research report', component: 'src/agents/web-research.ts', symbol: 'createResearchReport',
    brain: 'deterministic engine', provider: 'search provider + page hosts', api: 'search + fetch', tool: 'web_search',
    dataSource: 'research_reports', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Report is assembled from whatever sources were really retrieved; with no sources it says so instead of summarising nothing.',
    ownerAction: '', verifiedBy: 'src/agents/web-research.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Knowledge search', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: 'knowledge_search',
    dataSource: 'knowledge_documents (indexed uploads)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: local index. Empty index returns zero results explicitly.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Code repository analysis', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: 'code_repository_read',
    dataSource: 'workspace files (path-confined)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: reads are confined to the workspace root.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Documents / file parsing', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: 'file_parse_text',
    dataSource: 'uploaded files under AKBARAL_UPLOAD_DIR', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: text/CSV/JSON parsing is local.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Data analysis', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: 'text_analyze',
    dataSource: 'request payload', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch', degraded: 'Nothing: local computation.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Excel / spreadsheet output', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: 'excel_build',
    dataSource: 'artifacts', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch', degraded: 'Nothing: CSV/sheet assembly is local.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },

  // ── AKBARAL! — media ────────────────────────────────────────────────────
  {
    system: 'AKBARAL!', fn: 'Image generation', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'OpenAI (DALL·E 3)', api: 'POST https://api.openai.com/v1/images/generations',
    tool: 'image_render', dataSource: 'artifacts', requires: ['OPENAI_API_KEY'], egress: true,
    cost: 'PAID', launch: 'can be enabled later',
    degraded: 'The tool returns "missing credential OPENAI_API_KEY"; no placeholder image is produced.',
    ownerAction: 'Add a paid OpenAI key if image generation is wanted (no free tier exists for DALL·E 3).',
    verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Image request approval workflow', component: 'src/workforce/images.ts', symbol: 'fulfillImageRequest',
    brain: 'deterministic engine', provider: 'OpenAI (on fulfilment)', api: 'images/generations', tool: 'image_render',
    dataSource: 'image_requests', requires: ['OPENAI_API_KEY'], egress: true, cost: 'PAID',
    launch: 'can be enabled later',
    degraded: 'Requests can be created and approved; fulfilment reports the missing credential instead of returning an image.',
    ownerAction: '', verifiedBy: 'src/workforce/images.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Video generation', component: 'src/models/catalog.ts', symbol: 'PROVIDER_SPECS',
    brain: 'external API', provider: 'none implemented', api: null, tool: null,
    dataSource: 'n/a', requires: NO_ENV, egress: false, cost: 'OPTIONAL', launch: 'can be enabled later',
    degraded: 'NOT IMPLEMENTED: no video model, adapter or tool exists. The catalog declares a video capability type but registers no video model.',
    ownerAction: '', verifiedBy: '',
  },
  {
    system: 'AKBARAL!', fn: 'Video publishing', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'YouTube Data API v3',
    api: 'POST https://www.googleapis.com/upload/youtube/v3/videos', tool: 'youtube_publish',
    dataSource: 'social_connections', requires: ['YOUTUBE_ACCESS_TOKEN'], egress: true, cost: 'FREE TIER',
    launch: 'can be enabled later',
    degraded: 'Tool reports the missing token; nothing is published and no success is recorded.',
    ownerAction: 'Complete Google OAuth consent for the YouTube account.',
    verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Audio / speech / OCR', component: 'src/models/catalog.ts', symbol: 'MODEL_SPECS',
    brain: 'external API', provider: 'none implemented', api: null, tool: null, dataSource: 'n/a',
    requires: NO_ENV, egress: false, cost: 'OPTIONAL', launch: 'can be enabled later',
    degraded: 'NOT IMPLEMENTED: no speech, transcription or OCR model is registered and no adapter exists.',
    ownerAction: '', verifiedBy: '',
  },
  {
    system: 'AKBARAL!', fn: 'Translation', component: 'src/orchestrator/executor.ts', symbol: 'createAgentTask',
    brain: 'LLM (AKBARAL model router)', provider: 'routed LLM', api: 'provider chat endpoint', tool: null,
    dataSource: 'agent instructions', requires: ANY_LLM, egress: true, cost: 'FREE TIER',
    launch: 'can be enabled later',
    degraded: 'Handled by translation-specialist agents through the ordinary model path; no dedicated translation API is integrated.',
    ownerAction: '', verifiedBy: 'src/orchestrator/executor.test.ts',
  },

  // ── AKBARAL! — domain agents (business, marketing, SEO, …) ─────────────
  {
    system: 'AKBARAL!', fn: 'Business / Marketing / SEO / Social / Ecommerce / Finance-info / Legal-info / Health-info / Travel / Jobs / Support domains',
    component: 'src/agents/catalog.ts', symbol: 'generateAgentDefinitions',
    brain: 'LLM (AKBARAL model router)', provider: 'routed LLM', api: 'provider chat endpoint', tool: null,
    dataSource: 'agents (80 domain categories × 50 specialisations + 1 MASTER = 4,001)',
    requires: ANY_LLM, egress: true, cost: 'FREE TIER', launch: 'AKBARAL! public launch',
    degraded: 'All 80 domains share ONE reasoning path. Without a key every domain agent fails identically and honestly.',
    ownerAction: '', verifiedBy: 'src/agents/registry.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Maps / places', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'Google Maps Places',
    api: 'GET https://maps.googleapis.com/maps/api/place/textsearch/json', tool: 'maps_place',
    dataSource: 'none (live API)', requires: ['GOOGLE_API_KEY'], egress: true, cost: 'PAID',
    launch: 'can be enabled later',
    degraded: 'Tool reports the missing credential. Note: Places billing is separate from the Gemini free tier — the same GOOGLE_API_KEY only works if Places is enabled on a billed project.',
    ownerAction: 'Enable the Places API on a billed Google Cloud project if maps are wanted.',
    verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Ecommerce operations', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'Shopify Admin API',
    api: 'POST https://{shop}/admin/api/2024-01/products.json', tool: 'shopify_product',
    dataSource: 'merchant store', requires: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'], egress: true,
    cost: 'OWNER PAYMENT REQUIRED', launch: 'can be enabled later',
    degraded: 'Tool reports both missing variables; no store is contacted.',
    ownerAction: 'Own or connect a Shopify store (paid plan).', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Social posting', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'X API v2 / Instagram Graph',
    api: 'POST https://api.x.com/2/tweets · POST https://graph.facebook.com/v21.0/me/media',
    tool: 'x_post', dataSource: 'social_connections', requires: [['X_BEARER_TOKEN', 'INSTAGRAM_ACCESS_TOKEN']],
    egress: true, cost: 'OWNER PAYMENT REQUIRED', launch: 'can be enabled later',
    degraded: 'Tools report the missing token. X API v2 write access is a paid tier; Instagram needs a reviewed Meta app.',
    ownerAction: 'Create the developer app and complete OAuth.', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Messaging / SMS', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'Twilio',
    api: 'POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json', tool: 'twilio_message',
    dataSource: 'none', requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], egress: true,
    cost: 'OWNER PAYMENT REQUIRED', launch: 'can be enabled later',
    degraded: 'Tool reports the missing credentials; no message is sent or logged as sent.',
    ownerAction: 'Fund a Twilio account if SMS is wanted.', verifiedBy: 'src/tools/tools.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Generic HTTP integration', component: 'src/tools/registry.ts', symbol: 'TOOL_HANDLERS',
    brain: 'external API', provider: 'any public endpoint', api: 'GET/POST {public URL} (SSRF-guarded)',
    tool: 'http_request', dataSource: 'none', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing to configure; private/loopback targets are refused by the SSRF guard.',
    ownerAction: '', verifiedBy: 'src/tools/tools.test.ts',
  },

  // ── AKBARAL! — lifecycle, verification, recovery ───────────────────────
  {
    system: 'AKBARAL!', fn: 'Output verification', component: 'src/orchestrator/verifier.ts', symbol: 'verifyAgentOutput',
    brain: 'deterministic engine', provider: 'optional routed LLM for the rubric pass', api: 'provider chat endpoint',
    tool: null, dataSource: 'agent verification_rules', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Contract checks always run without any provider. The optional LLM rubric pass is skipped and unparseable rubric output never overrides the contract result.',
    ownerAction: '', verifiedBy: 'src/orchestrator/verifier.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Task outcome generation', component: 'src/orchestrator/synthesizer.ts', symbol: 'synthesizeFinalResult',
    brain: 'deterministic engine', provider: 'optional routed LLM', api: 'provider chat endpoint', tool: null,
    dataSource: 'agent_executions, artifacts', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Assembles the real step outputs structurally (mode="deterministic"); it never invents content that no step produced.',
    ownerAction: '', verifiedBy: 'src/orchestrator/synthesizer.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Error recovery', component: 'src/orchestrator/recovery.ts', symbol: 'recoverInterruptedWork',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'tasks, agent_executions', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: interrupted runs are reconciled on boot from database state.',
    ownerAction: '', verifiedBy: 'src/orchestrator/recovery.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Provider fallback', component: 'src/models/router.ts', symbol: 'ModelRouter',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'models, model_runs', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'The chain walks every configured provider, distinguishes retryable (429/5xx/timeout) from permanent (4xx) failures, and aggregates the unconfigured ones into one honest error.',
    ownerAction: '', verifiedBy: 'src/models/provider-hardening.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Task lifecycle / queue', component: 'src/orchestrator/queue.ts', symbol: 'executionQueue',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'tasks, execution queue tables', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: in-process queue with database-backed state and reconciliation.',
    ownerAction: '', verifiedBy: 'src/orchestrator/queue.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Custom agent builder (Agent Factory)', component: 'src/orchestrator/agent-factory.ts', symbol: 'agentFactory',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'agents, agent_versions (owner-scoped)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing: templates and validation are local. The built agent needs the same LLM key to run.',
    ownerAction: '', verifiedBy: 'src/orchestrator/factory.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Automations / scheduling', component: 'src/workforce/scheduler.ts', symbol: 'workforceScheduler',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'automations, workforce tables', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Schedules fire in-process; each triggered run needs whatever its own step needs.',
    ownerAction: '', verifiedBy: 'src/workforce/workforce.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Realtime execution stream', component: 'src/realtime/execution-stream.ts', symbol: 'ExecutionStream',
    brain: 'infrastructure', provider: 'none (own code)', api: 'WebSocket /ws or SSE fallback', tool: null,
    dataSource: 'in-memory per execution', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'AKBARAL_REALTIME_TRANSPORT=sse switches to SSE for hosts whose proxy drops WebSocket upgrades.',
    ownerAction: '', verifiedBy: 'src/realtime/execution-stream.test.ts',
  },

  // ── AKBARAL! — accounts, money, comms ──────────────────────────────────
  {
    system: 'AKBARAL!', fn: 'Email (verification, password reset, notifications)', component: 'src/integrations/smtp.ts', symbol: 'sendEmail',
    brain: 'external API', provider: 'any SMTP host (Gmail app password, Brevo, Resend SMTP…)',
    api: 'SMTP over TLS/STARTTLS', tool: null, dataSource: 'email_verifications, password_resets',
    requires: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'], egress: true, cost: 'FREE TIER',
    launch: 'AKBARAL! public launch',
    degraded: 'Signup still works, but no verification, reset or notification email leaves the system: sendEmail throws EmailDeliveryNotConfiguredError and the UI says email is not configured.',
    ownerAction: 'Create a free SMTP sender and set the three variables, then send one real test email.',
    verifiedBy: 'src/integrations/smtp.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'OAuth sign-in buttons', component: 'src/auth/oauth.ts', symbol: 'listOAuthProviders',
    brain: 'external API', provider: 'Google, GitHub, Microsoft, Facebook, Apple',
    api: 'authorize + token + userinfo endpoints per provider', tool: null, dataSource: 'users, oauth_identities',
    requires: [['GOOGLE_CLIENT_ID', 'GITHUB_CLIENT_ID', 'MS_CLIENT_ID', 'FACEBOOK_CLIENT_ID', 'APPLE_CLIENT_ID']],
    egress: true, cost: 'FREE', launch: 'AKBARAL! public launch',
    degraded: 'Unconfigured providers are reported as unavailable and the UI renders them disabled — the button is never a dead click.',
    ownerAction: 'Register an OAuth client per provider and set the client id/secret pair.',
    verifiedBy: 'src/routes/auth.international-registration.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Customer payments / subscriptions', component: 'src/billing/providers.ts', symbol: 'createStripeCheckout',
    brain: 'external API', provider: 'Stripe (Razorpay adapter also implemented)',
    api: 'POST https://api.stripe.com/v1/checkout/sessions', tool: 'stripe_payment',
    dataSource: 'subscriptions, invoices, credits', requires: ['STRIPE_SECRET_KEY'], egress: true,
    cost: 'OWNER PAYMENT REQUIRED', launch: 'can be enabled later',
    degraded: 'Checkout reports "payments not configured". Plans are visible, no charge can be attempted, no fake receipt is written.',
    ownerAction: 'Stripe does not onboard Pakistan-resident businesses: this needs an eligible entity or an alternative processor.',
    verifiedBy: 'src/billing/billing.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Payment webhooks', component: 'src/billing/service.ts', symbol: 'billingService',
    brain: 'deterministic engine', provider: 'Stripe', api: 'POST /api/billing/webhook (signature verified)',
    tool: null, dataSource: 'invoices, webhook_events', requires: ['STRIPE_WEBHOOK_SECRET'], egress: false,
    cost: 'FREE', launch: 'can be enabled later',
    degraded: 'Unsigned or unverifiable webhooks are rejected; no subscription state changes without a verified signature.',
    ownerAction: 'Copy the webhook signing secret from the Stripe dashboard.',
    verifiedBy: 'src/billing/stripe-webhook.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Mobile push notifications', component: 'src/push/expo-push.ts', symbol: 'dispatchPush',
    brain: 'external API', provider: 'Expo push service', api: 'POST https://exp.host/--/api/v2/push/send',
    tool: null, dataSource: 'push_tokens', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'can be enabled later',
    degraded: 'Needs registered device tokens from the mobile app; with none, dispatch is a no-op that records zero sends.',
    ownerAction: 'Build and install the Expo app to obtain tokens.', verifiedBy: 'src/push/push.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'CRM', component: 'src/routes/crm.ts', symbol: 'createCrmRouter',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'crm_contacts, crm_deals', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch', degraded: 'Nothing: local records only. Email actions need SMTP.',
    ownerAction: '', verifiedBy: 'src/routes/workspace.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Storage / uploads', component: 'src/routes/files.ts', symbol: 'createFilesRouter',
    brain: 'infrastructure', provider: 'local filesystem under DATA_DIR', api: null, tool: null,
    dataSource: 'AKBARAL_UPLOAD_DIR', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'AKBARAL! public launch',
    degraded: 'Nothing on a host with a persistent disk. On an ephemeral host uploads vanish on redeploy — no object storage provider is integrated.',
    ownerAction: 'Mount a persistent volume at DATA_DIR on the production host.',
    verifiedBy: 'src/launch/checks.test.ts',
  },
  {
    system: 'AKBARAL!', fn: 'Database', component: 'src/db/driver.ts', symbol: 'Database',
    brain: 'infrastructure', provider: 'SQLite (node:sqlite) or PostgreSQL/Neon', api: 'file: or postgres:// URL',
    tool: null, dataSource: 'akbaral.db / managed Postgres', requires: ['DATABASE_URL'], egress: false,
    cost: 'FREE TIER', launch: 'AKBARAL! public launch',
    degraded: 'Defaults to file:./data/akbaral.db. The same schema runs on Postgres; Neon free tier is the zero-cost managed option.',
    ownerAction: 'Choose a host with a persistent disk, or create a free Neon project and set DATABASE_URL.',
    verifiedBy: 'src/db/postgres.integration.test.ts',
  },

  // ── ZA141251SA — mission ────────────────────────────────────────────────
  {
    system: 'ZA141251SA', fn: 'Mission agent chat', component: 'src/mission/chat-provider.ts', symbol: 'invokeGoogleChat',
    brain: 'LLM (direct provider call)', provider: 'Google Gemini (free tier only)',
    api: 'POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    tool: 'gemini_api (mission tool registry)', dataSource: 'mission.db: mission_credentials (AES-256-GCM vault)',
    requires: NO_ENV, egress: true, cost: 'FREE TIER', launch: 'ZA141251SA mission operation',
    degraded: 'The owner can send messages and they persist, but no reply is generated until a key is stored in the mission vault through the dashboard AND the runtime can reach Google.',
    ownerAction: 'Paste a free Google AI Studio key into the mission dashboard (never into chat).',
    verifiedBy: 'src/mission/chat-free-tier.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Chat dispatch worker', component: 'src/mission/chat-worker.ts', symbol: 'runNextAgentChat',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agent_chat_jobs', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Jobs queue and are recovered on restart; each dispatch fails honestly while the provider is unreachable.',
    ownerAction: '', verifiedBy: 'src/mission/chat-worker.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Provider reachability preflight', component: 'src/mission/provider-reachability.ts', symbol: 'checkProviderReachability',
    brain: 'deterministic engine', provider: 'Google (unauthenticated probe)',
    api: 'GET https://generativelanguage.googleapis.com/v1beta/models', tool: null,
    dataSource: 'none (in-memory 60s cache)', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Reports RUNTIME BLOCKED with the transport cause and stops the dashboard from showing a complete binding as READY.',
    ownerAction: '', verifiedBy: 'src/mission/provider-reachability.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent task understanding / briefing', component: 'src/mission/agent-briefing.ts', symbol: 'agentBriefing',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agents, mission_wallets, mission_resources', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: the briefing is assembled from real mission state, which is what stops an agent inventing its own capabilities.',
    ownerAction: '', verifiedBy: 'src/mission/chat-free-tier.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent memory / context', component: 'src/mission/messaging.ts', symbol: 'listAgentMessages',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agent_messages (append-only, sequenced)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: conversation history is stored in the mission database, not in a vector service.',
    ownerAction: '', verifiedBy: 'src/mission/mission-core.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent identity', component: 'src/mission/agent-identity.ts', symbol: 'agentCatalogIdentity',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agents (4,001 identities)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation', degraded: 'Nothing: identities are database rows synced from the AKBARAL! registry.',
    ownerAction: '', verifiedBy: 'src/mission/mission-core.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent fleet management', component: 'src/mission/registry-sync.ts', symbol: 'syncMissionRegistry',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agents ← AKBARAL! agents registry', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: a one-way copy of identity only. No customer data crosses over.',
    ownerAction: '', verifiedBy: 'src/mission/registry-sync.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Opportunity discovery / ingestion', component: 'src/mission/opportunity-ingestion.ts', symbol: 'claimJob',
    brain: 'external API', provider: '107 registered public platforms (35 keyless, 44 keyed)',
    api: 'per-source public JSON/RSS endpoints (rate-limited, cached)', tool: null,
    dataSource: 'mission_opportunities, mission_opportunity_sources', requires: NO_ENV, egress: true,
    cost: 'FREE', launch: 'ZA141251SA mission operation',
    degraded: 'Zero opportunities are ingested while outbound access is blocked — the table stays empty rather than being seeded with examples.',
    ownerAction: '', verifiedBy: 'src/mission/opportunity-catalog.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Opportunity scoring', component: 'src/mission/opportunity-matching.ts', symbol: 'computeMatchScore',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_opportunities × mission_agents', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: skill/capability/geography/payout scoring is arithmetic — no model is used or needed.',
    ownerAction: '', verifiedBy: 'src/mission/earning/agent-opportunity-routing.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Opportunity eligibility (country/KYC/ToS)', component: 'src/mission/earning/opportunity-eligibility.ts', symbol: 'eligibilityDecision',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'country-eligibility rules, platform ToS flags', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: it is the gate that refuses platforms which ban automation or exclude Pakistan.',
    ownerAction: '', verifiedBy: 'src/mission/earning/opportunity-eligibility.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent work execution', component: 'src/mission/earning/execution-pipeline.ts', symbol: 'startExecution',
    brain: 'deterministic engine', provider: 'platform connectors', api: 'per-platform official APIs', tool: null,
    dataSource: 'mission_executions', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'The pipeline runs but cannot start real work: every connector needs both outbound access and an owner-authorised platform account.',
    ownerAction: 'Create and verify the platform account; agents may never create accounts.',
    verifiedBy: 'src/mission/earning/execution-pipeline.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Work submission', component: 'src/mission/earning/upwork-workflow.ts', symbol: 'UpworkWorkflow',
    brain: 'deterministic engine', provider: 'Upwork / Freelancer / Contra / Toptal / Fiverr / Awin connectors',
    api: 'official platform APIs only', tool: null, dataSource: 'mission_platform_submissions',
    requires: [['ZA141251SA_FREELANCER_ACCESS_TOKEN', 'ZA141251SA_AWIN_ACCESS_TOKEN']], egress: true,
    cost: 'FREE', launch: 'ZA141251SA mission operation',
    degraded: 'Submissions are refused without an owner-authorised platform token; nothing is ever posted from an unverified account.',
    ownerAction: 'Apply for the platform API programme in the owner\u2019s own name.',
    verifiedBy: 'src/mission/earning/upwork-workflow.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Result verification', component: 'src/mission/earning/execution-pipeline.ts', symbol: 'verifyExecution',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_executions, evidence records', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: verification requires real evidence rows; absent evidence keeps the execution unverified.',
    ownerAction: '', verifiedBy: 'src/mission/earning/execution-pipeline.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Payment detection', component: 'src/mission/money-stripe.ts', symbol: 'configuredMoneyProvider',
    brain: 'external API', provider: 'Stripe (mission-owned account, separate from AKBARAL!)',
    api: 'https://api.stripe.com/v1/…', tool: null, dataSource: 'mission_cash_ledger',
    requires: ['ZA141251SA_STRIPE_SECRET_KEY', 'ZA141251SA_STRIPE_ACCOUNT_ID'], egress: true,
    cost: 'OWNER PAYMENT REQUIRED', launch: 'ZA141251SA mission operation',
    degraded: 'No external payment can be detected, so verified revenue stays $0.00 — which is the correct state, not a bug.',
    ownerAction: 'Stripe is unavailable to Pakistan-resident accounts; use Payoneer/Wise/bank rails and record the receipt manually with evidence.',
    verifiedBy: 'src/mission/money-stripe.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Revenue verification', component: 'src/mission/earning/settlement-verification.ts', symbol: 'verifySettlementAgainstProvider',
    brain: 'deterministic engine', provider: 'payment provider record', api: 'provider transaction lookup', tool: null,
    dataSource: 'mission_settlement_verifications', requires: NO_ENV, egress: true, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Revenue cannot become "verified" without an independent provider record; unverified money never reaches the treasury total.',
    ownerAction: '', verifiedBy: 'src/mission/earning/settlement-verification.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Ledger + treasury', component: 'src/mission/treasury.ts', symbol: 'credit',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_ledger (hash-chained), mission_wallets', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: append-only, balance_after on every row, chain verified at boot and by verifyLedger().',
    ownerAction: '', verifiedBy: 'src/mission/mission-treasury.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Ledger verification', component: 'src/mission/treasury.ts', symbol: 'verifyLedger',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_ledger', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: recomputes the hash chain; a broken link is reported, never repaired silently.',
    ownerAction: '', verifiedBy: 'src/mission/mission-financial-atomicity.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Withdrawal methods / cards', component: 'src/mission/withdrawal-methods.ts', symbol: 'addWithdrawalMethod',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_withdrawal_methods, mission_cards (masked)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: destinations are stored masked and re-masked on read; card numbers are never rendered in full.',
    ownerAction: '', verifiedBy: 'src/mission/withdrawal-methods.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Payout verification', component: 'src/mission/payout-verification.ts', symbol: 'confirmPayoutVerification',
    brain: 'owner action', provider: 'bank / Payoneer / Wise', api: 'out-of-band micro-deposit or statement check',
    tool: null, dataSource: 'mission_payout_slots', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Payouts are refused until the owner verifies a destination slot out of band. No agent can verify a destination.',
    ownerAction: 'Verify at least one payout slot from the mission dashboard.',
    verifiedBy: 'src/mission/mission-payout-verification.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Owner approvals / safety authorization', component: 'src/mission/owner-safety-gate.ts', symbol: 'authorizeAgentAction',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_authorizations, mission_safety_violations', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: every agent action that touches money, accounts or publishing needs an owner authorisation row first.',
    ownerAction: '', verifiedBy: 'src/mission/adversarial-safety.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Human action gate (KYC, OTP, CAPTCHA)', component: 'src/mission/human-action-gate.ts', symbol: 'createHumanActionTask',
    brain: 'owner action', provider: 'the platform demanding it', api: null, tool: null,
    dataSource: 'mission_human_actions', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: anything requiring identity, OTP or a CAPTCHA becomes an owner task instead of an automated bypass.',
    ownerAction: 'Complete the queued human actions.', verifiedBy: 'src/mission/adversarial-safety.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent tool selection / authorization', component: 'src/mission/self-management.ts', symbol: 'requestTool',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_tools (9), mission_tool_requests', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: an agent may request a tool; only the owner approves, and blocked tools can never be enabled by configuration.',
    ownerAction: '', verifiedBy: 'src/mission/mission-core.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Credential vault', component: 'src/mission/self-management.ts', symbol: 'storeCredential',
    brain: 'infrastructure', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_credentials (AES-256-GCM, last-4 hint only)', requires: ['ZA141251SA_CREDENTIAL_KEY'],
    egress: false, cost: 'FREE', launch: 'ZA141251SA mission operation',
    degraded: 'Without a 32+ character vault key the storage route refuses with 503 vault_not_configured — it never falls back to plaintext.',
    ownerAction: '', verifiedBy: 'src/mission/mission-core.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Resource budgets / call metering', component: 'src/mission/resource-calls.ts', symbol: 'runResourceCall',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_resource_calls, mission_resource_periods', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: every provider call reserves quota first and settles with a real receipt; an uncertain outcome is recorded as uncertain.',
    ownerAction: '', verifiedBy: 'src/mission/resource-calls.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent scheduling', component: 'src/mission/earning/continuous-scheduler.ts', symbol: 'tickScheduler',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_scheduler_ticks', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Ticks run and record honestly that there is nothing executable while discovery and connectors are blocked.',
    ownerAction: '', verifiedBy: 'src/mission/mission-server.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Agent communication (email/social on behalf)', component: 'src/mission/social.ts', symbol: 'beginSocialAuthorization',
    brain: 'external API', provider: 'YouTube / Instagram / TikTok OAuth',
    api: 'platform OAuth authorize + token endpoints', tool: null, dataSource: 'mission_social_connections',
    requires: [['TIKTOK_CLIENT_KEY', 'YOUTUBE_CLIENT_ID', 'INSTAGRAM_CLIENT_ID']], egress: true, cost: 'FREE',
    launch: 'can be enabled later',
    degraded: 'Publishing is refused; engagement numbers are only ever read from the platform API, never estimated.',
    ownerAction: 'Complete OAuth consent for each platform account.',
    verifiedBy: 'src/mission/mission-social.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Owner authentication', component: 'src/mission/auth.ts', symbol: 'login',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_owners, mission_sessions', requires: ['ZA141251SA_SESSION_SECRET', 'ZA141251SA_OWNER_EMAIL'],
    egress: false, cost: 'FREE', launch: 'ZA141251SA mission operation',
    degraded: 'Without the session secret login refuses to issue a session. Only the locked owner identity may ever hold an account.',
    ownerAction: 'Set the owner password through the setup link — never in chat, never in a file.',
    verifiedBy: 'src/mission/owner-setup.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Identity lock', component: 'src/mission/identity-lock.ts', symbol: 'enforceIdentityLock',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_owners', requires: ['ZA141251SA_OWNER_EMAIL'], egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Any owner account other than the configured identity is suspended and its sessions revoked on every boot.',
    ownerAction: '', verifiedBy: 'src/mission/mission-identity-lock.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Audit trail', component: 'src/mission/database.ts', symbol: 'appendMissionAudit',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_audit (hash-chained)', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: every privileged action appends a chained entry; the chain is verified at boot.',
    ownerAction: '', verifiedBy: 'src/mission/mission-core.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Recovery', component: 'src/mission/chat-worker.ts', symbol: 'recoverAgentChatJobs',
    brain: 'deterministic engine', provider: 'none (own code)', api: null, tool: null,
    dataSource: 'mission_agent_chat_jobs, mission_resource_calls', requires: NO_ENV, egress: false, cost: 'FREE',
    launch: 'ZA141251SA mission operation',
    degraded: 'Nothing: in-flight jobs and reservations are reconciled on restart; an unknown outcome stays "uncertain" rather than being assumed.',
    ownerAction: '', verifiedBy: 'src/mission/chat-worker.test.ts',
  },
  {
    system: 'ZA141251SA', fn: 'Mission database', component: 'src/mission/database.ts', symbol: 'missionDb',
    brain: 'infrastructure', provider: 'SQLite or PostgreSQL, separate instance from AKBARAL!',
    api: 'file: or postgres:// URL', tool: null, dataSource: 'mission.db (125 tables)',
    requires: ['ZA141251SA_DATABASE_URL'], egress: false, cost: 'FREE TIER',
    launch: 'ZA141251SA mission operation',
    degraded: 'Defaults to file:./mission.db. It must never point at the AKBARAL! database; database-isolation tests enforce the separation.',
    ownerAction: '', verifiedBy: 'src/mission/database-isolation.test.ts',
  },
];

export interface BrainMapEntry extends BrainRow {
  status: BrainStatus;
  /** Variables that are required and currently absent. */
  missing: string[];
  /** One line naming the single thing standing in the way, '' when nothing. */
  blocker: string;
}

/** True when a requirement (a name, or a list of alternatives) is satisfied. */
function satisfied(requirement: string | string[], env: Record<string, string | undefined>): boolean {
  const names = Array.isArray(requirement) ? requirement : [requirement];
  return names.some((name) => Boolean((env[name] ?? '').trim()));
}

function describe(requirement: string | string[]): string {
  return Array.isArray(requirement) ? requirement.join(' | ') : requirement;
}

/**
 * Resolve every row against a concrete environment and a reachability verdict.
 * `egressReachable` is the answer for outbound HTTPS in the runtime being
 * inspected — pass the real probe result, never an assumption.
 */
export function brainMap(
  environment: Record<string, string | undefined> = process.env,
  egressReachable = false,
): BrainMapEntry[] {
  return BRAIN_ROWS.map((row) => {
    const missing = row.requires.filter((requirement) => !satisfied(requirement, environment)).map(describe);
    const notImplemented = row.degraded.startsWith('NOT IMPLEMENTED');
    let status: BrainStatus;
    let blocker = '';
    if (notImplemented) {
      status = 'NOT IMPLEMENTED';
      blocker = 'no adapter exists in the codebase';
    } else if (missing.length > 0) {
      status = 'CREDENTIAL REQUIRED';
      blocker = `not configured: ${missing.join(', ')}`;
    } else if (row.egress && !egressReachable) {
      status = 'RUNTIME BLOCKED';
      blocker = 'this runtime cannot open outbound HTTPS to the provider';
    } else if (row.egress) {
      status = 'CODE READY';
      blocker = 'not yet exercised against the live provider in this runtime';
    } else {
      status = 'WORKING';
    }
    return { ...row, status, missing, blocker };
  });
}

/** Section G: the exact totals, all counted from the rows above. */
export interface BrainTotals {
  agents: number;
  reasoningProfiles: number;
  aiProviders: number;
  externalApis: number;
  toolIntegrations: number;
  credentialsRequired: number;
  credentialsConfigured: number;
  reachableProviders: number;
  capabilities: number;
  working: number;
  codeReady: number;
  credentialRequired: number;
  runtimeBlocked: number;
  notImplemented: number;
}

export function brainTotals(
  entries: BrainMapEntry[],
  counts: { agents: number; reasoningProfiles: number; aiProviders: number; toolIntegrations: number; reachableProviders: number },
): BrainTotals {
  const required = new Set<string>();
  const configured = new Set<string>();
  for (const entry of entries) {
    for (const requirement of entry.requires) {
      const names = Array.isArray(requirement) ? requirement : [requirement];
      for (const name of names) required.add(name);
    }
    for (const requirement of entry.requires) {
      const names = Array.isArray(requirement) ? requirement : [requirement];
      for (const name of names) if (process.env[name]?.trim()) configured.add(name);
    }
  }
  const externalApis = new Set(entries.filter((entry) => entry.api).map((entry) => entry.api as string));
  const count = (status: BrainStatus): number => entries.filter((entry) => entry.status === status).length;
  return {
    agents: counts.agents,
    reasoningProfiles: counts.reasoningProfiles,
    aiProviders: counts.aiProviders,
    externalApis: externalApis.size,
    toolIntegrations: counts.toolIntegrations,
    credentialsRequired: required.size,
    credentialsConfigured: configured.size,
    reachableProviders: counts.reachableProviders,
    capabilities: entries.length,
    working: count('WORKING'),
    codeReady: count('CODE READY'),
    credentialRequired: count('CREDENTIAL REQUIRED'),
    runtimeBlocked: count('RUNTIME BLOCKED'),
    notImplemented: count('NOT IMPLEMENTED'),
  };
}

/** Env names used by the map that the dependency matrix does not document. */
export function undocumentedBrainEnvVars(): string[] {
  const documented = new Set(DEPENDENCY_ROWS.map((row) => row.envVar));
  const used = new Set<string>();
  for (const row of BRAIN_ROWS) {
    for (const requirement of row.requires) {
      const names = Array.isArray(requirement) ? requirement : [requirement];
      for (const name of names) if (!documented.has(name)) used.add(name);
    }
  }
  return [...used].sort();
}
