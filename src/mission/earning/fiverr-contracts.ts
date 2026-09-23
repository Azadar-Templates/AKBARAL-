/** Trusted verifier contracts, NOT Fiverr API schemas or upload/request payloads.
 * No authorized public seller-order API is assumed. Platform actions are human-only.
 * Authorized own-account exports must be independently authenticated and reconciled;
 * an owner checkbox, CSV, screenshot, email sender or file hash alone is not proof.
 */
export interface FiverrProof {
  evidenceRef: string; verifiedAt: string; authenticityVerified: boolean;
}
export interface FiverrIdentity { accountId: string }
export interface FiverrAuthority extends FiverrProof, FiverrIdentity {
  missionOwnerId: string; ownerControlVerified: boolean;
  accountType: 'individual'; identityVerified: boolean; eligible: boolean; goodStanding: boolean;
  workflow: 'human_assisted'; evidenceUseAuthorized: boolean;
  orderReadApproved: boolean; deliveryReadApproved: boolean; paymentReadApproved: boolean;
  /** Lawful retention rights for this client's work and the minimized financial audit,
   * including post-termination retention. Not an assumed API/caching exemption. */
  durableRecordsApproved: boolean; permissionExpiresAt: string;
}
export interface FiverrOrder extends FiverrProof, FiverrIdentity {
  orderId: string; buyerId: string; scopeHash: string;
  kind: 'one_off_fixed'; currency: string; state: 'active' | 'completed' | 'cancelled';
  independentBuyerVerified: boolean;
  acceptedByBoth: boolean; suspended: boolean; disputed: boolean;
  aiAssistanceAllowed: boolean; clientDataUseAllowed: boolean; rightsCleared: boolean;
  /** Service price paid through Fiverr, excluding buyer-only fees/taxes. */
  grossCents: number; prepaidCents: number;
  clearance: 'pending' | 'cleared'; sellerEarningsCents: number;
}
export interface FiverrDelivery extends FiverrProof, FiverrIdentity {
  orderId: string; buyerId: string; submissionId: string;
  submittedAt: string; state: 'submitted'; content: string;
}
export interface FiverrRemittance extends FiverrProof, FiverrIdentity {
  payoutId: string; state: 'pending' | 'paid'; complete: boolean; currency: string;
  payoutFeeCents: number; netCents: number;
  // No loans, compensation, tips, purchases, refunds or unrelated orders in this lane.
  lines: Array<{kind: 'order_earning'; orderId: string; currency: string;
    grossCents: number; feeCents: number; netCents: number}>;
}
export interface FiverrProvider extends FiverrIdentity {
  authority(signal: AbortSignal): Promise<FiverrAuthority>;
  order(orderId: string, signal: AbortSignal): Promise<FiverrOrder>;
  delivery(orderId: string, submissionId: string, signal: AbortSignal): Promise<FiverrDelivery>;
  remittance(payoutId: string, signal: AbortSignal): Promise<FiverrRemittance>;
}
export interface FiverrReceivingProof extends FiverrProof, FiverrIdentity {
  source: 'fiverr'; payoutId: string; rail: string; receivingAccount: string;
  externalId: string; state: 'pending' | 'settled'; direction: 'credit'; currency: string;
  missionOwnershipVerified: boolean; grossCents: number; feeCents: number; netCents: number;
  availableBalanceCents: number;
}
export interface FiverrReversal extends FiverrProof, FiverrIdentity {
  source: 'fiverr'; payoutId: string; rail: string; receivingAccount: string;
  originalExternalId: string; reversalExternalId: string;
  state: 'pending' | 'settled'; direction: 'debit'; currency: string;
  missionOwnershipVerified: boolean; amountCents: number;
}
export interface FiverrUsdReceiver {
  /** Canonical institution/account identifiers shared with all connectors, not aliases. */
  readonly rail: string; readonly receivingAccount: string;
  verify(input: FiverrIdentity & {payoutId: string; externalId: string}, signal: AbortSignal): Promise<FiverrReceivingProof>;
  reversal(input: FiverrIdentity & {payoutId: string; originalExternalId: string; reversalExternalId: string}, signal: AbortSignal): Promise<FiverrReversal>;
}
