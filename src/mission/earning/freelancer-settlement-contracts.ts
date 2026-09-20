/** Trusted server-side read adapters, NOT Freelancer API response schemas or HTTP inputs.
 * No live adapters are installed. A token, bank memo, owner JSON or account balance
 * does not implement these contracts. Verification must read authoritative evidence.
 */
export interface FreelancerRemittanceLine {
  projectId: string; bidId: string; milestoneId: string;
  currency: string; grossCents: number; feeCents: number; netCents: number;
}
export interface FreelancerRemittance {
  userId: string; payoutId: string; state: 'pending' | 'paid'; currency: string;
  complete: boolean; netCents: number; evidenceRef: string; verifiedAt: string;
  /** Entire authoritative remittance, not inferred allocations from platform balances.
   * Partial, unattributed, mixed-currency/FX and >10-item batches are blocked.
   */
  lines: FreelancerRemittanceLine[];
}
export interface FreelancerRemittanceReader {
  readonly userId: string;
  verify(input: {userId: string; payoutId: string}, signal: AbortSignal): Promise<FreelancerRemittance>;
}
export interface FreelancerUsdSettlement {
  rail: string; receivingAccount: string; externalId: string;
  source: 'freelancer'; userId: string; payoutId: string;
  state: 'pending' | 'settled'; direction: 'credit'; currency: string;
  missionOwnershipVerified: boolean;
  grossCents: number; feeCents: number; netCents: number; availableBalanceCents: number;
  evidenceRef: string; verifiedAt: string;
}
export interface FreelancerUsdReversal {
  rail: string; receivingAccount: string; originalExternalId: string; reversalExternalId: string;
  source: 'freelancer'; userId: string; payoutId: string;
  state: 'pending' | 'settled'; direction: 'debit'; currency: string;
  missionOwnershipVerified: boolean; amountCents: number; evidenceRef: string; verifiedAt: string;
}
export interface FreelancerUsdReceiver {
  readonly rail: string; readonly receivingAccount: string;
  /** Independently match actual mission-owned receiving movement to the provider's
   * remittance/account. A transfer description, uploaded statement or signed caller
   * assertion alone is insufficient. No payment, withdrawal or conversion methods.
   */
  verify(input: {userId: string; payoutId: string; externalId: string}, signal: AbortSignal): Promise<FreelancerUsdSettlement>;
  verifyReversal(input: {userId: string; payoutId: string; originalExternalId: string; reversalExternalId: string}, signal: AbortSignal): Promise<FreelancerUsdReversal>;
}
