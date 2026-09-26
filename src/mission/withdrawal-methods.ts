// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — withdrawal methods (real payout destinations) and mission cards
//
// A "withdrawal method" is the owner-facing name for a payout destination. The
// underlying record is the existing four-slot payout destination table, so the
// whole verified-money path (verification, atomic debit on approval, refund on
// failure, audit chain) is unchanged.
//
// What this module adds:
//   · only CONFIGURED methods exist — nothing is shown until the owner adds one
//   · the sensitive part of what the owner types (account number, IBAN, SWIFT,
//     payout-provider email) is encrypted with the mission vault key and stored
//     in mission_withdrawal_secrets; it is never returned by any HTTP route,
//     never logged, never audited and never rendered
//   · the dashboard only ever receives a masked description (••••1234)
//   · cards are real or absent: a card row can only be written after a real
//     card provider confirms issuance and returns its own reference
// ─────────────────────────────────────────────────────────────────────────────

import { missionDb, nowIso, appendMissionAudit, missionId, sha256, type Row } from './database';
import { encryptCredential } from './auth';
import { configurePayoutSlot, ensurePayoutSlots, listPayoutSlots, PAYOUT_SLOT_COUNT } from './treasury';
import { payoutSlotVerificationStatus } from './payout-verification';

export class WithdrawalMethodError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = 'WithdrawalMethodError';
  }
}

export interface MethodField {
  key: string;
  label: string;
  /** `secret` fields are encrypted at rest and never returned to any client. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface MethodType {
  key: string;
  label: string;
  description: string;
  /** Factual availability statement — never a sales claim. */
  availability: string;
  fields: MethodField[];
  /** Which secret field the masked description is derived from. */
  maskFrom: string;
}

const HOLDER: MethodField = { key: 'holderName', label: 'Account holder name', secret: false, required: true, placeholder: 'Name exactly as held at the institution' };
const CURRENCY: MethodField = { key: 'currency', label: 'Currency', secret: false, required: true, placeholder: 'USD' };

/**
 * Only rails that a Pakistan-resident owner can actually receive money on are
 * offered. PayPal and Stripe payouts are deliberately absent: neither is
 * available to Pakistani residents (see earning/country-eligibility.ts), and a
 * method that cannot pay out would be a fake option.
 */
export const METHOD_TYPES: MethodType[] = [
  {
    key: 'bank_local',
    label: 'Local bank account (Pakistan)',
    description: 'Direct transfer to a Pakistani bank account, including an SBP Freelancer Digital Account.',
    availability: 'Supported for Pakistan-resident owners. Local rails settle in PKR; USD requires a foreign-currency or freelancer digital account.',
    fields: [
      { key: 'bankName', label: 'Bank name', secret: false, required: true, placeholder: 'e.g. Meezan Bank' },
      HOLDER,
      { key: 'accountNumber', label: 'Account number / IBAN', secret: true, required: true, help: 'Encrypted with the mission vault key. Only the last four digits are ever displayed.' },
      { key: 'branchCode', label: 'Branch code (optional)', secret: true, required: false },
      CURRENCY,
    ],
    maskFrom: 'accountNumber',
  },
  {
    key: 'bank_wire',
    label: 'International bank wire (SWIFT)',
    description: 'USD wire into a bank account that can receive international transfers.',
    availability: 'Accepted by Pakistani banks; incoming USD wires are SBP-reportable.',
    fields: [
      { key: 'bankName', label: 'Bank name', secret: false, required: true },
      HOLDER,
      { key: 'accountNumber', label: 'Account number / IBAN', secret: true, required: true, help: 'Encrypted with the mission vault key.' },
      { key: 'swift', label: 'SWIFT / BIC', secret: true, required: true },
      { key: 'bankAddress', label: 'Bank address (optional)', secret: true, required: false },
      CURRENCY,
    ],
    maskFrom: 'accountNumber',
  },
  {
    key: 'payoneer',
    label: 'Payoneer',
    description: 'Payoneer receiving account used by Upwork, Fiverr, Freelancer and Toptal payouts.',
    availability: 'Payoneer supports Pakistan. Registration, KYC and any OTP are owner actions — agents never operate the account.',
    fields: [
      HOLDER,
      { key: 'payoneerEmail', label: 'Payoneer account email', secret: true, required: true, help: 'Encrypted with the mission vault key; shown masked.' },
      { key: 'customerId', label: 'Payoneer customer ID (optional)', secret: true, required: false },
      CURRENCY,
    ],
    maskFrom: 'payoneerEmail',
  },
  {
    key: 'wise',
    label: 'Wise (existing accounts only)',
    description: 'Wise multi-currency account.',
    availability: 'Wise stopped accepting NEW Pakistani registrations in January 2023. Add this only if you already hold a usable Wise account.',
    fields: [
      HOLDER,
      { key: 'wiseEmail', label: 'Wise account email', secret: true, required: true },
      { key: 'accountNumber', label: 'Account / IBAN (optional)', secret: true, required: false },
      CURRENCY,
    ],
    maskFrom: 'wiseEmail',
  },
];

