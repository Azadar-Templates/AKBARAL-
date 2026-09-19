/** Isolated test subprocess; never imported by a runtime entry point. */
import { missionDb } from '../../src/mission/database';
import { allocateCash, dispatchMoney, requestMoney, verifyMoneyReceipt, type MoneyActor, type MoneyProvider } from '../../src/mission/money';
process.send?.({ready:true});
process.once('message',async(raw:unknown)=>{
  const input=raw as {action:string;actor:MoneyActor;agentId:string;id:string;key:string};
  let sends=0;
  const fixture:MoneyProvider={id:'race-fixture-only',supports:()=>true,
    verifyReceipt:async(id)=>({externalId:id,kind:'earning',currency:'USD',amountCents:100,agentId:input.agentId}),
    pay:async(op,authorize)=>{authorize();sends++;return {state:'completed',providerRef:'race-fixture-payment',actualCents:Number(op.amount_cents)};},
    lookup:async()=>{throw Error('unused fixture');}};
  try {
    if(input.action==='allocate')allocateCash(input.actor,input.agentId,100,input.key);
    if(input.action==='receipt')await verifyMoneyReceipt(input.actor,fixture,input.id);
    if(input.action==='reserve')requestMoney(input.actor,{kind:'expense',agentId:input.agentId,provider:fixture.id,destination:'test-only',category:'api',amountCents:100,maxCostCents:100,idempotencyKey:input.key});
    if(input.action==='dispatch')await dispatchMoney(input.actor,fixture,input.id);
    process.send?.({ok:true,sends});
  }catch{process.send?.({ok:false,sends});}
  finally{missionDb.close();process.disconnect?.();}
});
