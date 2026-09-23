/** Synthetic transport ONLY for deterministic tests; never registered in runtime. */
import assert from 'node:assert/strict';
import { FreelancerClient, type FreelancerClientDependencies } from './freelancer';
export function freelancerFixture(deps: FreelancerClientDependencies = {}) {
  const f={selfId:1,project:{id:2,owner_id:9,title:'Synthetic software contract',description:'Fixture-only patch requested; not real paid work',currency:{code:'USD'},type:'fixed',status:'active'},
    bid:{id:3,project_id:2,bidder_id:1,award_status:'awarded',retracted:false,time_accepted:1500000000,frontend_bid_status:'in_progress'},
    milestone:{transaction_id:4,project_id:2,bidder_id:1,project_owner_id:9,bid_id:3,status:'frozen',amount:25,currency:{code:'USD'},dispute_id:null as number|null},
    calls:[] as {url:URL;method:string}[],uploads:0,failUpload:false,badUpload:false,beforeUpload:undefined as (()=>void)|undefined,
    beforeRead:undefined as ((url:URL)=>void)|undefined,search:undefined as unknown[]|undefined};
  const fetch:typeof globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),method=init?.method??'GET';f.calls.push({url,method});
    assert.equal(url.origin,'https://www.freelancer.com');assert.equal(init?.redirect,'error');
    assert.equal(new Headers(init?.headers).get('freelancer-oauth-v1'),'fixture-only-freelancer-token');
    f.beforeRead?.(url);let result:unknown;
    if(method==='POST') {
      assert.equal(url.pathname,'/api/projects/0.1/projects/2/files/');f.beforeUpload?.();f.uploads++;
      const file=(init!.body as FormData).get('filedata') as File;assert.equal(file.type,'text/plain');
      if(f.failUpload)throw Error('fixture-sensitive-provider-body');
      result=[{id:5,project_id:f.badUpload?99:2,from_user_id:1,to_user_id:9,file_name:file.name,file_size:file.size}];
    } else if(url.pathname.endsWith('/self/'))result={id:f.selfId};
    else if(url.pathname.endsWith('/projects/active/'))result={projects:f.search??[f.project]};
    else if(url.pathname.endsWith('/projects/2/'))result=f.project;
    else if(url.pathname.endsWith('/bids/'))result={bids:[f.bid]};
    else if(url.pathname.endsWith('/milestones/'))result={milestones:{'4':f.milestone}};
    else assert.fail('Unrecognized synthetic endpoint');
    return new Response(JSON.stringify({status:'success',result}),{headers:{'content-type':'application/json'}});
  };
  return {f,fetch,client:new FreelancerClient({userId:'1',accessToken:'fixture-only-freelancer-token'},{fetch,...deps})};
}