export function methodType(key: string): MethodType | null {
  return METHOD_TYPES.find((type) => type.key === key) ?? null;
}

/** ••••••1234 / j•••@mail — enough to recognise, never enough to use. */
export function maskValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    const head = local.slice(0, 1);
    return `${head}${'•'.repeat(Math.max(3, local.length - 1))}@${domain}`;
  }
  const tail = trimmed.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(12, trimmed.length - 4)))}${tail}`;
}

export interface WithdrawalMethodView {
  slot: number;
  type: string;
  typeLabel: string;
  label: string;
  holderName: string | null;
  masked: string | null;
  currency: string;
  status: string;
  statusLabel: string;
  verifiedAt: string | null;
  payable: boolean;
  blockers: string[];
  addedAt: string | null;
  secretStored: boolean;
  secretFields: string[];
}

function statusLabel(status: string, payable: boolean): string {
  if (status === 'active' && payable) return 'Verified';
  if (status === 'active') return 'Verification expired';
  if (status === 'pending_verification') return 'Pending verification';
  if (status === 'paused') return 'Paused';
  return status;
}

/** Only slots the owner actually configured. Never four empty placeholders. */
export function listWithdrawalMethods(): WithdrawalMethodView[] {
  ensurePayoutSlots();
  const secrets = new Map<number, Row>();
  for (const row of missionDb.all<Row>('SELECT slot, fields, created_at FROM mission_withdrawal_secrets')) {
    secrets.set(Number(row.slot), row);
  }
  return listPayoutSlots()
    .filter((slot) => String(slot.status ?? 'unconfigured') !== 'unconfigured' && (slot.masked_account || slot.provider_ref))
    .map((slot) => {
      const number = Number(slot.slot);
      const verification = payoutSlotVerificationStatus(number);
      const type = String(slot.destination_type ?? 'bank_local');
      const secret = secrets.get(number);
      return {
        slot: number,
        type,
        typeLabel: methodType(type)?.label ?? type,
        label: String(slot.label ?? `Withdrawal method ${number}`),
        holderName: slot.holder_name ? String(slot.holder_name) : null,
        masked: slot.masked_account ? String(slot.masked_account) : null,
        currency: String(slot.currency ?? 'USD'),
        status: String(slot.status),
        statusLabel: statusLabel(String(slot.status), verification.payable),
        verifiedAt: slot.verified_at ? String(slot.verified_at) : null,
        payable: verification.payable,
        blockers: verification.blockers ?? [],
        addedAt: slot.configured_at ? String(slot.configured_at) : null,
        secretStored: Boolean(secret),
        secretFields: secret ? (JSON.parse(String(secret.fields)) as string[]) : [],
      };
    });
}

export interface AddWithdrawalMethodInput {
  type: string;
  label?: string;
  values: Record<string, string>;
  actorId: string;
}

/**
 * Add one real withdrawal method. The secret values never touch the payout
 * slot row, the audit detail or any response body: they are encrypted once and
 * stored in mission_withdrawal_secrets.
 */
export function addWithdrawalMethod(input: AddWithdrawalMethodInput): WithdrawalMethodView {
  const type = methodType(String(input.type ?? ''));
  if (!type) throw new WithdrawalMethodError(400, 'unknown withdrawal method type', 'validation_error');
  const values = input.values && typeof input.values === 'object' ? input.values : {};

  const clean: Record<string, string> = {};
  for (const field of type.fields) {
    const raw = typeof values[field.key] === 'string' ? String(values[field.key]).trim() : '';
    if (!raw) {
      if (field.required) throw new WithdrawalMethodError(400, `${field.label} is required`, 'validation_error');
      continue;
    }
    if (raw.length > 200) throw new WithdrawalMethodError(400, `${field.label} is too long`, 'validation_error');
    clean[field.key] = raw;
  }
  const currency = (clean.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WithdrawalMethodError(400, 'currency must be a three-letter code such as USD or PKR', 'validation_error');

  const primary = clean[type.maskFrom];
  if (!primary) throw new WithdrawalMethodError(400, `${type.fields.find((field) => field.key === type.maskFrom)?.label ?? 'account'} is required`, 'validation_error');
  const masked = maskValue(primary);

  return missionDb.transaction(() => {
    ensurePayoutSlots();
    const configured = listWithdrawalMethods();
    if (configured.length >= PAYOUT_SLOT_COUNT) {
      throw new WithdrawalMethodError(409, `a maximum of ${PAYOUT_SLOT_COUNT} withdrawal methods can be configured — remove one first`, 'limit_reached');
    }
    const used = new Set(configured.map((method) => method.slot));
    const slot = [1, 2, 3, 4].find((candidate) => !used.has(candidate));
    if (!slot) throw new WithdrawalMethodError(409, 'no free withdrawal method slot', 'limit_reached');

    const secretPayload: Record<string, string> = {};
    const secretFields: string[] = [];
    for (const field of type.fields) {
      if (!field.secret || !clean[field.key]) continue;
      secretPayload[field.key] = clean[field.key];
      secretFields.push(field.key);
    }
    const encrypted = encryptCredential(JSON.stringify(secretPayload), 4);
    missionDb.run(
      `INSERT INTO mission_withdrawal_secrets (slot, ciphertext, iv, tag, hint, fields, fingerprint, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
         hint = excluded.hint, fields = excluded.fields, fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`,
      [slot, encrypted.ciphertext, encrypted.iv, encrypted.tag, masked, JSON.stringify(secretFields), sha256(encrypted.ciphertext), nowIso(), input.actorId, nowIso()],
    );

    const label = (input.label ?? '').trim() || [type.label, clean.bankName].filter(Boolean).join(' — ');
    configurePayoutSlot({
      slot,
      label: label.slice(0, 120),
      destinationType: type.key,
      holderName: clean.holderName ?? null,
      // Already masked: the raw instrument never reaches the destination row.
      maskedAccount: masked,
      currency,
      actorId: input.actorId,
      actorType: 'owner',
    });
    // The treasury re-masks with asterisks; keep the owner-facing mask (which
    // also preserves an email domain) as the single displayed description.
    missionDb.run('UPDATE mission_payout_slots SET masked_account = ? WHERE slot = ?', [masked, slot]);
    appendMissionAudit({
      actorType: 'owner',
      actorId: input.actorId,
      action: 'withdrawal_method.added',
      subjectType: 'payout_slot',
      subjectId: String(slot),
      // Masked description only — no account number, email or routing data.
      detail: { slot, type: type.key, masked, currency, secretFields, encryptedAtRest: true },
    });
    const view = listWithdrawalMethods().find((method) => method.slot === slot);
    if (!view) throw new WithdrawalMethodError(500, 'withdrawal method could not be read back', 'internal_error');
    return view;
  });
}

/** Remove a method. Refused while money is in flight to that destination. */
export function removeWithdrawalMethod(slot: number, actorId: string): { removed: number } {
  return missionDb.transaction(() => {
    const row = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slot]);
    if (!row || String(row.status) === 'unconfigured') throw new WithdrawalMethodError(404, 'withdrawal method not found', 'not_found');
    const inFlight = Number(
      missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_payouts WHERE slot = ? AND status IN ('pending_approval','approved','sent')`, [slot])?.count ?? 0,
    );
    if (inFlight > 0) throw new WithdrawalMethodError(409, 'a withdrawal to this method is still in progress', 'conflict');
    missionDb.run('DELETE FROM mission_withdrawal_secrets WHERE slot = ?', [slot]);
    missionDb.run(
      `UPDATE mission_payout_slots
          SET status = 'unconfigured', destination_type = NULL, holder_name = NULL, masked_account = NULL,
              provider_ref = NULL, verified_at = NULL, verified_by = NULL, configured_at = NULL, updated_at = ?
        WHERE slot = ?`,
      [nowIso(), slot],
    );
    appendMissionAudit({
      actorType: 'owner',
      actorId,
      action: 'withdrawal_method.removed',
      subjectType: 'payout_slot',
      subjectId: String(slot),
      detail: { slot, secretDestroyed: true },
    });
    return { removed: slot };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission cards — real or absent
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_SLOT_COUNT = 4;

