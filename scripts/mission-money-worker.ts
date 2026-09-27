/** Private, opt-in worker.
 * Earning adapters are DISCOVERED, never invented: activeEarningProviders()
 * returns only providers whose real credentials are present, so an
 * uncredentialed mission still runs (reconciling and staying safe) while
 * reporting honestly that no earning provider is active. */
import { setTimeout as pause } from 'node:timers/promises';
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { moneyWorkerTick } from '../src/mission/money';
import { configuredMoneyProvider } from '../src/mission/money-stripe';
import { activeEarningProviders, earningProviderReadinessReport } from '../src/mission/earning/providers/registry';
import { configuredMissionOwnerEmail, enforceIdentityLock, identityLockVerified } from '../src/mission/identity-lock';
async function main() {
  if(process.env.ZA141251SA_MONEY_WORKER_ENABLED!=='true')throw new Error('disabled');
  applyMissionMigrations();enforceIdentityLock();
  const email=configuredMissionOwnerEmail();
  const owner=missionDb.get<Row>("SELECT id FROM mission_owner WHERE email=? AND role='owner' AND status='active'",[email??'']);
  if(!email||!owner||!identityLockVerified().ok)throw new Error('owner not configured');
  const provider=configuredMoneyProvider();
  // Replaces the previously hardcoded empty earning-provider array.
  const earning=activeEarningProviders();
  const readiness=earningProviderReadinessReport();
  process.stdout.write(`[mission:money] ${readiness.summary}\n`);
  const stop=new AbortController();
  process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
  try{while(!stop.signal.aborted){
    try{await moneyWorkerTick({kind:'owner',id:String(owner.id)},[provider],earning);}catch{process.stderr.write('Mission money tick blocked; inspect audited state.\n');}
    await pause(5000,undefined,{signal:stop.signal}).catch(()=>{});
  }}finally{missionDb.close();}
}
main().catch(()=>{process.stderr.write('Mission money worker disabled or refused startup. No payment activation claimed.\n');missionDb.close();process.exitCode=1;});
