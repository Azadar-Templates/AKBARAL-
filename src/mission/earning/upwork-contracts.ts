/** Trusted server-side verifiers, NOT raw API schemas, HTTP payloads, or owner attestations.
 * Provider approval and durable-record permission must be independently established.
 * Adapters must honor approved scopes, consent/deletion terms and minimum-data rules.
 */
export interface UpworkProof { evidenceRef: string; verifiedAt: string }
export interface UpworkIdentity { accountId: string; tenantId: string }
export interface UpworkAuthority extends UpworkProof, UpworkIdentity {
  missionOwnerId: string; ownerControlVerified: boolean;
  accountType: 'individual'; identityVerified: boolean; eligible: boolean;
  lifetimeUsdCents: number; jobSuccessScore: number; goodStanding: boolean;
  internalApiUseApproved: boolean; contractReadApproved: boolean;
  deliveryReadApproved: boolean; paymentReadApproved: boolean;
  /** Verified written exception covering persisted identifiers/hashes/amounts,
   * immutable audit/financial records and post-termination retention. Not an owner checkbox. */
  durableRecordsApproved: boolean; permissionExpiresAt: string;
}
export interface UpworkContract extends UpworkProof, UpworkIdentity {
  contractId: string; milestoneId: string; clientId: string; scopeHash: string;
  kind: 'fixed'; currency: string; state: 'active' | 'completed' | 'cancelled';
  acceptedByBoth: boolean; hasAgency: boolean; suspended: boolean; disputed: boolean;
  aiAssistanceAllowed: boolean; clientDataUseAllowed: boolean;
  grossCents: number; fundedCents: number; releasedCents: number;
}
export interface UpworkDelivery extends UpworkProof, UpworkIdentity {
  contractId: string; milestoneId: string; clientId: string; submissionId: string;
  submittedAt: string; state: 'submitted'; content: string;
}
export interface UpworkRemittance extends UpworkProof, UpworkIdentity {
  payoutId: string; state: 'pending' | 'paid'; complete: boolean; currency: string;
  netCents: number;
  lines: Array<{contractId: string; milestoneId: string; currency: string; grossCents: number; feeCents: number; netCents: number}>;
}
export interface UpworkProvider extends UpworkIdentity {
  authority(signal: AbortSignal): Promise<UpworkAuthority>;
  contract(contractId: string, milestoneId: string, signal: AbortSignal): Promise<UpworkContract>;
  delivery(contractId: string, milestoneId: string, submissionId: string, signal: AbortSignal): Promise<UpworkDelivery>;
  remittance(payoutId: string, signal: AbortSignal): Promise<UpworkRemittance>;
}
export interface UpworkReceivingProof extends UpworkProof, UpworkIdentity {
  source: 'upwork'; payoutId: string; rail: string; receivingAccount: string;
  externalId: string; state: 'pending' | 'settled'; direction: 'credit'; currency: string;
  missionOwnershipVerified: boolean; grossCents: number; feeCents: number; netCents: number;
  availableBalanceCents: number;
}
export interface UpworkReversal extends UpworkProof, UpworkIdentity {
  source: 'upwork'; payoutId: string; rail: string; receivingAccount: string;
  originalExternalId: string; reversalExternalId: string;
  state: 'pending' | 'settled'; direction: 'debit'; currency: string;
  missionOwnershipVerified: boolean; amountCents: number;
}
export interface UpworkUsdReceiver {
  readonly rail: string; readonly receivingAccount: string;
  verify(input: UpworkIdentity & {payoutId: string; externalId: string}, signal: AbortSignal): Promise<UpworkReceivingProof>;
  reversal(input: UpworkIdentity & {payoutId: string; originalExternalId: string; reversalExternalId: string}, signal: AbortSignal): Promise<UpworkReversal>;
}
