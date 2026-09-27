/**
 * ZA141251SA — EARNING PROVIDER REGISTRY, DISCOVERY AND READINESS
 *
 * mission-money-worker used to call moneyWorkerTick(actor, [provider], []) — an
 * unconditionally empty earning-provider array. No earning job could ever leave
 * the 'queued' state, so the entire earning loop was inert regardless of how
 * much of the pipeline behind it worked.
 *
 * This module replaces that hardcoded empty array with honest discovery:
 *
 *   - a provider is registered only if a concrete implementation exists;
 *   - it is ACTIVATED only if its credentials are genuinely present;
 *   - if credentials are absent the provider is reported as blocked, with the
 *     exact reason and the exact human action required.
 *
 * An empty result is therefore still a perfectly valid, truthful outcome — it
 * now means "no provider is credentialed yet", which is reportable, instead of
 * "the code never had any provider", which was silent.
 */

import type { EarningProvider } from '../../money';
import {
  configuredStripeDirectEarning,
  stripeDirectEarningReadiness,
} from './stripe-direct-earning';

export type EarningProviderStatus =
  | 'ready'
  | 'credential_required'
  | 'human_action_required'
  | 'not_implemented';

export interface EarningProviderDescriptor {
  /** Must equal the MoneyProvider id and the opportunity.provider value. */
  id: string;
  label: string;
  /** How the customer actually pays. */
  paymentRail: string;
  /** True only when settlement can be verified through an official API. */
  payoutVerifiable: boolean;
  /** True when no upfront money or card is needed to start earning. */
  freeToStart: boolean;
  status: EarningProviderStatus;
  /** Exact reasons the provider is not ready. Empty when status is 'ready'. */
  blockers: string[];
  /** Unavoidable human steps, phrased as actions — never asking for secrets in chat. */
  ownerActions: string[];
  /** Constructed implementation, present only when status === 'ready'. */
  provider: EarningProvider | null;
}

/**
 * Discover every earning provider and its true readiness.
 *
 * Pure with respect to the database: it reads environment configuration only,
 * so it is safe to call from the worker loop, from health endpoints and from
 * tests without side effects.
 */
export function discoverEarningProviders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EarningProviderDescriptor[] {
  const descriptors: EarningProviderDescriptor[] = [];

  // ── stripe-mission: direct customer payment for delivered agent work ──────
  const stripeReadiness = stripeDirectEarningReadiness(env);
  const stripe = stripeReadiness.configured ? configuredStripeDirectEarning(env) : null;
  descriptors.push({
    id: 'stripe-mission',
    label: 'Direct customer payment for delivered agent work (Stripe)',
    paymentRail: 'stripe',
    payoutVerifiable: true,
    freeToStart: true,
    status: stripe ? 'ready' : 'credential_required',
    blockers: stripe ? [] : stripeReadiness.blockers,
    ownerActions: stripe
      ? []
      : [
          'Create a free Stripe account for the mission (no card required to create the account).',
          'Add ZA141251SA_STRIPE_SECRET_KEY (live secret key) via the host secret manager — never in chat or in Git.',
          'Add ZA141251SA_STRIPE_ACCOUNT_ID (acct_...) via the host secret manager.',
          'Complete Stripe identity + bank verification. This gates WITHDRAWAL only; earning and verification work without it.',
          'Set the payout schedule to manual so no money moves without explicit owner approval.',
        ],
    provider: stripe,
  });

  return descriptors;
}

/**
 * The array the worker actually passes to moneyWorkerTick.
 *
 * Only genuinely constructed, credentialed providers appear here. This is the
 * one-line replacement for the old hardcoded [].
 */
export function activeEarningProviders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EarningProvider[] {
  return discoverEarningProviders(env)
    .filter(d => d.status === 'ready' && d.provider)
    .map(d => d.provider as EarningProvider);
}

/**
 * Human-readable readiness summary for the owner dashboard and health output.
 * Reports zero-state honestly rather than implying capability.
 */
export function earningProviderReadinessReport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  total: number;
  ready: number;
  blocked: number;
  earningPossible: boolean;
  providers: Array<Omit<EarningProviderDescriptor, 'provider'>>;
  summary: string;
} {
  const descriptors = discoverEarningProviders(env);
  const ready = descriptors.filter(d => d.status === 'ready').length;
  const providers = descriptors.map(({ provider: _provider, ...rest }) => rest);
  return {
    total: descriptors.length,
    ready,
    blocked: descriptors.length - ready,
    earningPossible: ready > 0,
    providers,
    summary:
      ready > 0
        ? `${ready} of ${descriptors.length} earning provider(s) credentialed; earning jobs can be delivered and externally verified.`
        : `0 of ${descriptors.length} earning provider(s) credentialed. No earning job can complete, and no revenue can be recorded, until an owner supplies credentials through the host secret manager.`,
  };
}
