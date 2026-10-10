/**
 * Execution backends — the four things that must exist before a lead becomes money.
 *
 * A fleet report that counts agents while the pipeline's actual dependencies go unmeasured
 * is decoration. This module reports, from live configuration and live rows only, the four
 * gates every earning task passes through, and — for each — the precise owner action that
 * would open it:
 *
 *   1. SANDBOX     which isolation backend is live (digest-pinned OCI image, the kernel
 *                  namespace jail, or neither) and what is configured for each
 *   2. MODEL       the chat/provider dispatch readiness, including whether the $0 free-tier
 *                  path is opted in and how many agents actually have a bounded config
 *   3. GITHUB      whether a credential exists, and the exact permission set a submission
 *                  needs (never the credential itself — nothing here reads or returns a token)
 *   4. PAYOUT      which rails exist, which slots are verified, and the evidence the owner
 *                  still owes before a destination is payable
 *
 * Nothing in here guesses. `unknown` and `not_verified` are results, and every entry states
 * the basis it was computed from.
 */

import { missionDb as db, type Row } from '../database';
import { chatDispatchReadiness } from '../chat-provider';
import {
  PAYOUT_DESTINATION_TYPES, PAYOUT_VERIFICATION_CHECKS, PAYOUT_VERIFICATION_METHODS, PAYOUT_VERIFICATION_VALIDITY_DAYS, listPayoutSlotVerificationStatuses,
} from '../payout-verification';
import { defaultSandboxCacheRoot, pinnedRootfsDigest, probeNamespaceSandbox } from './namespace-bounty-sandbox';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The permission a submission actually needs, as verified against the live platform rather
 * than as folklore: the workflow POSTs a fork, creates a ref, writes a file, and opens a
 * pull request. A fine-grained token restricted to one repository can read public
 * repositories and nothing more, which is why discovery works while submission does not.
 */
export const GITHUB_SUBMISSION_REQUIREMENTS = {
  readOnlySufficientFor: ['bounty discovery search', 'repository metadata', 'policy file reads', 'live claim recheck', 'source archive download'],
  submissionNeeds: [
    'fork the upstream repository into the submitting account (POST /repos/{owner}/{repo}/forks)',
    'create a branch on that fork (POST /repos/{account}/{repo}/git/refs)',
    'write the changed file on that fork (PUT /repos/{account}/{repo}/contents/{path})',
    'open a pull request against upstream (POST /repos/{owner}/{repo}/pulls)',
    'read back the merged state for settlement evidence (GET /repos/{owner}/{repo}/pulls/{number})',
  ],
  classicTokenScope: 'public_repo (or repo, if any target is private)',
  fineGrainedPermissions: [
    'Administration: write (to create the fork under the account)',
    'Contents: read and write (on the account-owned fork)',
    'Pull requests: read and write (on the upstream repository)',
    'Metadata: read (always required)',
  ],
  note: 'Read paths work with no token at all (at a lower rate limit). Submission is deliberately an owner-authorized action: the mission never opens a pull request by itself.',
} as const;

export interface SandboxBackendReport {
  mode: string;
  backend: string | null;
  reason: string | null;
  oci: { imageDigestPinned: boolean; repository: string; runtime: string; pullPolicy: 'never' };
  namespace: {
    probed: boolean;
    available: boolean;
    reason: string | null;
    rootfsDigestPinned: string | null;
    cachedRootfs: string[];
    cacheRoot: string;
    detail: Record<string, unknown>;
  };
  /** What the owner must actually do to open this gate, in order of cost. */
  ownerActions: string[];
}

/**
 * Reads configuration and, when asked, runs the real capability probe. Probing costs a
 * couple of hundred milliseconds plus a staged rootfs, so `probe` defaults to false for
 * dashboards and is enabled by the operator command.
 */
