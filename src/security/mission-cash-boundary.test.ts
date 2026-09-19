/** Source-level regression guards complement the runtime cash/HTTP isolation tests. */
import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
it('only the provider-verified engine writes cash balances, entries or receipt evidence',()=>{
  for(const file of fs.readdirSync('src',{recursive:true,encoding:'utf8'}).filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts'))){
    const relative=String(file).replaceAll(path.sep,'/');
    const source=fs.readFileSync(path.join('src',file),'utf8');
    if(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+mission_(?:cash_(?:accounts|entries)|money_receipts)\b/i.test(source))assert.equal(relative,'mission/money.ts',`unauthorized cash writer: ${relative}`);
  }
});
it('mission runtime money connection never falls back to customer payment credentials',()=>{
  const source=fs.readFileSync('src/mission/money-stripe.ts','utf8');
  assert.ok(source.includes('process.env.ZA141251SA_STRIPE_SECRET_KEY'));
  assert.ok(!/process\.env\.(?:STRIPE_SECRET_KEY|AKBARAL_STRIPE_SECRET_KEY)\b/.test(source));
});
it('legacy modules do not import the verified receipt or settlement engine',()=>{
  for(const name of ['treasury','self-management','resource-budgets','resource-periods','resource-receipts','reporting']){
    const source=fs.readFileSync(`src/mission/${name}.ts`,'utf8');
    assert.ok(!/(?:from\s*|require\()\s*['"]\.\/money(?:-stripe)?['"]/.test(source),name);
  }
});
