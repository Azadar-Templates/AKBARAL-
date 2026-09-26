import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-withdrawal-')), 'mission.db')}`;
process.env.ZA141251SA_CREDENTIAL_KEY = 'synthetic-withdrawal-vault-key-not-real-0123456789';
delete process.env.ZA141251SA_STRIPE_SECRET_KEY;
delete process.env.ZA141251SA_STRIPE_ACCOUNT_ID;

const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { decryptCredential } = require('./auth') as typeof import('./auth');
const methods = require('./withdrawal-methods') as typeof import('./withdrawal-methods');

const owner = `synthetic-owner-${randomUUID()}`;
// Synthetic test values only — no real bank data is ever placed in a fixture.
const ACCOUNT = '00123456789012347777';
const LAST4 = ACCOUNT.slice(-4);

before(() => applyMissionMigrations());
after(() => missionDb.close());

test('no withdrawal method exists until the owner adds one', () => {
  assert.deepEqual(methods.listWithdrawalMethods(), []);
});

test('an added method is stored encrypted and surfaced only as a masked description', () => {
  const view = methods.addWithdrawalMethod({
    type: 'bank_local',
    values: { bankName: 'Synthetic Test Bank', holderName: 'Synthetic Owner', accountNumber: ACCOUNT, currency: 'PKR' },
    actorId: owner,
  });

  assert.equal(view.slot, 1);
  assert.equal(view.type, 'bank_local');
  assert.equal(view.currency, 'PKR');
  assert.equal(view.status, 'pending_verification');
  assert.equal(view.statusLabel, 'Pending verification');
  assert.equal(view.payable, false, 'a new method is never payable before verification');
  assert.ok(view.masked!.endsWith(LAST4));
  assert.ok(!view.masked!.includes(ACCOUNT));
  assert.deepEqual(view.secretFields, ['accountNumber']);

  // The destination row keeps only the masked form.
  const slot = missionDb.get<Record<string, unknown>>('SELECT * FROM mission_payout_slots WHERE slot = 1')!;
  assert.ok(!JSON.stringify(slot).includes(ACCOUNT), 'the payout slot row must never contain the raw account number');

  // The audit trail records the event, never the instrument.
  const audit = missionDb.all<Record<string, unknown>>(`SELECT * FROM mission_audit WHERE action LIKE 'withdrawal_method%' OR action LIKE 'payout_slot%'`);
  assert.ok(audit.length > 0);
  assert.ok(!JSON.stringify(audit).includes(ACCOUNT), 'the audit chain must never contain the raw account number');
  assert.equal(verifyMissionAudit().ok, true);

  // The secret is recoverable in-process only, through the vault.
  const secret = missionDb.get<Record<string, string>>('SELECT * FROM mission_withdrawal_secrets WHERE slot = 1')!;
  assert.ok(!String(secret.ciphertext).includes(ACCOUNT));
  assert.equal(String(secret.hint), view.masked);
  const decrypted = JSON.parse(decryptCredential({ ciphertext: String(secret.ciphertext), iv: String(secret.iv), tag: String(secret.tag) }));
  assert.equal(decrypted.accountNumber, ACCOUNT);
  assert.equal(decrypted.bankName, undefined, 'only fields declared secret are encrypted; public fields stay in the slot');
});

test('required fields are enforced and an email-style destination is masked too', () => {
  assert.throws(() => methods.addWithdrawalMethod({ type: 'payoneer', values: { holderName: 'Synthetic Owner' }, actorId: owner }), /required/i);
  assert.throws(() => methods.addWithdrawalMethod({ type: 'nope', values: {}, actorId: owner }), /unknown withdrawal method type/);
  const view = methods.addWithdrawalMethod({
    type: 'payoneer',
    values: { holderName: 'Synthetic Owner', payoneerEmail: 'synthetic.owner@example.test', currency: 'USD' },
    actorId: owner,
  });
  assert.equal(view.slot, 2);
  assert.ok(view.masked!.includes('@example.test'));
  assert.ok(!view.masked!.includes('synthetic.owner'));
});

