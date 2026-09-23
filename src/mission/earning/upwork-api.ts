/** Limited documented read probes. NOT a complete live business-evidence adapter.
 * No browser/session token extraction, arbitrary GraphQL, mutations or API cache.
 */
import { missionDb as db } from '../database';
import { MoneyError } from '../money';
import { readUpworkProof } from './upwork-workflow';
function fail(code:string):never {throw new MoneyError(`upwork_api_${code}`);}
const identifier = (s:unknown):string => {if(typeof s!=='string'||!/^[A-Za-z0-9_~:-]{1,128}$/.test(s))fail('invalid_identity');return s;};
const object = (v:unknown):Record<string,unknown> => {if(!v||typeof v!=='object'||Array.isArray(v))fail('invalid_response');return v as Record<string,unknown>;};
/** The callback is trusted integration code that checks actual approved use-case,
 * credential ownership/context/scopes and revocation; NEVER an owner HTTP flag.
 */
export class UpworkApiReadProbe {
  private readonly token:string; private readonly tenantId:string;
  constructor(token:string,tenantId:string,private readonly assertApproved:(signal:AbortSignal)=>void|Promise<void>,private readonly transport:typeof fetch=fetch) {
    if(typeof token!=='string'||!token||token.length>4096||/[\s\x00-\x1f]/.test(token))fail('credentials_required');
    this.token=token;this.tenantId=identifier(tenantId);
  }
  private async approved() {
    await readUpworkProof(async signal => {
      const result = await this.assertApproved(signal);
      if (result !== undefined) fail('invalid_permission_verifier');
    });
  }
  private reserve() {
    // Conservative shared mission-process caps below the documented IP/day limits.
    // Deployments sharing an IP with other applications still need aggregate quotas.
    db.transaction(()=>{for(const [bucket,period,limit] of [['minute',60000,60],['day',86400000,1000]] as const){
      const start=Math.floor(Date.now()/period)*period;
      const old=db.get<{hits:number}>('SELECT hits FROM mission_upwork_api_limits WHERE bucket=? AND bucket_start=?',[bucket,start]);
      if(Number(old?.hits??0)>=limit)fail('rate_limited');
      db.run('INSERT INTO mission_upwork_api_limits (bucket,bucket_start,hits) VALUES (?,?,1) ON CONFLICT(bucket,bucket_start) DO UPDATE SET hits=mission_upwork_api_limits.hits+1',[bucket,start]);
    }});
  }
  private async query(query:string,variables:Record<string,string>={}) {
    // No cache: API data is not written to tables, events, logs or audit records.
    await this.approved();this.reserve();
    try {
      const data=await readUpworkProof(async signal=>{
        await this.approved();if(signal.aborted)fail('request_expired');
        const response=await this.transport('https://api.upwork.com/graphql',{method:'POST',redirect:'error',signal,
          headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json','X-Upwork-API-TenantId':this.tenantId},body:JSON.stringify({query,variables})});
        if(!response.ok||response.redirected)fail('request_rejected');
        const reader=response.body?.getReader();if(!reader)fail('invalid_response');
        let size=0;const parts:Uint8Array[]=[];
        try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)fail('response_too_large');parts.push(part.value);}}
        finally {await reader.cancel().catch(()=>undefined);}
        const parsed=object(JSON.parse(Buffer.concat(parts).toString('utf8')));
        if(parsed.errors!==undefined && (!Array.isArray(parsed.errors)||parsed.errors.length))fail('graphql_errors');
        return object(parsed.data);
      });
      await this.approved();return data;
    } catch {return fail('verification_unavailable');}
  }
  async contextMembership() {
    const data=await this.query('query { companySelector { items { organizationId } } }');
    const items=object(data.companySelector).items;
    if(!Array.isArray(items)||items.length>200||!items.some(i=>object(i).organizationId===this.tenantId))fail('tenant_mismatch');
    return {tenantId:this.tenantId,identityOrKycVerified:false as const};
  }
  async contractHeader(termId:string) {
    identifier(termId);
    // Modern documented reader: a term ID is NOT the rollup contract ID.
    // Neither identifier nor this header establishes the full work/proof binding.
    const data=await this.query('query ($termId: ID!) { contractByTerm(termId: $termId) { id kind status } }',{termId});
    const c=object(data.contractByTerm);
    return {id:identifier(c.id),requestedTermId:termId,kind:identifier(c.kind),status:identifier(c.status),executable:false as const,paymentVerified:false as const};
  }
}
