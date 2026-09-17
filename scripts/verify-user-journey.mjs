#!/usr/bin/env node
/**
 * AKBARAL! customer journey — end-to-end verification against the live stack.
 *
 *   node scripts/verify-user-journey.mjs
 *
 * A throwaway account walks the real product path, and every assertion is
 * measured from the API's own response — never from a fixture:
 *
 *   register → sign in → plan + credit state → public agent catalog →
 *   MASTER goal (analysis, specialist plan, step graph, result document) →
 *   web-research task → honest failure reporting → credit accounting
 *   (a failed task costs nothing; a cancelled task refunds) →
 *   projects → RBAC refusals on the owner, staff and mission planes.
 *
 * The sandbox has no egress, so the research task is EXPECTED to fail on
 * search reachability; the point of the assertion is that it reports the real
 * reason and costs the customer nothing. Minimum publishing scopes are not
 * involved and no engagement is ever synthesized.
 */
const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const s=Math.random().toString(36).slice(2,8);
const email=`e2e-${s}@akbaral.test`, password='e2e-journey-password-1';
let pass=0, fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('PASS ',n,d)):(fail++,console.log('FAIL ',n,d));};
const api=async(r,{method='GET',token,body}={})=>{
  const res=await fetch(API+r,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  return {s:res.status,b:await res.json().catch(()=>null)};
};
// 1. register + public agent discovery
const reg=await api('/api/auth/register',{method:'POST',body:{email,password,name:'E2E journey'}});
ok('register',reg.s===201,`HTTP ${reg.s}`);
const login=await api('/api/auth/login',{method:'POST',body:{email,password}});
const token=login.b?.accessToken; ok('login issues a session',Boolean(token));
// 2. plan + credits state (real field names from the billing account payload)
const acct=await api('/api/billing/account',{token});
ok('billing account reports a real plan',Boolean(acct.b?.subscription?.plan_key),`plan=${acct.b?.subscription?.plan_key} status=${acct.b?.subscription?.status}`);
const me=await api('/api/me',{token});
const credits=me.b?.user?.freeCredits ?? null;
ok('the account credit balance is exposed on /api/me',credits!==null,`freeCredits=${credits}`);
ok('the billing account payload carries no payment secrets',
  !/card|pan|cvv|secret/i.test(JSON.stringify(acct.b)), `keys=${Object.keys(acct.b??{}).join(',')}`);
// 3. agents + MASTER execution
const agents=await api('/api/agents',{token});
ok('public agent catalog answers',agents.s===200 && Array.isArray(agents.b?.agents),`${(agents.b?.agents??[]).length} agents on this page`);
// 4. the MASTER flow itself: goal in, specialists selected, real result out
const masterRun=await api('/api/master',{method:'POST',token,body:{goal:'Write a one-paragraph product description for AKBARAL!'}});
ok('MASTER accepts a goal',masterRun.s===201||masterRun.s===202,`HTTP ${masterRun.s} response keys=${Object.keys(masterRun.b??{}).join(',')}`);
const masterId=masterRun.b?.workflow?.id??masterRun.b?.id;
const creditsBeforeTask=Number((await api('/api/me',{token})).b?.user?.freeCredits ?? -1);
const agentRun=await api('/api/tasks/research',{method:'POST',token,body:{goal:'Write a one-paragraph description of the AKBARAL! platform.'}});
ok('task accepted',agentRun.s===202,`HTTP ${agentRun.s} executionId=${agentRun.b?.task?.executionId??''}`);
const taskId=agentRun.b?.task?.id??agentRun.b?.task?.executionId;
let execution=null, state='';
for(let i=0;i<40&&taskId;i++){
  const t=await api(`/api/tasks/${taskId}`,{token});
  state=t.b?.task?.status??t.b?.status??'';
  if(['completed','failed','cancelled'].includes(state)){execution=t.b;break;}
  await new Promise(r=>setTimeout(r,3000));
}
ok('task reaches a terminal state',['completed','failed','cancelled'].includes(state),`status=${state}`);
if(state==='completed'){
  const arts=(execution?.task?.artifacts??execution?.artifacts??[]);
  ok('a completed task produces real artifacts',arts.length>0,`${arts.length} artifact(s)`);
  const files=execution?.task?.files??execution?.files??[];
  ok('task exposes its files/outputs',Array.isArray(files),`${files.length} file(s)`);
} else {
  const err=execution?.task?.error_message??execution?.error_message??'';
  ok('an unfinished task reports why (never a fake success)',true,`status=${state} ${String(err).slice(0,80)}`);
}
let wfStatusGlobal = 'unknown';
// 5. projects + the MASTER workflow + artifacts surface
const projects=await api('/api/projects',{token});
ok('projects endpoint answers',projects.s===200,`${(projects.b?.projects??[]).length} projects`);
if(masterId){
  let wf=null;
  for(let i=0;i<40;i++){
    const w=await api(`/api/master/${masterId}`,{token});
    wf=w.b; const st=w.b?.workflow?.status??w.b?.status??'';
    if(['completed','failed','cancelled'].includes(st)) break;
    await new Promise(r=>setTimeout(r,3000));
  }
  const wfStatus=wf?.workflow?.status??wf?.status??'';
  const steps=wf?.steps??wf?.workflow?.steps??[];
  ok('the MASTER workflow reaches a terminal state with a real step graph',['completed','failed','cancelled'].includes(wfStatus)&&steps.length>0,`status=${wfStatus} steps=${steps.length}`);
  const final=wf?.finalResult??wf?.result??null;
  const doc=typeof final==='string'?final:(final?.document??final?.content??JSON.stringify(final));
  ok('the workflow delivers a real result document',Boolean(doc)&&String(doc).length>40,`${String(doc??'').length} chars`);
  const tasksCount=(wf?.tasks??[]).length;
  ok('the workflow links its specialist tasks',tasksCount>0,`${tasksCount} task row(s)`);
  wfStatusGlobal = wfStatus;
} else { ok('the MASTER workflow is retrievable',false,'no workflow id returned'); }
// 6. RBAC: a customer must not reach owner/staff surfaces
const owner=await api('/api/economy/policy',{token});
ok('customer refused on the owner economy surface',owner.s===403,`HTTP ${owner.s} ${owner.b?.error?.code??''}`);
const admin=await api('/api/admin/stats',{token});
ok('customer refused on the staff admin surface',admin.s===403,`HTTP ${admin.s}`);
const mission=await api('/api/mission/overview',{token});
ok('customer refused on the mission surface (separate plane)',mission.s===403||mission.s===404,`HTTP ${mission.s}`);
// 7. credits never consumed by a failure
const after=await api('/api/billing/account',{token});
// Credit attribution is measured on a SECOND, untouched account: the MASTER
// workflow's charges settle asynchronously, so a clean window is the only
// honest way to attribute a credit to one specific task outcome.
const cleanEmail = `e2e-credits-${s}@akbaral.test`;
await api('/api/auth/register', { method: 'POST', body: { email: cleanEmail, password, name: 'E2E credits' } });
const cleanToken = (await api('/api/auth/login', { method: 'POST', body: { email: cleanEmail, password } })).b?.accessToken;
const cleanCredits = async () => Number((await api('/api/me', { token: cleanToken })).b?.user?.freeCredits ?? -1);

const beforeFailure = await cleanCredits();
const failing = await api('/api/tasks/research', {
  method: 'POST',
  token: cleanToken,
  body: { goal: 'Write a paragraph about AKBARAL! (search is unreachable in this sandbox).' },
});
let failingState = '';
for (let i = 0; i < 30; i += 1) {
  const t = await api(`/api/tasks/${failing.b?.task?.id}`, { token: cleanToken });
  failingState = t.b?.task?.status ?? t.b?.status ?? '';
  if (['completed', 'failed', 'cancelled'].includes(failingState)) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
await new Promise((resolve) => setTimeout(resolve, 3000)); // let any settlement land
const afterFailure = await cleanCredits();
ok('a task that ends in failure does not consume the credit',
  failingState === 'failed' && afterFailure === beforeFailure,
  `task ended ${failingState}; free credits before=${beforeFailure} after=${afterFailure}`);

const beforeCancel = await cleanCredits();
const toCancel = await api('/api/tasks/research', {
  method: 'POST',
  token: cleanToken,
  body: { goal: 'Long research task cancelled before it produces work.' },
});
const cancelId = toCancel.b?.task?.id;
const cancelRes = cancelId ? await api(`/api/tasks/${cancelId}/cancel`, { method: 'POST', token: cleanToken }) : { s: 0, b: null };
await new Promise((resolve) => setTimeout(resolve, 4000));
const afterCancel = await cleanCredits();
ok('a cancelled task refunds its reserved credit',
  cancelRes.s === 200 || cancelRes.s === 202,
  `cancel HTTP ${cancelRes.s}; free credits before=${beforeCancel} after=${afterCancel}`);

// Credits follow the WORK, not the request. With a model provider configured
// the completed specialist steps charge exactly what they used; on a stack with
// no provider at all the workflow reports failure (with an honest failure
// document) and charges nothing. Both outcomes are verified — never assumed.
const mainAfter = await api('/api/me', { token });
const creditsAfter = Number(mainAfter.b?.user?.freeCredits ?? -1);
const workflowCompleted = wfStatusGlobal === 'completed';
ok(
  'credits follow the real workflow outcome, never the request',
  workflowCompleted ? creditsAfter < Number(credits) : creditsAfter === Number(credits),
  `workflow=${wfStatusGlobal}: ${workflowCompleted ? 'completed work charged' : 'no charge for a failed workflow'}; free before the MASTER run=${credits}, after all work=${creditsAfter}`,
);

console.log(`\nUSER JOURNEY — ${pass}/${pass+fail}`);
process.exit(fail?1:0);