test('at most four methods exist, and a removed method destroys its secret', () => {
  methods.addWithdrawalMethod({ type: 'bank_wire', values: { bankName: 'Synthetic Wire Bank', holderName: 'Synthetic Owner', accountNumber: '55550000111122223', swift: 'SYNTTEST', currency: 'USD' }, actorId: owner });
  methods.addWithdrawalMethod({ type: 'wise', values: { holderName: 'Synthetic Owner', wiseEmail: 'second.owner@example.test', currency: 'USD' }, actorId: owner });
  assert.equal(methods.listWithdrawalMethods().length, 4);

  assert.throws(
    () => methods.addWithdrawalMethod({ type: 'bank_local', values: { bankName: 'Fifth', holderName: 'Synthetic Owner', accountNumber: '9999888877776666', currency: 'USD' }, actorId: owner }),
    /maximum of 4/,
  );

  methods.removeWithdrawalMethod(2, owner);
  assert.equal(methods.listWithdrawalMethods().length, 3);
  assert.equal(missionDb.get('SELECT slot FROM mission_withdrawal_secrets WHERE slot = 2'), undefined);
  assert.equal(String(missionDb.get<Record<string, unknown>>('SELECT status FROM mission_payout_slots WHERE slot = 2')!.status), 'unconfigured');
  assert.ok(!methods.listWithdrawalMethods().some((method) => method.slot === 2));

  // The freed slot is reused by the next real method, so the owner always sees
  // exactly as many methods as they configured — never an empty placeholder.
  const reused = methods.addWithdrawalMethod({ type: 'bank_local', values: { bankName: 'Synthetic Test Bank', holderName: 'Synthetic Owner', accountNumber: '4444333322221010', currency: 'USD' }, actorId: owner });
  assert.equal(reused.slot, 2);
  assert.equal(methods.listWithdrawalMethods().length, 4);
});

test('no card exists and issuance fails closed without a real provider', async () => {
  const programme = methods.cardProgramme(0);
  assert.deepEqual(programme.cards, []);
  assert.equal(programme.count, 0);
  assert.equal(programme.status, 'NOT ISSUED');
  assert.equal(programme.providerConnected, false);
  assert.equal(programme.canIssue, false);
  assert.ok((programme.blockers as string[]).some((blocker) => blocker.startsWith('CREDENTIAL REQUIRED')));

  await assert.rejects(
    () => methods.issueMissionCard({ actorId: owner }, 0),
    (error: Error & { code?: string }) => error.code === 'card_provider_not_connected',
  );
  assert.deepEqual(methods.listMissionCards(), [], 'a failed issuance never leaves a card record behind');
});

test('a card record requires a provider-confirmed last four and is capped at four', () => {
  assert.throws(
    () => methods.recordIssuedCard({ provider: 'stripe-issuing', providerRef: 'ic_synthetic1', brand: null, last4: 'abcd', currency: 'USD', status: 'inactive', label: 'Synthetic', evidence: 'synthetic test' }, owner),
    /last four digits/,
  );
  const card = methods.recordIssuedCard(
    { provider: 'stripe-issuing', providerRef: 'ic_synthetic1', brand: 'Visa', last4: '4242', currency: 'USD', status: 'inactive', label: 'Synthetic card', evidence: 'synthetic provider confirmation fixture' },
    owner,
  );
  assert.equal(card.last4, '4242');
  assert.equal(methods.listMissionCards().length, 1);
  assert.equal((methods.cardProgramme(0) as { status: string }).status, 'ISSUED');
  for (const index of [2, 3, 4]) {
    methods.recordIssuedCard({ provider: 'stripe-issuing', providerRef: `ic_synthetic${index}`, brand: 'Visa', last4: '1111', currency: 'USD', status: 'inactive', label: `Synthetic card ${index}`, evidence: 'synthetic provider confirmation fixture' }, owner);
  }
  assert.equal(methods.listMissionCards().length, 4);
  assert.throws(
    () => methods.recordIssuedCard({ provider: 'stripe-issuing', providerRef: 'ic_synthetic5', brand: 'Visa', last4: '1111', currency: 'USD', status: 'inactive', label: 'Fifth', evidence: 'synthetic' }, owner),
    /maximum of 4/,
  );
  assert.equal(verifyMissionAudit().ok, true);
});
