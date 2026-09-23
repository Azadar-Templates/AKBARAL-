/** Private, opt-in worker. Does not provide any invented earning adapter. */
import { setTimeout as pause } from 'node:timers/promises';
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { moneyWorkerTick } from '../src/mission/money';
import { configuredMoneyProvider } from '../src/mission/money-stripe';
import { configuredMissionOwnerEmail, enforceIdentityLock, identityLockVerified } from '../src/mission/identity-lock';
async function main() {
  if(process.env.ZA141251SA_MONEY_WORKER_ENABLED!=='true')throw new Error('disabled');
  applyMissionMigrations();enforceIdentityLock();
  const email=configuredMissionOwnerEmail();
  const owner=missionDb.get<Row>("SELECT id FROM mission_owner WHERE email=? AND role='owner' AND status='active'",[email??'']);
  if(!email||!owner||!identityLockVerified().ok)throw new Error('owner not configured');
  const provider=configuredMoneyProvider();
  const stop=new AbortController();
  process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
  try{while(!stop.signal.aborted){
    try{await moneyWorkerTick({kind:'owner',id:String(owner.id)},[provider],[]);}catch{process.stderr.write('Mission money tick blocked; inspect audited state.\n');}
    await pause(5000,undefined,{signal:stop.signal}).catch(()=>{});
  }}finally{missionDb.close();}
}
main().catch(()=>{process.stderr.write('Mission money worker disabled or refused startup. No payment activation claimed.\n');missionDb.close();process.exitCode=1;});