export interface MissionCardView {
  id: string;
  slot: number;
  label: string;
  provider: string;
  brand: string | null;
  last4: string;
  currency: string;
  status: string;
  issuedAt: string;
}

export function listMissionCards(): MissionCardView[] {
  return missionDb.all<Row>('SELECT * FROM mission_cards ORDER BY slot ASC').map((row) => ({
    id: String(row.id),
    slot: Number(row.slot),
    label: String(row.label),
    provider: String(row.provider),
    brand: row.brand ? String(row.brand) : null,
    last4: String(row.last4),
    currency: String(row.currency ?? 'USD'),
    status: String(row.status),
    issuedAt: String(row.issued_at),
  }));
}

export function cardProviderConnected(): boolean {
  return Boolean((process.env.ZA141251SA_STRIPE_SECRET_KEY ?? '').trim() && (process.env.ZA141251SA_STRIPE_ACCOUNT_ID ?? '').trim());
}

/** Everything the card section needs, with no invented state. */
export function cardProgramme(availableCents: number): Record<string, unknown> {
  const cards = listMissionCards();
  const methods = listWithdrawalMethods();
  const verifiedMethod = methods.find((method) => method.payable) ?? null;
  const providerConnected = cardProviderConnected();
  const blockers: string[] = [];
  if (!providerConnected) blockers.push('CREDENTIAL REQUIRED — no mission card provider is connected (ZA141251SA_STRIPE_SECRET_KEY / ZA141251SA_STRIPE_ACCOUNT_ID).');
  if (!verifiedMethod) blockers.push('No verified withdrawal method — add and verify one in Withdraw first.');
  if (availableCents <= 0) blockers.push('No verified balance to fund a card. Expected revenue can never fund a card.');
  if (cards.length >= CARD_SLOT_COUNT) blockers.push(`The maximum of ${CARD_SLOT_COUNT} mission cards is already issued.`);
  return {
    cards,
    count: cards.length,
    maxCards: CARD_SLOT_COUNT,
    status: cards.length > 0 ? 'ISSUED' : 'NOT ISSUED',
    availableCents,
    providerConnected,
    providerName: 'Stripe Issuing (mission-dedicated keys)',
    canIssue: blockers.length === 0,
    blockers,
    requirements: [
      'A mission-dedicated card provider account (ZA141251SA_STRIPE_SECRET_KEY / ZA141251SA_STRIPE_ACCOUNT_ID).',
      'A verified withdrawal method (the card is funded from verified mission money only).',
      'Verified balance — cards are never funded from expected or contracted revenue.',
      'Card issuing enabled on the provider account for the mission’s country of operation.',
    ],
    note: 'Card numbers, CVV and PIN are never stored or displayed; only a provider-confirmed last four digits are shown. Agents never hold card credentials.',
  };
}