export async function sandboxBackendReport(options: { probe?: boolean } = {}): Promise<SandboxBackendReport> {
  const mode = (process.env.ZA141251SA_BOUNTY_SANDBOX_MODE ?? 'auto').trim().toLowerCase() || 'auto';
  const imageDigest = (process.env.ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST ?? '').trim();
  const repository = (process.env.ZA141251SA_BOUNTY_SANDBOX_IMAGE_REPOSITORY ?? 'ghcr.io/azadar-templates/akbaral-bounty-sandbox').trim();
  const runtime = (process.env.ZA141251SA_BOUNTY_SANDBOX_RUNTIME ?? 'docker').trim().toLowerCase();
  const cacheRoot = defaultSandboxCacheRoot();
  const cachedRootfs = existsSync(cacheRoot)
    ? readdirSync(cacheRoot, { encoding: 'utf8' }).filter(name => name.startsWith('rootfs-')).slice(0, 8)
    : [];
  const ownerActions: string[] = [];
  if (!/^(docker|podman)$/.test(runtime)) ownerActions.push(`ZA141251SA_BOUNTY_SANDBOX_RUNTIME must be docker or podman (found "${runtime.slice(0, 24) || 'unset'}')`);
  if (!imageDigest) ownerActions.push('pull the sandbox image and pin its sha256 digest in ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST (tags are never trusted, so an unpinned image means no OCI backend)');

  const namespace: SandboxBackendReport['namespace'] = {
    probed: false, available: false, reason: null, rootfsDigestPinned: pinnedRootfsDigest(),
    cachedRootfs, cacheRoot, detail: {},
  };
  let backend: string | null = null;
  let reason: string | null = null;
  if (mode === 'off') {
    reason = 'sandbox_mode_off';
  } else if (imageDigest && (runtime === 'docker' || runtime === 'podman')) {
    // The OCI backend's availability is the runtime's own answer, not a config guess;
    // this report records that a pinned image is configured and lets the runner decide.
    backend = 'oci-configured';
    reason = 'image_pinned_availability_deferred_to_runner';
  }
  if (options.probe === true && mode !== 'off') {
    const status = await probeNamespaceSandbox();
    namespace.probed = true;
    namespace.available = status.available;
    namespace.reason = status.reason;
    namespace.detail = status.detail;
    if (status.available) ownerActions.push('optionally pin the staged rootfs digest (ZA141251SA_BOUNTY_SANDBOX_ROOTFS_DIGEST) to make the jail reproducible across hosts');
    else ownerActions.push(`namespace jail unavailable: ${status.reason ?? 'unknown_reason'}`);
    if (!backend && status.available) { backend = 'namespace'; reason = null; }
  } else if (!backend && mode !== 'off') {
    reason = reason ?? 'not_probed';
    ownerActions.push('run `npm run fleet:backends` (or set the sandbox image digest) to determine which backend is live on this host');
  }
  return {
    mode, backend, reason,
    oci: { imageDigestPinned: /^sha256:[a-f0-9]{64}$/.test(imageDigest), repository, runtime, pullPolicy: 'never' },
    namespace,
    ownerActions,
  };
}

export interface ModelBackendReport {
  mode: string;
  dispatchable: boolean;
  model: string;
  blockers: string[];
  ownerActions: string[];
  agentsWithChatConfig: number;
  agentsOnFreeTierBasis: number;
  productionAgents: number;
  fallback: { supported: boolean; how: string; providersEnabled: number; configured: number };
  note: string;
}

/** Model readiness, computed from the same guards dispatch itself uses. */
export function modelBackendReport(): ModelBackendReport {
  const readiness = chatDispatchReadiness();
  const count = (sql: string, params: Array<string | number> = []) => Number(db.get<Row>(sql, params)?.c ?? 0);
  const agentsWithChatConfig = count('SELECT COUNT(*) AS c FROM mission_agent_chat_configs');
  const productionAgents = count("SELECT COUNT(*) AS c FROM mission_agents WHERE COALESCE(origin_platform,'')<>'fixture'");
  // The free-tier guard requires a cost basis that says so; count configs that would pass.
  const agentsOnFreeTierBasis = count(
    "SELECT COUNT(*) AS c FROM mission_agent_chat_configs WHERE json_extract(config,'$.costBasis') LIKE '%free%tier%'",
  );
  const providers = db.all<Row>('SELECT provider_key, enabled, credential_vault_key, models_available_json, default_model FROM model_providers ORDER BY priority, provider_key');
  const fallback = {
    supported: providers.length > 1,
    how: providers.length > 0
      ? 'model_providers rows are dispatched in priority order and a failed provider falls through to the next with status=fallback; register another free-tier provider to widen it'
      : 'no model_providers rows exist, so dispatch uses the built-in provider configuration only',
    providersEnabled: providers.filter(row => Number(row.enabled) === 1).length,
    configured: providers.length,
  };
  return {
    mode: readiness.mode, dispatchable: readiness.dispatchable, model: readiness.model,
    blockers: readiness.blockers, ownerActions: readiness.ownerActions,
    agentsWithChatConfig, agentsOnFreeTierBasis, productionAgents,
    fallback,
    note: 'Readiness means a provider permit and a bounded $0 cost basis exist. It is not a claim that a model answered correctly, and it never activates a paid tier: dispatch refuses any model or cost basis outside the free-tier allowlist unless a verified vendor billing adapter is configured.',
  };
}

export interface GithubBackendReport {
  credentialPresent: boolean;
  credentialSource: string | null;
  readOnlyCapable: boolean;
  submissionCapable: 'unknown' | 'granted_by_owner';
  requirements: typeof GITHUB_SUBMISSION_REQUIREMENTS;
  requestsUsed: number;
  blockedFor: string[];
  note: string;
}

/**
 * Reports whether a credential EXISTS — the value is never read, returned, or logged, by
 * this module or by anything that consumes it.
 */
