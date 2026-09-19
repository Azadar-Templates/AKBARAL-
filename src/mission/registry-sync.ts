/** Registry metadata import only. Never accepts balances, permissions or work assignments. */
import { missionDb as db, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { currentPolicy } from './policy';
import { MoneyError, provisionMoneyAgent } from './money';
export interface RegistryAgentMetadata {
  slug:string; name:string; category:string|null; capabilities?:string[];
}
export function syncMissionRegistry(agents:RegistryAgentMetadata[]) {
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
    let created=0,updated=0;
    for(const agent of agents){
      const prior=db.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[agent.slug]);
      const id=prior?String(prior.id):`agt_reg_${sha256(agent.slug).slice(0,32)}`;
      if(prior){
        db.run('UPDATE mission_agents SET name=?,category=?,capabilities=?,updated_at=? WHERE id=?',[agent.name.slice(0,200),agent.category,JSON.stringify(agent.capabilities??[]),nowIso(),id]);updated++;
      } else {
        db.run("INSERT INTO mission_agents (id,slug,name,category,role_key,parent_id,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,'specialist',NULL,0,'registry','active','worker','akbaral-registry',?)",[id,agent.slug,agent.name.slice(0,200),agent.category,JSON.stringify(agent.capabilities??[])]);created++;
      }
      provisionMoneyAgent(id,'registry-sync');
    }
    appendMissionAudit({actorType:'system',action:'registry.synced',subjectType:'mission',subjectId:'registry',detail:{created,updated,total:agents.length,source:'akbaral-registry (read-only metadata export)',openingCashCents:0,assignmentsInvented:false}});
    return {created,updated,total:count+created};
  });
}
