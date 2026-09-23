/** Trusted server-side adapters, never constructed from HTTP bodies or owner attestations.
 * No live property or settlement adapter is configured. Fixture adapters live in tests only.
 */
export interface PropertyProof {
  propertyKey: string; publisherId: string; permitted: boolean;
  /** Existing preapproved capacity only; unknown or chargeable publication is refused. */
  incrementalCostCents: number;
  evidenceRef: string; expiresAt: string;
}
export interface PublicationDocument { key: string; title: string; html: string; contentHash: string }
export interface PublicationProof {
  key: string; propertyKey: string; externalId: string; url: string;
  contentHash: string; state: 'published' | 'pending';
}
export interface AwinPublishingProvider {
  readonly propertyKey: string;
  /** Verify property control AND permission for this Awin publisher/property combination.
   * CMS write access alone is insufficient. No signing up or accepting terms automatically.
   */
  verifyProperty(publisherId: string): Promise<PropertyProof>;
  /** Must invoke authorizeSend immediately before every external mutation; no blind retries.
   * Must not incur unapproved charges. If costs cannot be bounded to preapproved existing
   * capacity, refuse. Does not get any treasury/payment credential.
   */
  publish(document: PublicationDocument, authorizeSend: () => void): Promise<PublicationProof>;
  /** Read only, exact persistent key, actual content hash, authenticated publication status.
   * null is unresolved, NOT permission to repeat the POST.
   */
  lookup(key: string): Promise<PublicationProof | null>;
}
export interface AwinPayoutLine {
  transactionId: string; grossCents: number; feeCents: number; netCents: number; currency: string;
}
export interface AwinSettlementProof {
  rail: string; receivingAccount: string; externalId: string;
  publisherId: string; paymentId: string; state: 'pending' | 'settled';
  currency: string; netCents: number; availableBalanceCents: number;
  /** Independently verified Awin remittance itemization matched to the actual receiving
   * account movement. Not allocations supplied by an owner, agent, bank memo or webhook.
   * Complete batch only; partial/FX/unattributed payouts remain blocked.
   */
  lines: AwinPayoutLine[];
}
export interface AwinReversalProof {
  rail: string; receivingAccount: string; originalExternalId: string; reversalExternalId: string;
  state: 'pending' | 'settled'; amountCents: number; currency: string;
}
export interface AwinSettlementProvider {
  readonly rail: string;
  readonly receivingAccount: string;
  verify(input: { publisherId: string; paymentId: string; externalId: string }): Promise<AwinSettlementProof>;
  verifyReversal(input: { originalExternalId: string; reversalExternalId: string }): Promise<AwinReversalProof>;
}
