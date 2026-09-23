import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL=process.env.REGISTRY_PG_TEST_DATABASE_URL||`file:${path.join(os.tmpdir(),`registry-cash-${randomUUID()}.db`)}`;
import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {generateAgentDefinitions} from '../agents/catalog';
const {applyMissionMigrations,missionDb:db,verifyMissionAudit}=require('./database') as typeof import('./database');
const {syncMissionRegistry}=require('./registry-sync') as typeof import('./registry-sync');
const {updatePolicy}=require('./policy') as typeof import('./policy');
import type {Row} from './database';
const metadata=generateAgentDefinitions().map(a=>({slug:a.slug,name:a.name,category:a.categorySlug,capabilities:a.capabilities}));
before(()=>{applyMissionMigrations();updatePolicy({maxAgents:5000},'test-only');});after(()=>db.close());
it('imports every existing catalog definition into isolated zero-cash subledgers, not live financial accounts',()=>{
  assert.ok(metadata.length>=4001);
  const result=syncMissionRegistry(metadata);assert.equal(result.created,metadata.length);
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_accounts')!.n,metadata.length);
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_money_grants WHERE spend_limit_cents=0 AND delegation_cents=0 AND can_create=0 AND opportunity_id IS NULL')!.n,metadata.length);
  assert.equal(db.get<Row>('SELECT SUM(available_cents+held_cents) AS n FROM mission_cash_accounts')!.n,0);
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_money_opportunities')!.n,0);
});
it('reimport preserves existing identity, pause, cash freeze and revoked authority',()=>{
  const prior=db.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[metadata[0].slug])!;
  db.run("UPDATE mission_agents SET status='paused' WHERE id=?",[prior.id]);
  db.run("UPDATE mission_money_grants SET status='revoked' WHERE agent_id=?",[prior.id]);
  db.run('UPDATE mission_cash_accounts SET frozen=1 WHERE id=?',[prior.id]);
  assert.equal(syncMissionRegistry(metadata).created,0);
  assert.equal(db.get<Row>('SELECT * FROM mission_agents WHERE slug=?',[metadata[0].slug])!.id,prior.id);
  assert.equal(db.get<Row>('SELECT status FROM mission_money_grants WHERE agent_id=?',[prior.id])!.status,'revoked');
  assert.equal(db.get<Row>('SELECT frozen FROM mission_cash_accounts WHERE id=?',[prior.id])!.frozen,1);
  assert.equal(verifyMissionAudit().ok,true);
});
it('same-prefix identities remain distinct and the policy ceiling is atomic',()=>{
  const prefix='synthetic-fixture-prefix-that-is-longer-than-thirty-two-';
  const rows=['one','two'].map(s=>({slug:prefix+s,name:`Synthetic collision fixture ${s}`,category:null}));
  assert.equal(syncMissionRegistry(rows).created,2);
  const ids=rows.map(r=>db.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[r.slug])!.id);assert.notEqual(ids[0],ids[1]);
  updatePolicy({maxAgents:metadata.length+2},'test-only');
  assert.throws(()=>syncMissionRegistry([{slug:'synthetic-over-cap',name:'Synthetic fixture',category:null}]),/registry_agent_ceiling/);
  assert.equal(db.get('SELECT id FROM mission_agents WHERE slug=?',['synthetic-over-cap']),undefined);
});
it('late audit failure rolls back identity and wallet creation together',()=>{
  updatePolicy({maxAgents:5000},'test-only');const original=db.run.bind(db);
  db.run=((sql,params)=>{if(sql.includes('INSERT INTO mission_audit'))throw Error('synthetic audit failure');return original(sql,params);}) as typeof db.run;
  try{assert.throws(()=>syncMissionRegistry([{slug:'synthetic-rollback',name:'Synthetic rollback fixture',category:null}]),/audit failure/);}finally{db.run=original;}
  assert.equal(db.get('SELECT id FROM mission_agents WHERE slug=?',['synthetic-rollback']),undefined);
});
