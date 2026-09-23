/** Trusted verifier contracts, NOT Contra API schemas or upload/request payloads.
 * No authorized public project/payment API is assumed. Platform actions are human-only.
 * Authorized own-account exports must be independently authenticated and reconciled;
 * an owner checkbox, CSV, screenshot, email sender or file hash alone is not proof.
 */
export interface ContraProof {
  evidenceRef: string; verifiedAt: string; authenticityVerified: boolean;
}
export interface ContraIdentity { accountId: string }
export interface ContraAuthority extends ContraProof, ContraIdentity {
  missionOwnerId: string; ownerControlVerified: boolean;
  role: 'independent';
  accountType: 'individual'; identityVerified: boolean; eligible: boolean; goodStanding: boolean;
  workflow: 'human_assisted'; evidenceUseAuthorized: boolean;
  projectReadApproved: boolean; deliveryReadApproved: boolean; paymentReadApproved: boolean;
  /** Lawful retention rights for this client's work and the minimized financial audit,
   * including post-termination retention. Not an assumed API/caching exemption. */
  durableRecordsApproved: boolean; permissionExpiresAt: string;
}
export interface ContraProject extends ContraProof, ContraIdentity {
  projectId: string; agreementId: string; agreementHash: string; clientId: string; scopeHash: string;
  directEngagementVerified: boolean; workerClassificationVerified: boolean;
  activity: 'software_development';
  kind: 'one_time_fixed_escrow'; currency: string; state: 'active' | 'completed' | 'cancelled';
  independentClientVerified: boolean;
  agreementSignedByBoth: boolean; suspended: boolean; disputed: boolean;
  aiAssistanceAllowed: boolean; clientDataUseAllowed: boolean; rightsCleared: boolean;
  /** Service price paid through Contra, excluding buyer-only fees/taxes. */
  grossCents: number; escrowFundedCents: number;
  fundsStatus: 'held' | 'released'; independentNetCents: number;
  upfrontReleasedCents: number; releasedGrossCents: number;
  clientAcceptance: 'pending' | 'explicit' | 'automatic'; acceptedDeliveryHash: string | null;
  paymentId: string | null;
}
export interface ContraDelivery extends ContraProof, ContraIdentity {
  projectId: string; agreementId: string; clientId: string; submissionId: string;
  submittedAt: string; state: 'submitted'; content: string;
}
export interface ContraRemittance extends ContraProof, ContraIdentity {
  payoutId: string; state: 'pending' | 'paid'; complete: boolean; currency: string;
  payoutFeeCents: number; netCents: number;
  // No loans, compensation, tips, purchases, refunds or unrelated orders in this lane.
  lines: Array<{kind: 'project_release'; projectId: string; agreementId: string; paymentId: string; currency: string;
    grossCents: number; feeCents: number; netCents: number}>;
}
export interface ContraProvider extends ContraIdentity {
  authority(signal: AbortSignal): Promise<ContraAuthority>;
  project(projectId: string, signal: AbortSignal): Promise<ContraProject>;
  delivery(projectId: string, submissionId: string, signal: AbortSignal): Promise<ContraDelivery>;
  remittance(payoutId: string, signal: AbortSignal): Promise<ContraRemittance>;
}
export interface ContraReceivingProof extends ContraProof, ContraIdentity {
  source: 'contra'; payoutId: string; rail: string; receivingAccount: string;
  externalId: string; state: 'pending' | 'settled'; direction: 'credit'; currency: string;
  missionOwnershipVerified: boolean; grossCents: number; feeCents: number; netCents: number;
  availableBalanceCents: number; fxApplied: boolean;
}
export interface ContraReversal extends ContraProof, ContraIdentity {
  source: 'contra'; payoutId: string; rail: string; receivingAccount: string;
  originalExternalId: string; reversalExternalId: string;
  state: 'pending' | 'settled'; direction: 'debit'; currency: string;
  missionOwnershipVerified: boolean; amountCents: number;
}
export interface ContraUsdReceiver {
  /** Canonical institution/account identifiers shared with all connectors, not aliases. */
  readonly rail: string; readonly receivingAccount: string;
  verify(input: ContraIdentity & {payoutId: string; externalId: string}, signal: AbortSignal): Promise<ContraReceivingProof>;
  reversal(input: ContraIdentity & {payoutId: string; originalExternalId: string; reversalExternalId: string}, signal: AbortSignal): Promise<ContraReversal>;
}
