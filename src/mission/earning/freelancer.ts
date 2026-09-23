/** Freelancer Work Sourcer / awarded-project delivery only. No bids, award acceptance,
 * purchases, account creation, reviews, milestone release, withdrawals or cash receipts.
 * Official endpoint/schema references: docs/FREELANCER_CONNECTOR.md.
 */
import { createHash } from 'node:crypto';
export class FreelancerError extends Error {
  constructor(public readonly code: string, public readonly effectMayHaveOccurred = false) { super(code); }
}
function deny(code = 'invalid_response'): never { throw new FreelancerError(`freelancer_${code}`); }
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) deny();
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) deny(); return value; }
function id(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) deny('invalid_id');
  return String(value);
}
function text(value: unknown, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) deny();
  return value;
}
function decimal(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') deny();
  const s = String(value);
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(s) || Number(s) <= 0) deny('unsupported_amount');
  return s;
}
export interface FreelancerProject {
  projectId: string; employerId: string; title: string; description: string;
  currency: string; type: string; status: string; observedAt: string;
  executable: false;
}
export interface FreelancerContract {
  userId: string; projectId: string; employerId: string; bidId: string;
  milestoneId: string; currency: 'USD'; amountDecimal: string; scopeHash: string;
}
export interface FreelancerMilestone {
  milestoneId: string; projectId: string; bidderId: string; employerId: string; bidId: string;
  status: 'frozen' | 'pending' | 'requested_release' | 'cleared' | 'disputed' | 'canceled';
  amountDecimal: string; currency: string; disputeId: string | null;
  cashEligible: false;
}
export interface FreelancerDelivery {
  fileId: string; projectId: string; fromUserId: string; toUserId: string; fileName: string; bytes: number;
  state: 'provider_upload_acknowledged'; cashEligible: false;
}
export interface FreelancerClientDependencies {
  fetch?: typeof fetch;
  beforeRequest?: () => void;
  onRateLimit?: (delayMs: number) => void;
}
export class FreelancerClient {
  readonly userId: string;
  #token: string;
  #fetch: typeof fetch;
  #deps: FreelancerClientDependencies;
  #blockedUntil = 0;
  constructor(config: { userId: string; accessToken: string }, deps: FreelancerClientDependencies = {}) {
    this.userId = id(config.userId);
    if (!/^[A-Za-z0-9._~+\/-]+=*$/.test(config.accessToken) || config.accessToken.length > 8192) deny('credentials_required');
    this.#token = config.accessToken; this.#fetch = deps.fetch ?? globalThis.fetch; this.#deps = deps;
  }
  async #request<T>(path: string, query: Record<string,string>, parse: (value: unknown) => T,
    mutation?: { form: FormData; authorize: () => void }): Promise<T> {
    if (Date.now() < this.#blockedUntil) deny('rate_limited');
    this.#deps.beforeRequest?.();
    mutation?.authorize();
    const url = new URL(path, 'https://www.freelancer.com/api/');
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    let response: Response | undefined;
    try {
      response = await this.#fetch(url, { method: mutation ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'freelancer-oauth-v1': this.#token, Accept: 'application/json' }, ...(mutation ? { body: mutation.form } : {}) });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const parsed = retry && /^\d+$/.test(retry) ? Number(retry)*1000 : retry ? Date.parse(retry)-Date.now() : NaN;
        const delay = Number.isSafeInteger(parsed) && parsed > 0 ? Math.max(60000, parsed) : 60000;
        this.#blockedUntil = Math.min(Date.now()+delay,253402300799999); this.#deps.onRateLimit?.(delay);
        throw new FreelancerError('freelancer_rate_limited',!!mutation);
      }
      if (response.status === 401 || response.status === 403) throw new FreelancerError('freelancer_access_denied');
      if (response.status !== 200) throw new FreelancerError('freelancer_http_failure',!!mutation);
      if (!(response.headers.get('content-type') ?? '').includes('application/json')) deny();
      const reader = response.body?.getReader(); if (!reader) deny();
      let size=0; const chunks: Uint8Array[]=[];
      try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>2*1024*1024)deny('response_too_large'); chunks.push(value); } }
      finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
      const envelope = obj(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (envelope.status !== 'success' || !envelope.result) deny();
      return parse(envelope.result);
    } catch (error) {
      if (error instanceof FreelancerError) {
        if (mutation && response?.status === 200) throw new FreelancerError(error.code,true);
        throw error;
      }
      throw new FreelancerError('freelancer_transport_or_parse_failure',!!mutation);
    } finally { if(response?.body && !response.body.locked) await response.body.cancel().catch(()=>{}); }
  }
  async verifyIdentity(): Promise<string> {
    return this.#request('users/0.1/self/',{},value=>{
      if(id(obj(value).id)!==this.userId)deny('account_mismatch'); return this.userId;
    });
  }
  private parseProject(value: unknown): FreelancerProject {
    const p=obj(value);
    return {projectId:id(p.id),employerId:id(p.owner_id),title:text(p.title),description:text(p.description,50000),
      currency:text(obj(p.currency).code,3),type:text(p.type),status:text(p.status),observedAt:new Date().toISOString(),executable:false};
  }
  async discover(query: string, offset = 0): Promise<{ projects: FreelancerProject[]; nextOffset: number | null }> {
    text(query,200); if(!Number.isSafeInteger(offset)||offset<0||offset>100000)deny('invalid_offset');
    await this.verifyIdentity();
    return this.#request('projects/0.1/projects/active/',{query,offset:String(offset),limit:'50','project_types[]':'fixed',full_description:'true'},value=>{
      const raw=list(obj(value).projects); if(raw.length>50)deny();
      const projects=raw.map(row=>this.parseProject(row));
      if(new Set(projects.map(p=>p.projectId)).size!==projects.length)deny('duplicate_evidence');
      return {projects:projects.filter(p=>p.currency==='USD'&&p.type==='fixed'&&p.status==='active'&&p.employerId!==this.userId),nextOffset:raw.length===50?offset+50:null};
    });
  }
  async project(projectId: string): Promise<FreelancerProject> {
    id(projectId);
    return this.#request(`projects/0.1/projects/${projectId}/`,{full_description:'true'},value=>{
      const project=this.parseProject(value);if(project.projectId!==projectId)deny('project_mismatch');return project;
    });
  }
  async milestone(contract: Pick<FreelancerContract,'projectId'|'bidId'|'milestoneId'|'employerId'>): Promise<FreelancerMilestone> {
    const {projectId,bidId,milestoneId,employerId}=contract;[projectId,bidId,milestoneId,employerId].forEach(id);
    return this.#request('projects/0.1/milestones/',{'projects[]':projectId,'bidders[]':this.userId,'bids[]':bidId},value=>{
      // Official SDK list response is a map keyed by milestone transaction ID.
      const rows=obj(obj(value).milestones), row=obj(rows[milestoneId]);
      if(id(row.transaction_id)!==milestoneId||id(row.project_id)!==projectId||id(row.bid_id)!==bidId||id(row.bidder_id)!==this.userId||id(row.project_owner_id)!==employerId)deny('milestone_mismatch');
      const status=row.status;
      if(status!=='frozen'&&status!=='pending'&&status!=='requested_release'&&status!=='cleared'&&status!=='disputed'&&status!=='canceled')deny();
      return {milestoneId,projectId,bidderId:this.userId,employerId,bidId,status,amountDecimal:decimal(row.amount),currency:text(obj(row.currency).code,3),
        disputeId:row.dispute_id===null?null:id(row.dispute_id),cashEligible:false};
    });
  }
  async contract(projectId: string, bidId: string, milestoneId: string): Promise<FreelancerContract> {
    [projectId,bidId,milestoneId].forEach(id);await this.verifyIdentity();
    const project=await this.project(projectId);
    if(project.currency!=='USD'||project.type!=='fixed'||project.status!=='active'||project.employerId===this.userId)deny('project_ineligible');
    await this.#request('projects/0.1/bids/',{'bids[]':bidId,'projects[]':projectId,'bidders[]':this.userId},value=>{
      const bids=list(obj(value).bids);if(bids.length!==1)deny('accepted_award_required');const b=obj(bids[0]);
      if(id(b.id)!==bidId||id(b.project_id)!==projectId||id(b.bidder_id)!==this.userId||b.award_status!=='awarded'||b.retracted!==false||typeof b.time_accepted!=='number'||!Number.isSafeInteger(b.time_accepted)||b.time_accepted<=0||b.time_accepted>Date.now()/1000||b.frontend_bid_status!=='in_progress')deny('accepted_award_required');
    });
    const base={userId:this.userId,projectId,employerId:project.employerId,bidId,milestoneId};
    const milestone=await this.milestone(base);
    if(milestone.currency!=='USD'||milestone.status!=='frozen'||milestone.disputeId!==null)deny('funded_usd_milestone_required');
    return {...base,currency:'USD',amountDecimal:milestone.amountDecimal,scopeHash:createHash('sha256').update(JSON.stringify([project.title,project.description])).digest('hex')};
  }
  /** Bounded plain-text delivery; caller persists a single-use claim before invoking this.
   * Never interprets a receipt as employer acceptance, a payout or available cash.
   */
  async upload(contract: FreelancerContract, content: string, authorize: () => void): Promise<FreelancerDelivery> {
    const expected=JSON.stringify(contract), bytes=Buffer.from(content,'utf8');
    if(!content.trim()||bytes.length>262144||typeof authorize!=='function')deny('invalid_artifact');
    const hash=createHash('sha256').update(bytes).digest('hex'),fileName=`delivery-${hash}.txt`;
    const fresh=await this.contract(contract.projectId,contract.bidId,contract.milestoneId);
    if(JSON.stringify(fresh)!==expected)deny('contract_changed');
    const form=new FormData();form.set('filedata',new Blob([bytes],{type:'text/plain'}),fileName);
    return this.#request(`projects/0.1/projects/${fresh.projectId}/files/`,{},value=>{
      const rows=list(value);if(rows.length!==1)deny();const r=obj(rows[0]);
      if(id(r.project_id)!==fresh.projectId||id(r.from_user_id)!==this.userId||id(r.to_user_id)!==fresh.employerId||r.file_name!==fileName||r.file_size!==bytes.length)deny('delivery_mismatch');
      return {fileId:id(r.id),projectId:fresh.projectId,fromUserId:this.userId,toUserId:fresh.employerId,fileName,bytes:bytes.length,state:'provider_upload_acknowledged',cashEligible:false};
    },{form,authorize});
  }
}
export function configuredFreelancerClient(deps: FreelancerClientDependencies = {}, env: Readonly<Record<string,string|undefined>> = process.env) {
  if(env.ZA141251SA_FREELANCER_ENABLED!=='true')return null;
  if(!env.ZA141251SA_FREELANCER_USER_ID||!env.ZA141251SA_FREELANCER_ACCESS_TOKEN)deny('credentials_required');
  return new FreelancerClient({userId:env.ZA141251SA_FREELANCER_USER_ID!,accessToken:env.ZA141251SA_FREELANCER_ACCESS_TOKEN!},deps);
}