export function githubBackendReport(env: Readonly<Record<string, string | undefined>> = process.env): GithubBackendReport {
  const token = env.ZA141251SA_GITHUB_TOKEN;
  const present = typeof token === 'string' && token.length > 0;
  const requestsUsed = Number(db.get<Row>('SELECT COALESCE(COUNT(*),0) AS c FROM mission_bounty_api_requests')?.c ?? 0);
  return {
    credentialPresent: present,
    credentialSource: present ? 'ZA141251SA_GITHUB_TOKEN (environment; value never read)' : null,
    readOnlyCapable: true,
    submissionCapable: 'unknown',
    requirements: GITHUB_SUBMISSION_REQUIREMENTS,
    requestsUsed: Number.isSafeInteger(requestsUsed) ? requestsUsed : 0,
    blockedFor: present ? [] : ['github_credentials_absent'],
    note: 'Discovery, policy reads, claim rechecks and archive downloads work with or without a token. A submission needs a credential the owner authorizes with fork, contents-write and pull-request permissions; until then every candidate stays a local draft with an owner action recorded.',
  };
}

export interface PayoutBackendReport {
  rails: readonly string[];
  verificationMethods: readonly string[];
  validityDays: number;
  slots: Array<{ slot: number; label: string; status: string; destinationConfigured: boolean; payable: boolean; outstandingEvidence: string[]; blockers: string[]; expiresAt: string | null; daysUntilExpiry: number | null }>;
  slotsConfigured: number;
  slotsVerified: number;
  requiredEvidence: Array<{ key: string; label: string; required: boolean }>;
  settledRevenueCents: number;
  receivableCents: number;
  note: string;
}

/**
 * How a slot becomes payable, stated from the code that enforces it — the checks the owner
 * must confirm, the destination-safety refusals, and the expiry that pauses the slot again.
 */
export function payoutBackendReport(): PayoutBackendReport {
  const statuses = listPayoutSlotVerificationStatuses();
  const requiredEvidence = PAYOUT_VERIFICATION_CHECKS.filter(check => check.required)
    .map(check => ({ key: check.key, label: check.label, required: check.required }));
  const slots = statuses.map(status => ({
    slot: Number(status.slot),
    label: String(status.label ?? ''),
    status: String(status.slotStatus ?? 'unknown'),
    destinationConfigured: Boolean(status.destinationConfigured),
    payable: Boolean(status.payable),
    outstandingEvidence: (status.requiredChecks ?? []).filter(check => !check.confirmed).map(check => String(check.key)),
    blockers: (status.blockers ?? []).map(blocker => String(blocker)),
    expiresAt: status.expiresAt ? String(status.expiresAt) : null,
    daysUntilExpiry: Number.isFinite(Number(status.daysUntilExpiry)) ? Number(status.daysUntilExpiry) : null,
  }));
  // 'received' is the only state the ledger uses for money that actually arrived; an
  // expected or contracted receivable is reported separately and never as revenue.
  const settled = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) AS total FROM mission_revenue WHERE status='received'")?.total ?? 0);
  const receivable = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) AS total FROM mission_revenue WHERE status IN ('expected','contracted')")?.total ?? 0);
  return {
    rails: PAYOUT_DESTINATION_TYPES,
    verificationMethods: PAYOUT_VERIFICATION_METHODS,
    validityDays: PAYOUT_VERIFICATION_VALIDITY_DAYS,
    slots,
    slotsConfigured: slots.filter(slot => slot.destinationConfigured).length,
    slotsVerified: slots.filter(slot => slot.payable).length,
    requiredEvidence,
    settledRevenueCents: Number.isSafeInteger(settled) ? settled : 0,
    receivableCents: Number.isSafeInteger(receivable) ? receivable : 0,
    note: 'Verification means the owner confirmed every required control check and signed an attestation for a destination that holds only a provider reference or a masked account. Raw card, bank or wallet credentials are refused by design, and no code path here moves money or marks a payout settled: settled revenue is only ever what the ledger records from a real, evidenced receipt.',
  };
}

export interface ExecutionBackends {
  sandbox: SandboxBackendReport;
  model: ModelBackendReport;
  github: GithubBackendReport;
  payout: PayoutBackendReport;
  /** The one-line answer: can a lead be executed and submitted end to end right now? */
  blocked: Array<{ gate: string; reason: string }>;
  generatedAt: string;
}

/** Everything at once, with the blockers derived from the four gates. */
export async function executionBackends(options: { probeSandbox?: boolean } = {}): Promise<ExecutionBackends> {
  const sandbox = await sandboxBackendReport({ probe: options.probeSandbox === true });
  const model = modelBackendReport();
  const github = githubBackendReport();
  const payout = payoutBackendReport();
  const blocked: Array<{ gate: string; reason: string }> = [];
  if (!sandbox.backend) blocked.push({ gate: 'sandbox', reason: sandbox.reason ?? 'no_backend' });
  if (!model.dispatchable) for (const blocker of model.blockers) blocked.push({ gate: 'model', reason: blocker });
  for (const reason of github.blockedFor) blocked.push({ gate: 'github', reason });
  if (payout.slotsVerified === 0) blocked.push({ gate: 'payout', reason: 'no_payout_slot_verified' });
  return { sandbox, model, github, payout, blocked, generatedAt: new Date().toISOString() };
}

/** Where the digest-pinned rootfs cache lives, for operators reading the report. */
export function sandboxCacheHint(): string {
  return join(defaultSandboxCacheRoot(), 'rootfs-<digest>');
}
