import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FreelancerClient, FreelancerError, configuredFreelancerClient } from './freelancer';
import { freelancerFixture } from './freelancer.fixtures';
it('unconfigured provider stays disabled; malformed or missing credentials cannot activate it',()=>{
  assert.equal(configuredFreelancerClient({},{}),null);
  assert.throws(()=>configuredFreelancerClient({},{ZA141251SA_FREELANCER_ENABLED:'true'}),/credentials_required/);
  for(const userId of ['0','1/../../evil','https://evil.example','9007199254740992'])assert.throws(()=>new FreelancerClient({userId,accessToken:'fixture'}));
  assert.throws(()=>new FreelancerClient({userId:'1',accessToken:'fixture\nsecret'}),/credentials_required/);
});
it('discovery returns actual response-derived USD fixed-price leads, not earnings or executable jobs',async()=>{
  const {client,f}=freelancerFixture();f.search=[f.project,{...f.project,id:10,currency:{code:'EUR'}},{...f.project,id:11,type:'hourly'}];
  const result=await client.discover('software');assert.equal(result.projects.length,1);assert.equal(result.projects[0].executable,false);assert.equal(result.nextOffset,null);
  assert.equal(f.calls[1].url.searchParams.get('project_types[]'),'fixed');assert.equal(f.calls[1].url.searchParams.get('offset'),'0');
  assert.equal(f.calls.every(c=>c.method==='GET'),true);
});
it('pagination advances by raw rows, not the USD-filtered count, and rejects duplicate evidence',async()=>{
  const {client,f}=freelancerFixture();f.search=Array.from({length:50},(_,i)=>({...f.project,id:i+100,currency:{code:'EUR'}}));
  assert.deepEqual(await client.discover('software',50),{projects:[],nextOffset:100});
  f.search=[f.project,f.project];await assert.rejects(client.discover('software'),/duplicate_evidence/);
  await assert.rejects(client.discover('software',-1),/invalid_offset/);
});
it('token self identity must equal the configured legitimate account',async()=>{
  const {client,f}=freelancerFixture();f.selfId=99;await assert.rejects(client.discover('software'),/account_mismatch/);assert.equal(f.calls.length,1);
});
it('accepted award and funded USD milestone are required, never merely a listing or pending bid',async()=>{
  const {client,f}=freelancerFixture();assert.equal((await client.contract('2','3','4')).currency,'USD');
  for(const status of ['pending','revoked','canceled','rejected']){f.bid.award_status=status;await assert.rejects(client.contract('2','3','4'),/accepted_award_required/);}
  f.bid.award_status='awarded';f.bid.time_accepted=0;await assert.rejects(client.contract('2','3','4'),/accepted_award_required/);
  f.bid.time_accepted=1500000000;f.bid.retracted=true;await assert.rejects(client.contract('2','3','4'),/accepted_award_required/);
});
it('unknown, disputed, released, non-USD and unsupported-precision milestones cannot authorize new work',async()=>{
  const {client,f}=freelancerFixture();
  for(const status of ['pending','cleared','disputed','canceled','requested_release','invented']){f.milestone.status=status;await assert.rejects(client.contract('2','3','4'));}
  f.milestone.status='frozen';f.milestone.currency.code='EUR';await assert.rejects(client.contract('2','3','4'),/funded_usd/);
  f.milestone.currency.code='USD';f.milestone.amount=1.001;await assert.rejects(client.contract('2','3','4'),/unsupported_amount/);
  f.milestone.amount=25;f.milestone.dispute_id=88;await assert.rejects(client.contract('2','3','4'),/funded_usd/);
});
it('rejects cross-account, cross-project, cross-bid and employer mismatches',async()=>{
  for(const field of ['project_id','bidder_id','project_owner_id','bid_id','transaction_id'] as const){const {client,f}=freelancerFixture();f.milestone[field]=99;await assert.rejects(client.contract('2','3','4'),/milestone_mismatch/);}
  const {client,f}=freelancerFixture();f.project.owner_id=1;await assert.rejects(client.contract('2','3','4'),/project_ineligible/);
});
it('fresh immutable scope and funding must match before a single authorized file POST',async()=>{
  const {client,f}=freelancerFixture();const contract=await client.contract('2','3','4');let grants=0;
  const content='Synthetic patch evidence, not real paid delivery';
  const result=await client.upload(contract,content,()=>{grants++;});
  assert.equal(grants,1);assert.equal(f.uploads,1);assert.equal(result.cashEligible,false);assert.equal(result.state,'provider_upload_acknowledged');
  assert.equal(result.fileName,`delivery-${createHash('sha256').update(content).digest('hex')}.txt`);
  f.project.description='Changed client scope';await assert.rejects(client.upload(contract,content,()=>{grants++;}),/contract_changed/);assert.equal(f.uploads,1);
});
it('final authorization denial, overlarge and empty artifacts cause no POST',async()=>{
  const {client,f}=freelancerFixture();const c=await client.contract('2','3','4');
  await assert.rejects(client.upload(c,'fixture',()=>{throw Error('revoked');}),/revoked/);
  await assert.rejects(client.upload(c,'',()=>{}),/invalid_artifact/);
  await assert.rejects(client.upload(c,'界'.repeat(100000),()=>{}),/invalid_artifact/);assert.equal(f.uploads,0);
});
it('upload timeouts and mismatched acknowledgements are uncertain, redacted and never retried',async()=>{
  const {client,f}=freelancerFixture();const c=await client.contract('2','3','4');f.failUpload=true;
  await assert.rejects(client.upload(c,'fixture',()=>{}),(e:unknown)=>e instanceof FreelancerError&&e.effectMayHaveOccurred&&!e.message.includes('sensitive'));
  assert.equal(f.uploads,1);f.failUpload=false;f.badUpload=true;
  await assert.rejects(client.upload(c,'fixture',()=>{}),(e:unknown)=>e instanceof FreelancerError&&e.effectMayHaveOccurred);assert.equal(f.uploads,2);
});
it('cleared provider milestone remains non-cash evidence',async()=>{
  const {client,f}=freelancerFixture();const c=await client.contract('2','3','4');f.milestone.status='cleared';const result=await client.milestone(c);
  assert.equal(result.status,'cleared');assert.equal(result.cashEligible,false);
});
it('429 installs a cooldown, surfaces no response body and does not retry automatically',async()=>{
  let calls=0,delay=0;const client=new FreelancerClient({userId:'1',accessToken:'fixture'},{fetch:async()=>{calls++;return new Response('sensitive',{status:429,headers:{'retry-after':'120'}});},onRateLimit:ms=>{delay=ms;}});
  await assert.rejects(client.verifyIdentity(),/rate_limited/);await assert.rejects(client.verifyIdentity(),/rate_limited/);assert.equal(calls,1);assert.equal(delay,120000);
});
it('authentication errors, redirects, malformed JSON, HTML and oversized responses fail closed without leaking bodies',async()=>{
  for(const make of [()=>new Response('sensitive',{status:401}),()=>new Response('sensitive',{status:403}),()=>new Response('sensitive',{status:302}),()=>new Response('sensitive',{headers:{'content-type':'application/json'}}),()=>new Response('sensitive',{headers:{'content-type':'text/html'}}),()=>new Response('x'.repeat(2100000),{headers:{'content-type':'application/json'}})]) {
    const client=new FreelancerClient({userId:'1',accessToken:'fixture'},{fetch:async()=>make()});
    await assert.rejects(client.verifyIdentity(),(e:unknown)=>e instanceof FreelancerError&&!e.message.includes('sensitive'));
  }
});
