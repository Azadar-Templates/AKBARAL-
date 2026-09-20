#!/usr/bin/env node
/** Read-only cash inspection. Never inserts test balances into a live mission. */
const base=(process.env.MISSION_BASE??'http://127.0.0.1:4200').replace(/\/+$/,'');
const email=process.env.ZA141251SA_OWNER_EMAIL,password=process.env.ZA141251SA_OWNER_PASSWORD;
async function main(){
  if(!email||!password)throw Error('Owner credentials are required through the environment.');
  const login=await fetch(`${base}/api/session/login`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  if(!login.ok)throw Error('Mission owner authentication failed.');
  const {token}=await login.json();
  const response=await fetch(`${base}/api/money`,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw Error('Verified cash inspection failed.');
  const cash=await response.json();
  if(cash.accounting!=='provider_verified_cash_only'||!cash.ledger?.ok||cash.legacyBalancesImported!==false)throw Error('Cash integrity or provenance check failed.');
  console.log(JSON.stringify({inspection:'local-accounting-only',ledgerRows:cash.ledger.rows,accounts:cash.accounts.length,availableCents:cash.accounts.reduce((n,a)=>n+Number(a.available_cents),0),heldCents:cash.accounts.reduce((n,a)=>n+Number(a.held_cents),0),killSwitch:cash.killSwitch,realPaymentConnectionTested:false},null,2));
  console.log('No money was created, spent, withdrawn, or provider-tested by this inspection.');
}
main().catch(()=>{console.error('Mission cash inspection failed; check owner authentication, service availability and integrity.');process.exitCode=1;});
