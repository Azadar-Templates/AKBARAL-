/** Registry metadata import only. Never accepts balances, permissions or work assignments. */
import { missionDb as db, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { currentPolicy } from './policy';
import { MoneyError, provisionMoneyAgent } from './money';
export interface RegistryAgentMetadata {
  slug:string; name:string; category:string|null; capabilities?:string[];
}
/**
 * One tool grant exported from the platform registry, addressed by the agent's slug —
 * the only identity the two databases share. `configSkipped` records that the platform
 * row had a `config` payload which was deliberately not copied (it can carry endpoints
 * or credential references); it is counted and reported, never dropped in silence.
 * Writing these rows authorizes nothing: `mission_tools.status` stays the only
 * permission the mission honours, deny by default.
 */
export interface RegistryToolGrantMetadata {
  agentSlug: string;
  toolKey: string;
  toolName: string;
  kind?: string;
  permission: string;
  configSkipped?: boolean;
}
export interface RegistrySyncResult {
  created: number;
  updated: number;
  /** Rows already carrying exactly the exported values: nothing was written for them. */
  unchanged: number;
  total: number;
  toolGrantsCreated: number;
  toolGrantsUpdated: number;
  toolGrantsUnchanged: number;
  /** Platform grant rows whose `config` payload was not copied, with the reason. */
  configPayloadsSkipped: number;
  /** Grants that named an agent this run did not import — reported, never discarded. */
  orphanGrants: number;
  skipped: Array<{ reason: string; count: number }>;
}
export function syncMissionRegistry(
  agents: RegistryAgentMetadata[],
  toolGrants: RegistryToolGrantMetadata[] = [],
): RegistrySyncResult {
  return db.transaction(()=>{
    const seen=new Set<string>();
    let newCount=0;
    for(const agent of agents){
      if(typeof agent.slug!=='string'||!agent.slug.trim()||agent.slug.length>240||seen.has(agent.slug)||typeof agent.name!=='string'||!agent.name.trim())throw new MoneyError('invalid_registry_metadata');
      seen.add(agent.slug);
      const prior=db.get<Row>('SELECT * FROM mission_agents WHERE slug=?',[agent.slug]);
      if(prior&&prior.origin_platform!=='akbaral-registry')throw new MoneyError('registry_identity_collision');
      if(!prior)newCount++;
    }
    const count=Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_agents')!.n);
    if(newCount&&count+newCount>currentPolicy().maxAgents)throw new MoneyError('registry_agent_ceiling');
    let created=0,updated=0,unchanged=0;
    const importedBySlug=new Map<string,string>();
    for(const agent of agents){
      const prior=db.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[agent.slug]);
      const id=prior?String(prior.id):`agt_reg_${sha256(agent.slug).slice(0,32)}`;
      const capabilities=JSON.stringify(agent.capabilities??[]);
      const name=agent.name.slice(0,200);
      if(prior){
        importedBySlug.set(agent.slug,id);
        // Compare before writing. A re-import that changes nothing must not touch
        // `updated_at` either, or a second run cannot be told apart from a real edit and
        // "already in sync" could never be reported truthfully.
        const stored=db.get<Row>('SELECT name,category,capabilities FROM mission_agents WHERE id=?',[id]);
        if(stored&&String(stored.name)===name&&String(stored.category??null)===String(agent.category??null)&&String(stored.capabilities??'[]')===capabilities){
          unchanged++;
        } else {
          db.run('UPDATE mission_agents SET name=?,category=?,capabilities=?,updated_at=? WHERE id=?',[name,agent.category,capabilities,nowIso(),id]);updated++;
        }
      } else {
        db.run("INSERT INTO mission_agents (id,slug,name,category,role_key,parent_id,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,'specialist',NULL,0,'registry','active','worker','akbaral-registry',?)",[id,agent.slug,name,agent.category,capabilities]);created++;
        importedBySlug.set(agent.slug,id);
        provisionMoneyAgent(id,'registry-sync');
      }
    }
    // Tool grants, same transaction, same idempotence rule. A grant naming an agent that
    // is not in this import is counted and reported as `orphanGrants`, never written and
    // never silently discarded: a missing agent is the fact the operator needs.
    let toolGrantsCreated=0,toolGrantsUpdated=0,toolGrantsUnchanged=0,configPayloadsSkipped=0,orphanGrants=0;
    const grantSeen=new Set<string>();
    for(const grant of toolGrants){
      if(grant.configSkipped)configPayloadsSkipped++;
      const agentId=importedBySlug.get(grant.agentSlug);
      if(!agentId){orphanGrants++;continue;}
      const pair=`${agentId}\u0000${grant.toolKey}`;
      if(grantSeen.has(pair))continue;
      grantSeen.add(pair);
      const kind=grant.kind??'knowledge';
      const existing=db.get<Row>('SELECT tool_name,kind,permission FROM mission_agent_tools WHERE agent_id=? AND tool_key=?',[agentId,grant.toolKey]);
      if(!existing){
        db.run('INSERT INTO mission_agent_tools (agent_id,tool_key,tool_name,kind,permission,source,exported_at) VALUES (?,?,?,?,?,?,?)',[agentId,grant.toolKey,grant.toolName,kind,grant.permission,'akbaral-registry',nowIso()]);
        toolGrantsCreated++;
      } else if(String(existing.tool_name)===grant.toolName&&String(existing.kind)===kind&&String(existing.permission)===grant.permission){
        toolGrantsUnchanged++;
      } else {
        db.run('UPDATE mission_agent_tools SET tool_name=?,kind=?,permission=?,exported_at=? WHERE agent_id=? AND tool_key=?',[grant.toolName,kind,grant.permission,nowIso(),agentId,grant.toolKey]);
        toolGrantsUpdated++;
      }
    }
    const skipped:Array<{reason:string;count:number}>=[];
    if(configPayloadsSkipped>0)skipped.push({reason:'agent_tools.config payload not copied: the bridge is metadata-only and that column can carry endpoints or credential references',count:configPayloadsSkipped});
    if(orphanGrants>0)skipped.push({reason:'grant names an agent this run did not import, so there is no mission row to attach it to',count:orphanGrants});
    if(unchanged>0)skipped.push({reason:'mission row already carries exactly the exported values',count:unchanged});
    appendMissionAudit({actorType:'system',action:'registry.synced',subjectType:'mission',subjectId:'registry',detail:{created,updated,unchanged,toolGrantsCreated,toolGrantsUpdated,toolGrantsUnchanged,configPayloadsSkipped,orphanGrants,total:agents.length,source:'akbaral-registry (read-only metadata export)',openingCashCents:0,assignmentsInvented:false}});
    return {created,updated,unchanged,total:count+created,toolGrantsCreated,toolGrantsUpdated,toolGrantsUnchanged,configPayloadsSkipped,orphanGrants,skipped};
  });
}
