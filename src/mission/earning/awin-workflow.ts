/** Durable Awin orchestration. HTTP accepts commands/IDs, never financial or property proof. */
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, grant, cashAccount, approveOpportunity, freezeCash, ensureCashAccount,
  verifyBoundMoneyReceipt, MoneyError, cents, type MoneyActor, type MoneyProvider } from '../money';
import { currentPolicy, checkActivity } from '../policy';
import { AwinError, type AwinPublisherClient, type AwinTransactionEvidence, configuredAwinClient } from './awin';
import type { AwinPublishingProvider, AwinSettlementProvider, AwinSettlementProof, PublicationProof } from './awin-contracts';

const LEDGER_PROVIDER = 'awin-settlement';
function deny(code: string): never { throw new MoneyError(`awin_${code}`); }
function required(value: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) deny('invalid_input');
  return value;
}
function origin(value: string): string {
  let url: URL; try { url = new URL(value); } catch { return deny('invalid_property'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') deny('invalid_property');
  return url.origin;
}
function get(table: string, id: string): Row {
  const row = db.get<Row>(`SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!row) deny('record_missing'); return row;
}
function event(subject: string, state: string, ref: string) {
  const sequence = Number(db.get<Row>('SELECT COALESCE(MAX(seq),0) AS n FROM mission_awin_events')?.n) + 1;
  db.run('INSERT INTO mission_awin_events (id,seq,subject_id,state,evidence_ref,created_at) VALUES (?,?,?,?,?,?)', [missionId('awe'), sequence, subject, state, ref, nowIso()]);
  appendMissionAudit({ actorType: 'system', actorId: null, action: `awin.${state}`, subjectType: 'awin', subjectId: subject, detail: { evidenceRef: ref } });
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function minor(decimal: string): number {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(decimal)) deny('unsupported_settlement_precision');
  const [whole, fraction = ''] = decimal.split('.');
  const amount = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  return cents(amount, true);
}
async function bounded<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MoneyError('awin_provider_timeout')), 30000); })]); }
  finally { clearTimeout(timer); }
}

export class AwinWorkflow {
  constructor(private readonly awin: AwinPublisherClient | null,
    private readonly publishing?: AwinPublishingProvider, private readonly settlement?: AwinSettlementProvider) {}
  private client(): AwinPublisherClient { if (!this.awin) deny('blocked_credentials'); return this.awin; }
  private publisher(): AwinPublishingProvider { if (!this.publishing) deny('blocked_property_not_configured'); return this.publishing; }
  private receiver(): AwinSettlementProvider { if (!this.settlement) deny('blocked_settlement_not_configured'); return this.settlement; }
  private live(actor: MoneyActor, assignment?: Row) {
    assertMoneyOwner(actor);
    const policy = currentPolicy();
    if (policy.killSwitch || !checkActivity('affiliate_programs', policy).allowed || !checkActivity('content_publishing', policy).allowed) deny('policy_blocked');
    if (Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities')?.n)) deny('unresolved_liability');
    if (Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen)) deny('cash_frozen');
    if (assignment) {
      grant(String(assignment.agent_id));
      if (Number(cashAccount(String(assignment.agent_id)).frozen)) deny('cash_frozen');
      if (assignment.state !== 'eligible' || assignment.publisher_id !== this.client().publisherId ||
        assignment.property_key !== origin(this.publisher().propertyKey) || Date.parse(String(assignment.verified_until)) <= Date.now()) deny('assignment_blocked');
    }
  }
  private assignment(id: string) { return get('mission_awin_assignments', id); }
  private job(id: string) { return get('mission_awin_publications', id); }
  private opportunity(a: Row) { return get('mission_awin_opportunities', String(a.opportunity_id)); }
  private async propertyProof(publisherId: string) {
    const provider = this.publisher(), key = origin(provider.propertyKey);
    const proof = structuredClone(await bounded(() => provider.verifyProperty(publisherId)));
    const expiry = Date.parse(proof.expiresAt);
    if (proof.propertyKey !== key || proof.publisherId !== publisherId || proof.permitted !== true || proof.incrementalCostCents !== 0 ||
      !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 86400000) deny('blocked_property_unverified');
    required(proof.evidenceRef); return proof;
  }
  overview(actor: MoneyActor) {
    assertMoneyOwner(actor);
    return { accounting: 'provider_settlement_required', configured: { awin: !!this.awin, publishing: !!this.publishing, settlement: !!this.settlement },
      blocked: [!this.awin && 'credentials', !this.publishing && 'property_not_configured', !this.settlement && 'settlement_not_configured'].filter(Boolean),
      opportunities: db.all<Row>('SELECT * FROM mission_awin_opportunities ORDER BY id LIMIT 200'),
      assignments: db.all<Row>('SELECT * FROM mission_awin_assignments ORDER BY id LIMIT 200'),
      publications: db.all<Row>('SELECT * FROM mission_awin_publications ORDER BY updated_at DESC LIMIT 200'),
      commissions: db.all<Row>('SELECT * FROM mission_awin_commissions ORDER BY updated_at DESC LIMIT 200'),
      payouts: db.all<Row>('SELECT * FROM mission_awin_payouts ORDER BY updated_at DESC LIMIT 200') };
  }
  async discover(actor: MoneyActor) {
    this.live(actor); const client = this.client(), leads = await client.discoverJoinedPrograms();
    return db.transaction(() => {
      this.live(actor);
      for (const lead of leads) {
        if (lead.status !== 'active' || lead.publisherId !== client.publisherId) continue;
        const id = `awin_${lead.publisherId}_${lead.advertiserId}`;
        if (!db.get('SELECT id FROM mission_awin_opportunities WHERE id=?', [id])) {
          db.run('INSERT INTO mission_awin_opportunities (id,publisher_id,advertiser_id,name,observed_at) VALUES (?,?,?,?,?)', [id, lead.publisherId, lead.advertiserId, lead.name, lead.observedAt]);
          event(id, 'discovered', 'https://api.awin.com/publishers/' + lead.publisherId + '/programmes');
        }
      }
      return db.all<Row>('SELECT * FROM mission_awin_opportunities WHERE publisher_id=?', [client.publisherId]);
    });
  }
  async assign(actor: MoneyActor, input: { agentId: string; opportunityId: string; destinationUrl: string }) {
    this.live(actor); grant(input.agentId);
    const client = this.client(), op = get('mission_awin_opportunities', input.opportunityId);
    if (op.publisher_id !== client.publisherId) deny('account_mismatch');
    await client.assertEligible({ advertiserId: String(op.advertiser_id), destinationUrl: input.destinationUrl });
    const proof = await this.propertyProof(client.publisherId);
    return db.transaction(() => {
      this.live(actor); grant(input.agentId);
      if (Date.parse(proof.expiresAt) <= Date.now()) deny('blocked_property_unverified');
      if (db.get('SELECT id FROM mission_awin_assignments WHERE agent_id=? OR publisher_id=? OR property_key=? OR opportunity_id=?', [input.agentId, client.publisherId, proof.propertyKey, op.id])) deny('exclusive_assignment_conflict');
      const money = approveOpportunity(actor, { title: String(op.name), evidenceUrl: `https://api.awin.com/publishers/${client.publisherId}/programmedetails?advertiserId=${op.advertiser_id}`, activity: 'affiliate_programs', provider: LEDGER_PROVIDER });
      const id = missionId('awa');
      db.run(`INSERT INTO mission_awin_assignments (id,agent_id,publisher_id,property_key,opportunity_id,money_opportunity_id,destination_url,state,property_evidence,verified_until,approved_by,created_at) VALUES (?,?,?,?,?,?,?,'eligible',?,?,?,?)`,
        [id, input.agentId, client.publisherId, proof.propertyKey, op.id, money.id, input.destinationUrl, proof.evidenceRef, proof.expiresAt, actor.id, nowIso()]);
      db.run("UPDATE mission_awin_opportunities SET state='eligible' WHERE id=?", [op.id]);
      event(id, 'eligible', proof.evidenceRef); return this.assignment(id);
    });
  }
  async refreshAssignment(actor: MoneyActor, assignmentId: string) {
    this.live(actor); const a = this.assignment(assignmentId); grant(String(a.agent_id));
    if (a.state !== 'eligible' || a.publisher_id !== this.client().publisherId) deny('assignment_blocked');
    await this.client().assertEligible({ advertiserId: String(this.opportunity(a).advertiser_id), destinationUrl: String(a.destination_url) });
    const proof = await this.propertyProof(String(a.publisher_id));
    return db.transaction(() => {
      this.live(actor); grant(String(a.agent_id));
      if (this.assignment(assignmentId).state !== 'eligible' || proof.propertyKey !== a.property_key || Date.parse(proof.expiresAt) <= Date.now()) deny('assignment_blocked');
      db.run('UPDATE mission_awin_assignments SET property_evidence=?,verified_until=? WHERE id=?', [proof.evidenceRef, proof.expiresAt, assignmentId]);
      event(assignmentId, 'eligibility_refreshed', proof.evidenceRef); return this.assignment(assignmentId);
    });
  }
  revoke(actor: MoneyActor, assignmentId: string) {
    assertMoneyOwner(actor);
    db.transaction(() => { this.assignment(assignmentId); db.run("UPDATE mission_awin_assignments SET state='revoked' WHERE id=?", [assignmentId]); event(assignmentId, 'revoked', actor.id); });
  }
  draft(actor: MoneyActor, assignmentId: string, input: { key: string; title: string; body: string }) {
    required(input.key); required(input.title, 200); required(input.body, 30000);
    return db.transaction(() => {
      const a = this.assignment(assignmentId); this.live(actor, a);
      const fingerprint = sha256(JSON.stringify([assignmentId, input.title, input.body]));
      const old = db.get<Row>('SELECT * FROM mission_awin_publications WHERE idempotency_key=?', [input.key]);
      if (old) { if (old.input_hash !== fingerprint) deny('idempotency_conflict'); return old; }
      const id = missionId('awp');
      db.run(`INSERT INTO mission_awin_publications (id,assignment_id,idempotency_key,input_hash,title,body,destination_url,state,updated_at) VALUES (?,?,?,?,?,?,?,'eligible',?)`, [id, assignmentId, input.key, fingerprint, input.title, input.body, a.destination_url, nowIso()]);
      event(id, 'eligible', a.property_evidence as string); return this.job(id);
    });
  }
  async prepare(actor: MoneyActor, publicationId: string) {
    const job = db.transaction(() => {
      const j = this.job(publicationId); this.live(actor, this.assignment(String(j.assignment_id)));
      if (j.state !== 'eligible') deny('preparation_requires_reconciliation');
      db.run("UPDATE mission_awin_publications SET state='link_creating',updated_at=? WHERE id=?", [nowIso(), publicationId]); return j;
    });
    let open = true;
    try {
      const a = this.assignment(String(job.assignment_id)); await this.propertyProof(String(a.publisher_id));
      const link = await this.client().createTrackingLink({ advertiserId: String(this.opportunity(a).advertiser_id), destinationUrl: String(job.destination_url), clickRef: publicationId }, () => db.transaction(() => {
        if (!open) deny('dispatch_closed'); this.live(actor, this.assignment(String(job.assignment_id)));
        if (this.job(publicationId).state !== 'link_creating') deny('dispatch_closed');
      }));
      return db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        const html = `<p>${escape(String(job.body)).replace(/\n/g, '<br>')}</p><p>Disclosure: We may earn a commission from purchases through this affiliate link.</p><p><a rel="sponsored nofollow" href="${escape(link.url)}">View offer</a></p>`;
        const hash = sha256(JSON.stringify([String(job.title), html]));
        db.run("UPDATE mission_awin_publications SET tracking_url=?,content_html=?,content_hash=?,state='awaiting_owner',updated_at=? WHERE id=? AND state='link_creating'", [link.url, html, hash, nowIso(), publicationId]);
        event(publicationId, 'awaiting_owner', hash); return this.job(publicationId);
      });
    } catch (error) {
      db.transaction(() => { db.run("UPDATE mission_awin_publications SET state=?,updated_at=? WHERE id=? AND state='link_creating'", [error instanceof AwinError && !error.effectMayHaveOccurred ? 'blocked' : 'unknown_link', nowIso(), publicationId]); });
      throw new MoneyError('awin_preparation_blocked_or_uncertain');
    } finally { open = false; }
  }
  approvePublication(actor: MoneyActor, publicationId: string, contentHash: string) {
    return db.transaction(() => {
      const j = this.job(publicationId); this.live(actor, this.assignment(String(j.assignment_id)));
      if (j.state !== 'awaiting_owner' || !contentHash || j.content_hash !== contentHash) deny('approval_content_mismatch');
      db.run('UPDATE mission_awin_publications SET approved_hash=?,approved_by=? WHERE id=?', [contentHash, actor.id, publicationId]);
      event(publicationId, 'owner_authorized', contentHash); return this.job(publicationId);
    });
  }
  private recordPublication(id: string, proof: PublicationProof | null) {
    if (!proof || proof.state !== 'published') deny('publication_unconfirmed');
    const j = this.job(id), a = this.assignment(String(j.assignment_id));
    let url: URL; try { url = new URL(proof.url); } catch { return deny('publication_identity_mismatch'); }
    if (proof.key !== id || proof.propertyKey !== a.property_key || proof.contentHash !== j.content_hash ||
      url.origin !== a.property_key || url.username || url.password || url.hash || j.approved_hash !== j.content_hash || !j.approved_by) deny('publication_identity_mismatch');
    required(proof.externalId);
    if (j.external_id && (j.external_id !== proof.externalId || j.publication_url !== proof.url)) deny('publication_identity_mismatch');
    db.run("UPDATE mission_awin_publications SET state='published',external_id=?,publication_url=?,updated_at=? WHERE id=?", [proof.externalId, proof.url, nowIso(), id]);
    event(id, 'published', proof.externalId); return this.job(id);
  }
  async publish(actor: MoneyActor, publicationId: string) {
    const j = this.job(publicationId), a = this.assignment(String(j.assignment_id)); this.live(actor, a);
    if (j.state !== 'awaiting_owner' || j.approved_hash !== j.content_hash || !j.approved_by) deny('owner_publication_approval_required');
    const proof = await this.propertyProof(String(a.publisher_id));
    await this.client().assertEligible({ advertiserId: String(this.opportunity(a).advertiser_id), destinationUrl: String(j.destination_url) });
    db.transaction(() => {
      this.live(actor, this.assignment(String(j.assignment_id)));
      const current = this.job(publicationId);
      if (current.state !== 'awaiting_owner' || current.approved_hash !== j.content_hash) deny('publication_already_claimed');
      db.run('UPDATE mission_awin_assignments SET property_evidence=?,verified_until=? WHERE id=?', [proof.evidenceRef, proof.expiresAt, a.id]);
      db.run("UPDATE mission_awin_publications SET state='publishing',updated_at=? WHERE id=?", [nowIso(), publicationId]);
    });
    let open = true, authorized = false;
    try {
      const result = await bounded(() => this.publisher().publish({ key: publicationId, title: String(j.title), html: String(j.content_html), contentHash: String(j.content_hash) }, () => db.transaction(() => {
        if (!open || authorized || Date.parse(proof.expiresAt) <= Date.now()) deny('dispatch_closed');
        this.live(actor, this.assignment(String(j.assignment_id)));
        const current = this.job(publicationId);
        if (current.state !== 'publishing' || current.approved_hash !== current.content_hash) deny('dispatch_closed');
        authorized = true;
      })));
      if (!authorized) deny('final_authorization_missing');
      return db.transaction(() => this.recordPublication(publicationId, result));
    } catch {
      db.transaction(() => { db.run("UPDATE mission_awin_publications SET state='unknown_publish',updated_at=? WHERE id=? AND state='publishing'", [nowIso(), publicationId]); event(publicationId, 'unknown_publish', 'read_only_reconciliation_required'); });
      return this.job(publicationId);
    } finally { open = false; }
  }
  async reconcilePublication(actor: MoneyActor, publicationId: string) {
    assertMoneyOwner(actor); const j = this.job(publicationId);
    if (!['publishing', 'unknown_publish', 'published'].includes(String(j.state))) deny('publication_not_dispatched');
    if (origin(this.publisher().propertyKey) !== this.assignment(String(j.assignment_id)).property_key) deny('property_mismatch');
    const proof = await bounded(() => this.publisher().lookup(publicationId));
    return db.transaction(() => { assertMoneyOwner(actor); return this.recordPublication(publicationId, proof); });
  }
  private review(actor: MoneyActor, ref: string) {
    ensureCashAccount();
    for (const account of db.all<Row>('SELECT id FROM mission_cash_accounts')) freezeCash(actor, String(account.id), true);
    event(ref, 'settlement_review', 'provider_evidence_changed');
  }
  private recordCommissions(actor: MoneyActor, publicationId: string, evidence: AwinTransactionEvidence[], missing: string[]) {
    const j = this.job(publicationId), a = this.assignment(String(j.assignment_id));
    if (j.state !== 'published') deny('publication_unconfirmed');
    for (const row of evidence) {
      if (row.publisherId !== a.publisher_id || row.advertiserId !== this.opportunity(a).advertiser_id || row.clickRef !== publicationId) deny('conversion_identity_mismatch');
      const old = db.get<Row>('SELECT * FROM mission_awin_commissions WHERE publisher_id=? AND transaction_id=?', [row.publisherId, row.transactionId]);
      if (old && old.publication_id !== publicationId) deny('conversion_already_assigned');
      const hash = sha256(JSON.stringify([row.commissionStatus, row.commissionAmount, row.paidToPublisher, row.paymentId]));
      db.run('INSERT INTO mission_awin_evidence (publisher_id,transaction_id,evidence_hash,snapshot_json,observed_at) VALUES (?,?,?,?,?) ON CONFLICT(publisher_id,transaction_id,evidence_hash) DO NOTHING', [row.publisherId,row.transactionId,hash,JSON.stringify(row),row.observedAt]);
      if (old?.evidence_hash === hash) continue;
      if (old && ['provider_confirmed', 'mission_cash_eligible', 'settlement_review', 'reversed'].includes(String(old.state))) {
        db.run("UPDATE mission_awin_commissions SET state='settlement_review',updated_at=? WHERE publisher_id=? AND transaction_id=?", [nowIso(), row.publisherId, row.transactionId]);
        this.review(actor, row.transactionId); continue;
      }
      let state = 'conversion';
      if (!old) event(row.transactionId, 'conversion', row.transactionId);
      if (row.commissionStatus === 'approved') { state = 'approved'; event(row.transactionId, state, row.transactionId); }
      if (row.commissionStatus === 'declined' || row.commissionStatus === 'deleted') { state = 'rejected'; event(row.transactionId, state, row.transactionId); }
      else if (row.paidToPublisher) {
        if (row.commissionStatus !== 'approved' || !row.paymentId) deny('inconsistent_paid_commission');
        state = 'paid'; event(row.transactionId, state, row.paymentId);
      }
      if (old && state === 'conversion') event(row.transactionId, state, row.transactionId);
      if (old) db.run('UPDATE mission_awin_commissions SET state=?,amount_decimal=?,currency=?,payment_id=?,evidence_hash=?,updated_at=? WHERE publisher_id=? AND transaction_id=?', [state, row.commissionAmount.decimal, row.commissionAmount.currency, row.paymentId, hash, nowIso(), row.publisherId, row.transactionId]);
      else db.run('INSERT INTO mission_awin_commissions (publisher_id,transaction_id,publication_id,state,amount_decimal,currency,payment_id,evidence_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [row.publisherId, row.transactionId, publicationId, state, row.commissionAmount.decimal, row.commissionAmount.currency, row.paymentId, hash, nowIso()]);
    }
    for (const id of missing) {
      const old = db.get<Row>('SELECT * FROM mission_awin_commissions WHERE publisher_id=? AND transaction_id=?', [a.publisher_id, id]);
      if (old) { db.run("UPDATE mission_awin_commissions SET state='settlement_review' WHERE publisher_id=? AND transaction_id=?", [a.publisher_id, id]); this.review(actor, id); }
    }
  }
  async sync(actor: MoneyActor, publicationId: string, ids: string[]) {
    assertMoneyOwner(actor); const j = this.job(publicationId), a = this.assignment(String(j.assignment_id));
    if (j.state !== 'published' || this.client().publisherId !== a.publisher_id) deny('publication_unconfirmed');
    const result = await this.client().transactionsByIds({ ids, advertiserId: String(this.opportunity(a).advertiser_id), clickRef: publicationId });
    db.transaction(() => { assertMoneyOwner(actor); this.recordCommissions(actor, publicationId, result.transactions, result.unreturnedIds); });
  }
  async scan(actor: MoneyActor, publicationId: string, startDate: string, endDate: string) {
    assertMoneyOwner(actor); const j = this.job(publicationId), a = this.assignment(String(j.assignment_id));
    if (j.state !== 'published' || this.client().publisherId !== a.publisher_id) deny('publication_unconfirmed');
    const result = await this.client().transactionsForWindow({ advertiserId: String(this.opportunity(a).advertiser_id), clickRef: publicationId, startDate, endDate });
    db.transaction(() => { assertMoneyOwner(actor); this.recordCommissions(actor, publicationId, result.transactions, []); });
    // No cursor advancement or inference that an omitted transaction disappeared.
    return { observed: result.transactions.length, startDate, endDate };
  }
  private payoutRows(publisherId: string, paymentId: string) {
    return db.all<Row>(`SELECT c.*,p.assignment_id FROM mission_awin_commissions c JOIN mission_awin_publications p ON p.id=c.publication_id WHERE c.publisher_id=? AND c.payment_id=? ORDER BY c.transaction_id`, [publisherId, paymentId]);
  }
  async reconcilePayout(actor: MoneyActor, paymentId: string, externalId: string) {
    assertMoneyOwner(actor); required(paymentId); required(externalId);
    const receiver = this.receiver(), publisherId = this.client().publisherId;
    const rows = this.payoutRows(publisherId, paymentId);
    if (!rows.length || rows.length > 100) deny('payout_items_missing_or_over_limit');
    // Re-fetch all claimed Awin items before asking the receiving provider. No stale paid flags.
    for (const publication of new Set(rows.map(r => String(r.publication_id)))) await this.sync(actor, publication, rows.filter(r => r.publication_id === publication).map(r => String(r.transaction_id)));
    const receiptId = 'incoming:' + sha256(JSON.stringify([receiver.rail, receiver.receivingAccount, externalId]));
    db.transaction(() => {
      assertMoneyOwner(actor);
      const old = db.get<Row>('SELECT * FROM mission_awin_payouts WHERE publisher_id=? AND payment_id=?', [publisherId, paymentId]);
      if (old && (old.receipt_id !== receiptId || old.external_id !== externalId)) deny('payout_binding_conflict');
      if (!old) db.run("INSERT INTO mission_awin_payouts (publisher_id,payment_id,rail,receiving_account,external_id,receipt_id,state,updated_at) VALUES (?,?,?,?,?,?,'pending',?)", [publisherId, paymentId, receiver.rail, receiver.receivingAccount, externalId, receiptId, nowIso()]);
    });
    let proof: AwinSettlementProof;
    const provider: MoneyProvider = { id: LEDGER_PROVIDER, supports: () => false, pay: async () => deny('outbound_payment_forbidden'), lookup: async () => deny('outbound_payment_forbidden'),
      verifyReceipt: async () => {
        proof = structuredClone(await bounded(() => receiver.verify({ publisherId, paymentId, externalId })));
        if (proof.state !== 'settled' || proof.rail !== receiver.rail || proof.receivingAccount !== receiver.receivingAccount || proof.externalId !== externalId || proof.publisherId !== publisherId || proof.paymentId !== paymentId) deny('settlement_unconfirmed');
        const a = this.assignment(String(rows[0].assignment_id));
        return { externalId: receiptId, amountCents: cents(proof.netCents, true), currency: proof.currency, kind: 'earning', agentId: String(a.agent_id), availableBalanceCents: cents(proof.availableBalanceCents) };
      } };
    try {
      return await verifyBoundMoneyReceipt(actor, provider, receiptId, () => {
        const current = this.payoutRows(publisherId, paymentId), payout = db.get<Row>('SELECT * FROM mission_awin_payouts WHERE publisher_id=? AND payment_id=?', [publisherId, paymentId])!;
        if (!current.length || !Array.isArray(proof.lines) || current.length !== proof.lines.length || new Set(proof.lines.map(l => l.transactionId)).size !== current.length) deny('incomplete_payout');
        if (!['USD','EUR','GBP','CAD','AUD'].includes(proof.currency) || proof.currency !== currentPolicy().currency) deny('settlement_currency_mismatch');
        let total = 0;
        const a = this.assignment(String(current[0].assignment_id));
        for (const row of current) {
          const line = proof.lines.find(l => l.transactionId === row.transaction_id);
          if (!line || row.assignment_id !== a.id || !['paid','mission_cash_eligible'].includes(String(row.state)) || row.currency !== proof.currency || line.currency !== proof.currency ||
            cents(line.grossCents, true) !== minor(String(row.amount_decimal)) || cents(line.feeCents) + cents(line.netCents) !== line.grossCents) deny('payout_item_mismatch');
          total += line.netCents;
        }
        if (cents(total, true) !== proof.netCents) deny('payout_total_mismatch');
        const fingerprint = sha256(JSON.stringify([proof.currency, proof.netCents, [...proof.lines].sort((x,y) => x.transactionId.localeCompare(y.transactionId))]));
        if (payout.fingerprint && payout.fingerprint !== fingerprint) deny('settlement_changed');
        if (payout.state === 'reversed' || Number(payout.reversed_cents)) deny('settlement_reversed');
        const jobId = 'awcash_' + sha256(receiptId);
        if (!db.get('SELECT id FROM mission_earning_jobs WHERE id=?', [jobId])) db.run("INSERT INTO mission_earning_jobs (id,agent_id,opportunity_id,idempotency_key,state,provider_ref,created_at,updated_at) VALUES (?,?,?,?,'awaiting_payment',?,?,?)", [jobId, a.agent_id, a.money_opportunity_id, jobId, externalId, nowIso(), nowIso()]);
        if (payout.state !== 'mission_cash_eligible') {
          event(paymentId, 'provider_confirmed', receiptId);
          for (const row of current) {
            event(String(row.transaction_id), 'provider_confirmed', receiptId);
            db.run("UPDATE mission_awin_commissions SET state='mission_cash_eligible',updated_at=? WHERE publisher_id=? AND transaction_id=?", [nowIso(), publisherId, row.transaction_id]);
            event(String(row.transaction_id), 'mission_cash_eligible', receiptId);
          }
          db.run("UPDATE mission_awin_payouts SET state='mission_cash_eligible',net_cents=?,fingerprint=?,updated_at=? WHERE publisher_id=? AND payment_id=?", [proof.netCents, fingerprint, nowIso(), publisherId, paymentId]);
          event(paymentId, 'mission_cash_eligible', receiptId);
        }
        return get('mission_earning_jobs', jobId);
      });
    } catch {
      db.transaction(() => {
        const payout = db.get<Row>('SELECT * FROM mission_awin_payouts WHERE publisher_id=? AND payment_id=?', [publisherId, paymentId]);
        if (payout?.state === 'mission_cash_eligible') this.review(actor, paymentId);
        else db.run("UPDATE mission_awin_payouts SET state='unknown',updated_at=? WHERE publisher_id=? AND payment_id=?", [nowIso(), publisherId, paymentId]);
      });
      throw new MoneyError('awin_settlement_blocked_or_uncertain');
    }
  }
  async reconcileReversal(actor: MoneyActor, paymentId: string, reversalExternalId: string) {
    assertMoneyOwner(actor); required(reversalExternalId);
    const receiver = this.receiver(), publisherId = this.client().publisherId;
    const payout = db.get<Row>('SELECT * FROM mission_awin_payouts WHERE publisher_id=? AND payment_id=?', [publisherId, paymentId]);
    if (!payout?.net_cents || payout.rail !== receiver.rail || payout.receiving_account !== receiver.receivingAccount) deny('original_settlement_missing');
    const receiptId = 'reversal:' + sha256(JSON.stringify([receiver.rail, receiver.receivingAccount, reversalExternalId]));
    const provider: MoneyProvider = { id: LEDGER_PROVIDER, supports: () => false, pay: async () => deny('outbound_payment_forbidden'), lookup: async () => deny('outbound_payment_forbidden'), verifyReceipt: async () => {
      const proof = await bounded(() => receiver.verifyReversal({ originalExternalId: String(payout.external_id), reversalExternalId }));
      if (proof.state !== 'settled' || proof.rail !== receiver.rail || proof.receivingAccount !== receiver.receivingAccount || proof.originalExternalId !== payout.external_id || proof.reversalExternalId !== reversalExternalId || proof.currency !== currentPolicy().currency) deny('reversal_unconfirmed');
      return { externalId: receiptId, kind: 'reversal', originalExternalId: String(payout.receipt_id), amountCents: cents(proof.amountCents, true), currency: proof.currency };
    } };
    return verifyBoundMoneyReceipt(actor, provider, receiptId, receipt => {
      const current = db.get<Row>('SELECT * FROM mission_awin_payouts WHERE publisher_id=? AND payment_id=?', [publisherId, paymentId])!;
      if (!db.get('SELECT external_id FROM mission_money_receipts WHERE provider=? AND external_id=?', [LEDGER_PROVIDER, receiptId])) {
        const reversed = Number(current.reversed_cents) + receipt.amountCents;
        if (reversed > Number(current.net_cents)) deny('reversal_exceeds_settlement');
        const state = reversed === Number(current.net_cents) ? 'reversed' : 'settlement_review';
        db.run('UPDATE mission_awin_payouts SET reversed_cents=?,state=?,updated_at=? WHERE publisher_id=? AND payment_id=?', [reversed, state, nowIso(), publisherId, paymentId]);
        db.run('UPDATE mission_awin_commissions SET state=?,updated_at=? WHERE publisher_id=? AND payment_id=?', [state, nowIso(), publisherId, paymentId]);
        event(paymentId, state, receiptId);
      }
      return undefined;
    });
  }
}
/** No property/receiving-provider was selected by the owner. Do not install pretend adapters. */
export function reserveAwinRequest() {
  db.transaction(() => {
    const now = nowIso(), cutoff = new Date(Date.now() - 60000).toISOString();
    const cooldown = db.get<Row>("SELECT until_at FROM mission_awin_api_cooldown WHERE id='global'");
    if (cooldown && String(cooldown.until_at) > now) deny('rate_limited');
    db.run('DELETE FROM mission_awin_api_requests WHERE started_at<=?', [cutoff]);
    if (Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_awin_api_requests')?.n) >= 20) deny('rate_limited');
    db.run('INSERT INTO mission_awin_api_requests (id,started_at) VALUES (?,?)', [missionId('awr'), now]);
  });
}
export function recordAwinCooldown(delayMs: number) {
  const until = new Date(Math.min(Date.now() + Math.max(60000, delayMs), 253402300799999)).toISOString();
  db.transaction(() => {
    const old = db.get<Row>("SELECT until_at FROM mission_awin_api_cooldown WHERE id='global'");
    if (!old) db.run("INSERT INTO mission_awin_api_cooldown (id,until_at) VALUES ('global',?)", [until]);
    else if (String(old.until_at) < until) db.run("UPDATE mission_awin_api_cooldown SET until_at=? WHERE id='global'", [until]);
  });
}
export function configuredAwinWorkflow() {
  return new AwinWorkflow(configuredAwinClient(process.env, { beforeRequest: reserveAwinRequest, onRateLimit: recordAwinCooldown }));
}
