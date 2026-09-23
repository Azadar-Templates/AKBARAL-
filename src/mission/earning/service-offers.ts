/** Saleable capabilities, not customers, open jobs, published listings or revenue. */
import { MoneyError, cents } from '../money';
import { sha256 } from '../database';
export const SERVICE_OFFERS = Object.freeze([
  Object.freeze({id:'json-validation',title:'Reusable JSON data-validation pack',customer:'Teams with an existing JSON export and documented data requirements',deliverables:'A reusable offline JavaScript validator, agreed field configuration, findings report and run instructions',requirements:'A non-sensitive JSON array of records, required field names and one unique-key field',acceptance:'Validator reproduces the supplied export findings; no records silently changed; human review of business rules',exclusions:'No scraping, data enrichment, personal-data harvesting, database access or promises that data is correct',limit:'128 KiB; 5,000 records; 20 required fields',activity:'software_development'}),
  Object.freeze({id:'html-release-check',title:'Offline website release-check report',customer:'Website owners preparing a page for release',deliverables:'Reproducible source-level checks and a prioritized human-review checklist for one supplied HTML document',requirements:'Owner-authorized non-sensitive HTML source, not a URL or credentials',acceptance:'Report references the exact input hash, states detected issues and limitations; no claim of browser or accessibility certification',exclusions:'No crawling, URL fetching, script execution, penetration testing, SEO ranking guarantee or WCAG certification',limit:'128 KiB; one static HTML document',activity:'software_development'}),
]);
export function serviceOffer(id:string){const offer=SERVICE_OFFERS.find(x=>x.id===id);if(!offer)throw new MoneyError('demand_unknown_service');return offer;}
export function listingPack(serviceId:string,priceCents:number){
  const offer=serviceOffer(serviceId);cents(priceCents,true);if(priceCents>1000000)throw new MoneyError('demand_quote_limit');
  return {offer,proposedUsdCents:priceCents,published:false,customersAcquired:false,
    text:`${offer.title}\n\nFor: ${offer.customer}\nDeliverables: ${offer.deliverables}\nClient supplies: ${offer.requirements}\nAcceptance: ${offer.acceptance}\nLimits: ${offer.limit}\nExcludes: ${offer.exclusions}\nProposed service price: USD ${(priceCents/100).toFixed(2)}. This is an owner-set quote, not earnings. Platform fees/taxes and final terms must be confirmed before acceptance.\nHuman-reviewed work with disclosed local automation; do not order if that workflow is not permitted. No customer testimonials or prior paid projects are claimed.\nBefore purchase: confirm scope, lawful input rights, non-sensitive data and permission for the proposed tools.`,
    manualSteps:['Owner verifies authentic seller/account and country eligibility','Owner reviews capabilities, capacity, price, platform rules and buyer requirements','Publish manually only on an approved account; record the real listing reference separately','Reply only to an explicit request through its original permitted channel','Do not promise acceptance, timing or results until the actual scope is reviewed','Keep marketplace-origin contracting and payment on its originating platform']};
}
export interface ValidationSpec {required:string[];uniqueKey:string}
/** Pure, deterministic implementation. Also delivered as reusable source; no external helpers. */
export function validateRecords(rows:Record<string,unknown>[],spec:ValidationSpec){
  const issues:Array<{row:number;field:string;code:string}>=[], seen=new Map<unknown,number>();let totalIssues=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    for(const key of spec.required){if(!Object.hasOwn(row,key)||row[key]===null||row[key]===''){totalIssues++;if(issues.length<200)issues.push({row:i+1,field:key,code:'required_value_missing'});}}
    const id=row[spec.uniqueKey];
    if(!Object.hasOwn(row,spec.uniqueKey)||!['string','number'].includes(typeof id)||id===''||(typeof id==='number'&&!Number.isFinite(id))){totalIssues++;if(issues.length<200)issues.push({row:i+1,field:spec.uniqueKey,code:'invalid_unique_key'});}
    else if(seen.has(id)){totalIssues++;if(issues.length<200)issues.push({row:i+1,field:spec.uniqueKey,code:'duplicate_key'});}else seen.set(id,i+1);
    for(const key of Object.keys(row)){
      const value=row[key];let code='';
      if(typeof value==='string'&&/^[\s]*[=+@-]/.test(value))code='spreadsheet_formula_risk_review';
      if(typeof value==='number'&&!Number.isFinite(value))code='non_finite_number';
      if(code){totalIssues++;if(issues.length<200)issues.push({row:i+1,field:key,code});}
    }
  }
  return {recordCount:rows.length,totalIssues,issues,truncated:totalIssues>issues.length,recordsChanged:0};
}
export function fulfillService(serviceId:string,input:string,configuration:unknown){
  const offer=serviceOffer(serviceId);
  if(typeof input!=='string'||!input.trim()||Buffer.byteLength(input)>131072)throw new MoneyError('demand_input_limit');
  const inputHash=sha256(input);let report:unknown, files:Record<string,string>={};
  if(serviceId==='json-validation'){
    const s=configuration as ValidationSpec;
    if(!s||!Array.isArray(s.required)||s.required.length<1||s.required.length>20||typeof s.uniqueKey!=='string'||!s.required.includes(s.uniqueKey)||new Set(s.required).size!==s.required.length||s.required.some(x=>typeof x!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x)||['constructor','prototype','__proto__'].includes(x)))throw new MoneyError('demand_invalid_spec');
    let rows:unknown;try{rows=JSON.parse(input);}catch{throw new MoneyError('demand_invalid_json');}
    if(!Array.isArray(rows)||rows.length<1||rows.length>5000||rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length>100))throw new MoneyError('demand_invalid_records');
    report=validateRecords(rows,s);
    files={'validator.mjs':`// Offline validator. Supply authorized JSON records; no network or writes.\nexport ${validateRecords.toString()}\n`, 'configuration.json':JSON.stringify(s,null,2),'README.txt':'Import validateRecords from validator.mjs and call it with a JSON array and configuration.json. Review findings with the client. Duplicate keys use strict type equality; numeric 1 and string "1" differ. Formula flags are warnings, not proof of malicious data. This tool never cleans or changes records. No real customer data is embedded in the deliverable.'};
  }else{
    if(configuration!==null&&configuration!==undefined)throw new MoneyError('demand_invalid_spec');
    const title=input.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i);
    const images=input.match(/<img\b[^>]*>/gi)??[];
    report={checks:{nonemptyTitle:!!title?.[1].trim(),languageAttribute:/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(input),viewport:/<meta\b[^>]*\bname\s*=\s*["']viewport["']/i.test(input),h1Count:(input.match(/<h1\b/gi)??[]).length,imageCount:images.length,imagesWithoutAlt:images.filter(x=>!/\balt\s*=/i.test(x)).length},limitations:'Heuristic source inspection only. Comments/templates/malformed HTML can affect counts. Empty alt may be intentional. No browser rendering, network, performance, link, security or WCAG certification. Human validation required.'};
  }
  const artifact=JSON.stringify({serviceId:offer.id,inputHash,report,files,humanReviewRequired:true,networkRequests:0},null,2);
  return {artifact,artifactHash:sha256(artifact),inputHash};
}