export interface IssueCardInput {
  label?: string;
  currency?: string;
  actorId: string;
  transport?: typeof fetch;
}

/**
 * Issue a real card. Fails closed: without a connected provider nothing is
 * created and the owner is told exactly what is missing. A card row is written
 * only from a provider response that carries the provider's own card id and
 * last four digits — never from owner input.
 */
export async function issueMissionCard(input: IssueCardInput, availableCents: number): Promise<MissionCardView> {
  const programme = cardProgramme(availableCents);
  if (!programme.canIssue) {
    throw new WithdrawalMethodError(409, `card issuance is blocked: ${(programme.blockers as string[]).join(' ')}`, 'card_provider_not_connected');
  }
  const key = String(process.env.ZA141251SA_STRIPE_SECRET_KEY ?? '').trim();
  const accountId = String(process.env.ZA141251SA_STRIPE_ACCOUNT_ID ?? '').trim();
  if (!/^sk_live_/.test(key) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new WithdrawalMethodError(409, 'card provider credentials are not live mission credentials', 'card_provider_not_connected');
  }
  const transport = input.transport ?? fetch;
  let payload: any;
  try {
    const response = await transport('https://api.stripe.com/v1/issuing/cards', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${key}`,
        'Stripe-Account': accountId,
        'Stripe-Version': '2024-06-20',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `za141251sa-card-${sha256(`${accountId}:${input.label ?? ''}:${nowIso().slice(0, 10)}`).slice(0, 32)}`,
      },
      body: new URLSearchParams({ type: 'virtual', currency: (input.currency ?? 'usd').toLowerCase(), 'metadata[mission]': 'ZA141251SA' }).toString(),
    });
    if (!response.ok) throw new Error(`provider responded ${response.status}`);
    payload = await response.json();
  } catch (error) {
    throw new WithdrawalMethodError(502, `the card provider did not confirm issuance: ${(error as Error).message}`, 'card_provider_unconfirmed');
  }
  if (!payload || typeof payload.id !== 'string' || !/^ic_[A-Za-z0-9]+$/.test(payload.id) || typeof payload.last4 !== 'string' || !/^[0-9]{4}$/.test(payload.last4) || payload.livemode !== true) {
    throw new WithdrawalMethodError(502, 'the card provider response did not confirm a live issued card', 'card_provider_unconfirmed');
  }
  return recordIssuedCard(
    {
      provider: 'stripe-issuing',
      providerRef: String(payload.id),
      brand: payload.brand ? String(payload.brand) : null,
      last4: String(payload.last4),
      currency: String(payload.currency ?? input.currency ?? 'usd').toUpperCase(),
      status: String(payload.status ?? 'inactive'),
      label: (input.label ?? 'Mission card').slice(0, 120),
      evidence: `stripe issuing card ${payload.id} (livemode)`,
    },
    input.actorId,
  );
}

/** Write a provider-confirmed card. Never called with owner-typed numbers. */
export function recordIssuedCard(
  card: { provider: string; providerRef: string; brand: string | null; last4: string; currency: string; status: string; label: string; evidence: string },
  actorId: string,
): MissionCardView {
  return missionDb.transaction(() => {
    if (!/^[0-9]{4}$/.test(card.last4)) throw new WithdrawalMethodError(400, 'a card record requires the provider-confirmed last four digits', 'validation_error');
    const existing = listMissionCards();
    if (existing.length >= CARD_SLOT_COUNT) throw new WithdrawalMethodError(409, `a maximum of ${CARD_SLOT_COUNT} mission cards is supported`, 'limit_reached');
    const used = new Set(existing.map((entry) => entry.slot));
    const slot = [1, 2, 3, 4].find((candidate) => !used.has(candidate))!;
    const id = missionId('card');
    missionDb.run(
      `INSERT INTO mission_cards (id, slot, label, provider, provider_ref, brand, last4, currency, status, issued_at, issued_by, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, slot, card.label, card.provider, card.providerRef, card.brand, card.last4, card.currency, card.status, nowIso(), actorId, card.evidence, nowIso(), nowIso()],
    );
    appendMissionAudit({
      actorType: 'owner',
      actorId,
      action: 'card.issued',
      subjectType: 'card',
      subjectId: id,
      detail: { slot, provider: card.provider, providerRef: card.providerRef, last4: card.last4, status: card.status, evidence: card.evidence },
    });
    return listMissionCards().find((entry) => entry.id === id)!;
  });
}
