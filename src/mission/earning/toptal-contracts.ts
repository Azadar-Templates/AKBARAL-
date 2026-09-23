/** Internal trusted-verifier contracts, NOT documented Toptal APIs, portal schemas,
 * HTTP inputs or a permission to scrape. The disabled factory accepts no uploaded
 * proof. An approved future verifier must authenticate original engagement,
 * talent-payment, timesheet and remittance records independently of owner claims.
 * Hashes, screenshots, CSVs, email senders and checkboxes alone are not proof.
 */
export interface ToptalProof { evidenceRef: string; verifiedAt: string; authenticityVerified: boolean }
export interface ToptalIdentity { accountId: string }
export interface ToptalAuthority extends ToptalProof, ToptalIdentity {
  missionOwnerId: string; ownerControlVerified: boolean; role: 'talent';
  accountType: 'individual'; identityVerified: boolean; screenedTalentVerified: boolean;
  eligible: boolean; goodStanding: boolean; workflow: 'human_assisted';
  evidenceUseAuthorized: boolean; periodReadApproved: boolean; deliveryReadApproved: boolean;
  paymentReadApproved: boolean; durableRecordsApproved: boolean; permissionExpiresAt: string;
}
/** One immutable, owner-selected hourly engagement period, <= 7 days (a local
 * safety limit, not a claim about Toptal's billing cycle). The authenticated
 * provider-approved timesheet and earned talent payment are aggregated here.
 * Gross is actual TALENT remuneration, not the client's marked-up invoice.
 * Before approved payable work: gross/net/minutes = 0, IDs = null, intervals = [].
 */
export interface ToptalPeriod extends ToptalProof, ToptalIdentity {
  periodId: string; engagementId: string; agreementId: string; agreementHash: string;
  clientId: string; scopeHash: string; activity: 'software_development'; kind: 'hourly'; currency: string;
  state: 'active' | 'completed' | 'cancelled'; signedEngagementVerified: boolean;
  independentClientVerified: boolean; workerClassificationVerified: boolean;
  trial: boolean; suspended: boolean; disputed: boolean;
  providerAssistanceAllowed: boolean; aiAssistanceAllowed: boolean;
  clientDataUseAllowed: boolean; rightsCleared: boolean;
  rateCents: number; authorizedMinutes: number; periodStart: string; periodEnd: string;
  paymentStatus: 'unpaid' | 'paid'; payableWorkAccepted: boolean; acceptedDeliveryHash: string | null;
  grossCents: number; talentNetCents: number; paymentId: string | null;
  timesheetId: string | null; timesheetApproved: boolean; timesheetApprovedAt: string | null;
  humanWorkVerified: boolean; nonOverlappingWorkVerified: boolean; agentRuntimeExcluded: boolean;
  billedMinutes: number; workIntervals: Array<{start: string; end: string}>;
}
export interface ToptalDelivery extends ToptalProof, ToptalIdentity {
  periodId: string; engagementId: string; agreementId: string; clientId: string; submissionId: string;
  channelApproved: boolean; submittedAt: string; state: 'submitted'; content: string;
}
export interface ToptalRemittance extends ToptalProof, ToptalIdentity {
  payoutId: string; state: 'pending' | 'paid'; complete: boolean; currency: string;
  payoutFeeCents: number; netCents: number;
  // One fully attributed talent payment. No trial, loans, tips, expenses or mixed payouts.
  lines: Array<{kind: 'hourly_work'; periodId: string; engagementId: string; agreementId: string;
    timesheetId: string; paymentId: string; currency: string; grossCents: number; feeCents: number; netCents: number}>;
}
export interface ToptalProvider extends ToptalIdentity {
  authority(signal: AbortSignal): Promise<ToptalAuthority>;
  period(periodId: string, signal: AbortSignal): Promise<ToptalPeriod>;
  delivery(periodId: string, submissionId: string, signal: AbortSignal): Promise<ToptalDelivery>;
  remittance(payoutId: string, signal: AbortSignal): Promise<ToptalRemittance>;
}
export interface ToptalReceivingProof extends ToptalProof, ToptalIdentity {
  source: 'toptal'; payoutId: string; rail: string; receivingAccount: string;
  externalId: string; state: 'pending' | 'settled'; direction: 'credit'; currency: string;
  missionOwnershipVerified: boolean; grossCents: number; feeCents: number; netCents: number;
  availableBalanceCents: number; fxApplied: boolean;
}
export interface ToptalReversal extends ToptalProof, ToptalIdentity {
  source: 'toptal'; payoutId: string; rail: string; receivingAccount: string;
  originalExternalId: string; reversalExternalId: string;
  state: 'pending' | 'settled'; direction: 'debit'; currency: string;
  missionOwnershipVerified: boolean; amountCents: number;
}
export interface ToptalUsdReceiver {
  /** Canonical institution/account identifiers, shared across ALL connectors. */
  readonly rail: string; readonly receivingAccount: string;
  verify(input: ToptalIdentity & {payoutId: string; externalId: string}, signal: AbortSignal): Promise<ToptalReceivingProof>;
  reversal(input: ToptalIdentity & {payoutId: string; originalExternalId: string; reversalExternalId: string}, signal: AbortSignal): Promise<ToptalReversal>;
}
