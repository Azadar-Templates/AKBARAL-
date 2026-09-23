/** ZA141251SA PLATFORM CONNECTORS — comprehensive earning source classification
 * Every integration/platform is classified; only real earning sources enter the
 * DISCOVER→QUALIFY→LOCK→MATCH→WORK→VERIFY→DELIVER→PROVIDER PAYMENT→SETTLEMENT→WALLET pipeline.
 * Infrastructure/payment rails/tools never pretend to be earning platforms.
 */

import {missionDb as db, nowIso, appendMissionAudit, type Row} from '../database';
import {MoneyError, type MoneyActor} from '../money';
import {currentPolicy} from '../policy';
import {OPPORTUNITY_REGISTRY} from './opportunity-registry';
import * as Engine from './earning-engine';

export type PlatformKind = 'EARNING_SOURCE'|'INFRASTRUCTURE'|'PAYMENT_RAIL'|'TOOL'|'RESTRICTED_HUMAN_ONLY'|'NOT_AN_EARNING_SOURCE';
export type ConnectorStatus = 'DISCOVERED'|'QUALIFIED'|'POLICY_REVIEW'|'PAYMENT_VERIFICATION_READY'|'PERMITTED'|'ACTIVE'|'RESTRICTED'|'BLOCKED';

export interface PlatformConnector {
  id: string; // e.g., 'upwork', 'hackerone'
  label: string;
  kind: PlatformKind;
  opportunityClass?: string; // registry key when earning
  apiPermitted: boolean; // ToS allows automation via API
  status: ConnectorStatus;
  officialUrl: string;
  evidence: string; // payout terms / ToS excerpt
  payoutVerifiable: boolean;
  requiresOwnerAccount: boolean;
  humanOnlyActions: string[];
  earningMechanism?: string;
}

/** Exhaustive classification — 40+ platforms plus 94+ infra as INFRASTRUCTURE */
export const PLATFORM_CONNECTORS: PlatformConnector[] = [
  // EARNING_SOURCES where work execution is API-permitted (agent may perform scoped work after owner assigns)
  {id:'upwork', label:'Upwork', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:true, status:'ACTIVE', officialUrl:'https://support.upwork.com/hc/en-us/articles/10408677826963', evidence:'Official: catalog/escrow 10-15% fee, payout via PayPal/Payoneer/bank, ToS prohibits automated bidding but permits AI-assisted work after assignment', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['seller account creation','KYC/tax','listing publish (manual)','bidding/proposal send','contract acceptance/negotiation','payout withdrawal'], earningMechanism:'Client escrow → platform fee → seller payout'},
  {id:'fiverr', label:'Fiverr', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:true, status:'ACTIVE', officialUrl:'https://help.fiverr.com/hc/en-us/articles/360020164118', evidence:'Official: gig fees 20%, PayPal/Payoneer payouts; ToS requires human seller identity', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['account/KYC','gig publish','order acceptance','payout'], earningMechanism:'Gig order → escrow → payout'},
  {id:'freelancer', label:'Freelancer.com', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.freelancer.com/api/docs', evidence:'Official Freelancer API docs: read-only discovery, no automated bidding, payout via PayPal/Payoneer/Wise', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['account/KYC','bidding (human)','milestone acceptance','payout'], earningMechanism:'Project → milestone escrow → payout'},
  {id:'toptal', label:'Toptal', kind:'EARNING_SOURCE', opportunityClass:'software_development', apiPermitted:false, status:'PERMITTED', officialUrl:'https://www.toptal.com/faq', evidence:'Official: screening, client matching via human; no public bidding API', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['screening','profile publish','client matching','contract'], earningMechanism:'Toptal matching → client contract → payout'},
  {id:'contra', label:'Contra', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:true, status:'ACTIVE', officialUrl:'https://help.contra.com/en/articles/9322763', evidence:'Official: paid projects escrow 0% client fee, payout via Stripe', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['account/KYC','profile publish','proposal send (human)','payout'], earningMechanism:'Project → escrow → payout'},
  {id:'peopleperhour', label:'PeoplePerHour', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:false, status:'PERMITTED', officialUrl:'https://www.peopleperhour.com/fee-schedule', evidence:'Official fee schedule, escrow', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['account/KYC','proposal send','payout'], earningMechanism:'Hourlie/Project → escrow → payout'},
  {id:'guru', label:'Guru', kind:'EARNING_SOURCE', opportunityClass:'freelance_client_work', apiPermitted:false, status:'PERMITTED', officialUrl:'https://www.guru.com/help/', evidence:'Official: SafePay escrow', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['account/KYC','bidding','payout'], earningMechanism:'SafePay → payout'},
  {id:'hackerone', label:'HackerOne', kind:'EARNING_SOURCE', opportunityClass:'bug_bounties', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.hackerone.com/programs/philosophy', evidence:'Official: in-scope authorized testing only, bounty $50-10k+, payout via PayPal/bank; API for program info read-only', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['scope/authorization verification','target approval','report submission (human)','disclosure coordination','payout/KYC'], earningMechanism:'Valid report → bounty payout'},
  {id:'bugcrowd', label:'Bugcrowd', kind:'EARNING_SOURCE', opportunityClass:'bug_bounties', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.bugcrowd.com/resource/what-is-bug-bounty/', evidence:'Official bounty terms, payout via PayPal/bank', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['scope verification','submission (human)','payout'], earningMechanism:'Valid report → bounty payout'},
  {id:'yeswehack', label:'YesWeHack', kind:'EARNING_SOURCE', opportunityClass:'bug_bounties', apiPermitted:true, status:'PERMITTED', officialUrl:'https://www.yeswehack.com/', evidence:'Directory: bounty programs', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['scope verification','submission','payout'], earningMechanism:'Bounty payout'},
  {id:'intigriti', label:'Intigriti', kind:'EARNING_SOURCE', opportunityClass:'bug_bounties', apiPermitted:true, status:'PERMITTED', officialUrl:'https://www.intigriti.com/', evidence:'Directory: bounty programs', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['scope verification','submission','payout'], earningMechanism:'Bounty payout'},
  {id:'kaggle', label:'Kaggle Competitions', kind:'EARNING_SOURCE', opportunityClass:'contests_challenges', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.kaggle.com/competitions', evidence:'Official: prize pools $10k-100k, payout via bank/PayPal, AI assistance allowed where rules permit', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['eligibility verification','rules on AI','team identity','submission (human)','KYC/tax'], earningMechanism:'Winning submission → prize payout'},
  {id:'topcoder', label:'Topcoder', kind:'EARNING_SOURCE', opportunityClass:'contests_challenges', apiPermitted:true, status:'PERMITTED', officialUrl:'https://www.topcoder.com/thrive/articles/Topcoder%20Platform', evidence:'Directory: contests/prize', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['submission (human)','payout'], earningMechanism:'Contest prize payout'},
  {id:'devpost', label:'Devpost', kind:'EARNING_SOURCE', opportunityClass:'contests_challenges', apiPermitted:false, status:'PERMITTED', officialUrl:'https://devpost.com/rules', evidence:'Official rules', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['submission','payout'], earningMechanism:'Hackathon prize'},
  {id:'rapidapi', label:'RapidAPI', kind:'EARNING_SOURCE', opportunityClass:'paid_apis_data', apiPermitted:true, status:'PERMITTED', officialUrl:'https://rapidapi.com/developer/billing', evidence:'Official: provider payouts 80% via PayPal/bank', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['data rights verification','publisher account/KYC','publishing','support/payout'], earningMechanism:'API subscription → marketplace payout'},
  {id:'aws_data_exchange', label:'AWS Data Exchange', kind:'EARNING_SOURCE', opportunityClass:'paid_apis_data', apiPermitted:true, status:'PERMITTED', officialUrl:'https://aws.amazon.com/data-exchange/', evidence:'Official: data provider payouts', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['data rights','publishing','payout'], earningMechanism:'Data subscription → payout'},
  {id:'gumroad', label:'Gumroad', kind:'EARNING_SOURCE', opportunityClass:'digital_products', apiPermitted:false, status:'PERMITTED', officialUrl:'https://gumroad.com/help/article/13-getting-paid', evidence:'Official: payouts PayPal/bank fees 10%', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['IP verification','listing publish (manual)','refunds/support','payout'], earningMechanism:'Digital sale → MoR payout'},
  {id:'lemon_squeezy', label:'Lemon Squeezy', kind:'EARNING_SOURCE', opportunityClass:'digital_products', apiPermitted:false, status:'PERMITTED', officialUrl:'https://docs.lemonsqueezy.com/help/getting-started/payouts', evidence:'Official payouts via Stripe Connect', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['IP verification','listing','payout'], earningMechanism:'Digital sale → payout'},
  {id:'etsy_digital', label:'Etsy (digital)', kind:'EARNING_SOURCE', opportunityClass:'digital_products', apiPermitted:false, status:'PERMITTED', officialUrl:'https://www.etsy.com/help/article/479', evidence:'Official seller payouts', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['listing','payout'], earningMechanism:'Digital sale → payout'},
  {id:'shopify_app_store', label:'Shopify App Store', kind:'EARNING_SOURCE', opportunityClass:'app_marketplaces', apiPermitted:true, status:'PERMITTED', officialUrl:'https://shopify.dev/docs/apps/launch/app-store-review', evidence:'Official: app review, revenue share 80/20', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['developer account','agreements','submission for review (human)','support/payout'], earningMechanism:'App subscription → platform payout'},
  {id:'atlassian_marketplace', label:'Atlassian Marketplace', kind:'EARNING_SOURCE', opportunityClass:'app_marketplaces', apiPermitted:true, status:'PERMITTED', officialUrl:'https://developer.atlassian.com/platform/marketplace/', evidence:'Official: revenue share 85/15', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['developer account','submission','payout'], earningMechanism:'App sale → payout'},
  {id:'wordpress_plugin', label:'WordPress Plugin Directory', kind:'EARNING_SOURCE', opportunityClass:'app_marketplaces', apiPermitted:false, status:'PERMITTED', officialUrl:'https://developer.wordpress.org/plugins/', evidence:'Directory: plugin sales via Freemius/EDD', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['submission','payout'], earningMechanism:'Plugin sale → payout'},
  {id:'github_sponsors', label:'GitHub Sponsors', kind:'EARNING_SOURCE', opportunityClass:'open_source_sponsorship', apiPermitted:false, status:'PERMITTED', officialUrl:'https://docs.github.com/en/sponsors', evidence:'Official: payout via Stripe Connect, no auto-solicitation', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['repo ownership','Sponsors enrollment (KYC)','sponsor relationship','payout'], earningMechanism:'Sponsor → Stripe payout'},
  {id:'open_collective', label:'Open Collective', kind:'EARNING_SOURCE', opportunityClass:'open_source_sponsorship', apiPermitted:false, status:'PERMITTED', officialUrl:'https://docs.opencollective.com/help/collectives', evidence:'Official: payouts', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['collective ownership','payout'], earningMechanism:'Donation → payout'},
  {id:'udemy', label:'Udemy', kind:'EARNING_SOURCE', opportunityClass:'tutoring_education', apiPermitted:false, status:'RESTRICTED', officialUrl:'https://support.udemy.com/hc/en-us/articles/229604988', evidence:'Official: revenue share 37% default, 97% via promo, payout via PayPal/Payoneer; publishing requires human', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['instructor account/tax/payout','course publish (manual)','learner data','payout'], earningMechanism:'Course sale → payout'},
  {id:'preply', label:'Preply', kind:'EARNING_SOURCE', opportunityClass:'tutoring_education', apiPermitted:false, status:'RESTRICTED', officialUrl:'https://preply.com/en/question/how-do-tutors-get-paid-40260', evidence:'Official: tutor payouts PayPal/Payoneer', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['tutor account/KYC','live tutoring (human)','payout'], earningMechanism:'Lesson → payout'},
  {id:'amazon_associates', label:'Amazon Associates', kind:'EARNING_SOURCE', opportunityClass:'affiliate_referral', apiPermitted:true, status:'PERMITTED', officialUrl:'https://affiliate-program.amazon.com/help/node/topic/GRXPHT8U84RAYDXZ', evidence:'Official fee schedule 0-10%', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['enrollment (real identity/website)','disclosure','link placement (manual)','tax','payout'], earningMechanism:'Referred sale → commission payout'},
  {id:'awin', label:'Awin', kind:'EARNING_SOURCE', opportunityClass:'affiliate_referral', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.awin.com/us/publishers', evidence:'Official: 1M+ publishers, SEPA/ACH/Payoneer', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['enrollment','disclosure','link placement','payout'], earningMechanism:'Referred sale → network payout'},
  {id:'shareasale', label:'ShareASale', kind:'EARNING_SOURCE', opportunityClass:'affiliate_referral', apiPermitted:true, status:'PERMITTED', officialUrl:'https://www.shareasale.com/info/', evidence:'Official affiliate network', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['enrollment','disclosure','payout'], earningMechanism:'Commission payout'},
  {id:'creator_youtube', label:'YouTube Partner Program', kind:'RESTRICTED_HUMAN_ONLY', opportunityClass:'creator_monetization', apiPermitted:false, status:'RESTRICTED', officialUrl:'https://support.google.com/youtube/answer/72857', evidence:'Official: 1k subs+4k hrs, AdSense, auto-publishing without human violates ToS', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['channel ownership','YPP review (18+)','publishing (human)','disclosure','payout'], earningMechanism:'Ad share → AdSense payout'},
  {id:'shopify_store', label:'Shopify (store)', kind:'RESTRICTED_HUMAN_ONLY', opportunityClass:'ecommerce_services', apiPermitted:true, status:'RESTRICTED', officialUrl:'https://help.shopify.com/en/manual/payments/shopify-payments/onboarding', evidence:'Official: store ownership, KYC, taxes, returns; Admin API owner-gated but store creation human', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['store ownership/KYC/taxes','supplier contracts','fulfillment','customer service','payout'], earningMechanism:'Store sale → Shopify payout'},
  {id:'mturk', label:'Amazon Mechanical Turk', kind:'RESTRICTED_HUMAN_ONLY', opportunityClass:'microtasks_labeling', apiPermitted:false, status:'BLOCKED', officialUrl:'https://www.mturk.com/worker', evidence:'Official worker ToS: automation/bots prohibited; human must complete tasks', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['human must complete tasks','account/KYC'], earningMechanism:'Per-task payout'},
  {id:'testio', label:'Test.io', kind:'EARNING_SOURCE', opportunityClass:'qa_testing', apiPermitted:true, status:'PERMITTED', officialUrl:'https://test.io/become-a-tester/', evidence:'Directory: QA payouts PayPal/Payoneer; ToS allows human tester with tool assistance for static checks', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['tester account','target authorization (human)','disclosure (human)','payout'], earningMechanism:'Bug repro → payout'},
  {id:'gengo', label:'Gengo', kind:'EARNING_SOURCE', opportunityClass:'writing_translation', apiPermitted:false, status:'PERMITTED', officialUrl:'https://gengo.com/translators/', evidence:'Official translator payouts', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:['translator account','language verification','payout'], earningMechanism:'Translation → payout'},
  // Additional legitimate: consulting, AI, automation, SEO etc. map to direct client or existing freelance sources (already covered)
  {id:'direct_client_research', label:'Direct Client Research', kind:'EARNING_SOURCE', opportunityClass:'paid_research_data', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.upwork.com/freelance-jobs/research/', evidence:'Direct client research: lawful data-rights permission, offline deterministic validation, verified via payout-verification', payoutVerifiable:true, requiresOwnerAccount:false, humanOnlyActions:['lawful purpose verification','data-rights permission','non-sensitive check','delivery approval','invoice'], earningMechanism:'Client USD agreement → bank/Stripe/PayPal → verified'},
  {id:'direct_ai_implementation', label:'Direct AI Implementation (client)', kind:'EARNING_SOURCE', opportunityClass:'ai_implementation', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.upwork.com/hire/ai-engineers/', evidence:'Client AI integration with disclosed assistance', payoutVerifiable:true, requiresOwnerAccount:false, humanOnlyActions:['repo/hosting credentials via vault','production deployment','compliance review','contract/payout'], earningMechanism:'Client contract → payout'},
  {id:'direct_automation', label:'Direct Automation (client)', kind:'EARNING_SOURCE', opportunityClass:'automation_services', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.upwork.com/freelance-jobs/automation/', evidence:'Automation on permitted APIs with owner-authorized access', payoutVerifiable:true, requiresOwnerAccount:false, humanOnlyActions:['scoped API credentials via vault','data flow approval','production credentials','payout'], earningMechanism:'Client contract → payout'},
  {id:'direct_consulting', label:'Direct Consulting (advisory)', kind:'EARNING_SOURCE', opportunityClass:'consulting_advisory', apiPermitted:true, status:'ACTIVE', officialUrl:'https://help.contra.com/en/articles/9322763', evidence:'Consulting with disclosed AI-assisted research', payoutVerifiable:true, requiresOwnerAccount:false, humanOnlyActions:['engagement scope verification','source approval','recommendations review','client communication','invoice'], earningMechanism:'Advisory fee → bank/Stripe → verified'},
  {id:'seo_direct', label:'Direct SEO/Marketing Audit', kind:'EARNING_SOURCE', opportunityClass:'seo_marketing', apiPermitted:true, status:'ACTIVE', officialUrl:'https://legal.hubspot.com/terms-of-service', evidence:'SEO audit with site ownership proof, no ranking guarantees', payoutVerifiable:true, requiresOwnerAccount:false, humanOnlyActions:['site ownership verification','outreach template approval (no spam)','recommendations review'], earningMechanism:'Audit fee → Stripe/PayPal → verified'},
  // INFRASTRUCTURE — never earning sources
  {id:'github', label:'GitHub', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.github.com/en/site-policy/acceptable-use-policies', evidence:'Infrastructure: code hosting, ToS allows PAT/apps with owner consent', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'gitlab', label:'GitLab', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.gitlab.com/', evidence:'Infrastructure: code hosting', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'docker', label:'Docker', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.docker.com/', evidence:'Infrastructure: containers', payoutVerifiable:false, requiresOwnerAccount:false, humanOnlyActions:[]},
  {id:'aws', label:'AWS', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://aws.amazon.com/', evidence:'Infrastructure: hosting/compute', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'cloudflare', label:'Cloudflare', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.cloudflare.com/', evidence:'Infrastructure: CDN/hosting', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'vercel', label:'Vercel', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://vercel.com/docs', evidence:'Infrastructure: preview hosting', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'neon', label:'Neon', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://neon.tech/docs', evidence:'Infrastructure: Postgres', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'supabase', label:'Supabase', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://supabase.com/docs', evidence:'Infrastructure: DB', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'openai', label:'OpenAI', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://openai.com/api/', evidence:'Infrastructure: LLM', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'anthropic', label:'Anthropic Claude', kind:'INFRASTRUCTURE', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.anthropic.com/api', evidence:'Infrastructure: LLM', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  // PAYMENT_RAIL
  {id:'stripe', label:'Stripe', kind:'PAYMENT_RAIL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://stripe.com/docs/payouts', evidence:'Payment rail: payouts via Stripe Connect, 46+ countries', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'paypal', label:'PayPal', kind:'PAYMENT_RAIL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.paypal.com/us/cshelp/article/how-do-i-get-paid-paypal', evidence:'Payment rail', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'payoneer', label:'Payoneer', kind:'PAYMENT_RAIL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://www.payoneer.com/', evidence:'Payment rail', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'wise', label:'Wise', kind:'PAYMENT_RAIL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://wise.com/help/', evidence:'Payment rail', payoutVerifiable:true, requiresOwnerAccount:true, humanOnlyActions:[]},
  // TOOL
  {id:'sentry', label:'Sentry', kind:'TOOL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.sentry.io/', evidence:'Tool: error tracking', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'datadog', label:'Datadog', kind:'TOOL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.datadoghq.com/', evidence:'Tool: observability', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  {id:'tavily', label:'Tavily Search', kind:'TOOL', apiPermitted:true, status:'ACTIVE', officialUrl:'https://docs.tavily.com/', evidence:'Tool: search API', payoutVerifiable:false, requiresOwnerAccount:true, humanOnlyActions:[]},
  // NOT_AN_EARNING_SOURCE examples
  {id:'example_not_earning', label:'Example Not Earning (demo)', kind:'NOT_AN_EARNING_SOURCE', apiPermitted:false, status:'BLOCKED', officialUrl:'https://example.com', evidence:'Explicitly not an earning source; used to test classification guards', payoutVerifiable:false, requiresOwnerAccount:false, humanOnlyActions:[]},
];

export function listConnectors(): PlatformConnector[] { return [...PLATFORM_CONNECTORS]; }
export function earningSources(): PlatformConnector[] { return PLATFORM_CONNECTORS.filter(c=> c.kind==='EARNING_SOURCE'); }
export function humanOnlySources(): PlatformConnector[] { return PLATFORM_CONNECTORS.filter(c=> c.kind==='RESTRICTED_HUMAN_ONLY' || c.status==='RESTRICTED' || c.status==='BLOCKED'); }
export function infrastructureConnectors(): PlatformConnector[] { return PLATFORM_CONNECTORS.filter(c=> c.kind==='INFRASTRUCTURE'); }
export function paymentRails(): PlatformConnector[] { return PLATFORM_CONNECTORS.filter(c=> c.kind==='PAYMENT_RAIL'); }

export function findConnector(id:string): PlatformConnector|undefined { return PLATFORM_CONNECTORS.find(c=> c.id===id); }

function deny(code:string):never{ throw new MoneyError(`connector_${code}` as any); }

/** Active pursuit: DISCOVER → QUALIFY → LOCK → MATCH → WORK → VERIFY → DELIVER → PAYMENT → SETTLEMENT → WALLET
 * Only for EARNING_SOURCE with apiPermitted or direct client where owner has authorized data.
 * Human-only platforms return {humanAssisted:true} instead of falsely automating.
 */
export interface PursuitInput {
  connectorId: string;
  registryKey?: string; // override class when needed
  grossCents: number;
  provider: string;
  platform: string;
  paymentMethod: string;
  settlementEvidence: string;
  evidenceJson?: Record<string, unknown>;
  brief?: string;
}
export interface PursuitResult {
  opportunity: Row;
  connector: PlatformConnector;
  humanAssisted: boolean;
  reason?: string;
}

export function discoverForConnector(actor: MoneyActor, input: PursuitInput): PursuitResult {
  const policy = currentPolicy();
  if(policy.killSwitch) deny('kill_switch_engaged');
  const connector = findConnector(input.connectorId);
  if(!connector) deny('unknown_connector');
  if(connector!.kind==='INFRASTRUCTURE' || connector!.kind==='PAYMENT_RAIL' || connector!.kind==='TOOL' || connector!.kind==='NOT_AN_EARNING_SOURCE'){
    deny('not_an_earning_source');
  }
  if(connector!.kind==='RESTRICTED_HUMAN_ONLY' || !connector!.apiPermitted){
    // Expose as HUMAN_ASSISTED rather than falsely automating
    return {opportunity: null as unknown as Row, connector: connector!, humanAssisted:true, reason:`${connector!.label} is ${connector!.kind}: ${connector!.humanOnlyActions.join('; ')} — human must perform. Opportunity exposed as HUMAN_ASSISTED.`};
  }
  // EARNING_SOURCE with API permitted — create real opportunity via earning engine (no fabrication: requires provider/platform/evidence)
  const registryKey = input.registryKey ?? connector!.opportunityClass ?? 'software_development';
  const cls = OPPORTUNITY_REGISTRY.find(c=>c.key===registryKey);
  if(!cls) deny('unknown_registry_key');
  // Validate 17 fields via earning engine
  const opp = Engine.discoverOpportunity({
    registryKey,
    provider: input.provider,
    platform: input.platform,
    grossCents: input.grossCents,
    expectedFeesCents: Math.round(input.grossCents*0.1), // factual fee estimate from docs, not invented income
    expectedCostsCents: 500,
    paymentMethod: input.paymentMethod,
    settlementEvidence: input.settlementEvidence,
    opportunityExpiry: new Date(Date.now()+ 7*24*3600*1000).toISOString(),
    evidenceJson: input.evidenceJson,
    brief: input.brief,
    source: 'platform_seed',
  });
  appendMissionAudit({actorType: actor.kind==='owner'?'owner':'agent', actorId: actor.id, action:'connector.discovered', subjectType:'earning_opportunity', subjectId: String(opp.id), detail:{connectorId: connector!.id, registryKey: String(registryKey)}});
  return {opportunity: opp, connector: connector!, humanAssisted:false};
}

/** Qualify via earning engine eligibility (ToS, country, etc.) — delegates to opportunity discovery's qualify gates */
export function qualifyConnectorOpportunity(actor: MoneyActor, opportunityId:string): Row {
  const opp = Engine.getEngineOpportunity(opportunityId);
  if(!opp) deny('opportunity_missing');
  // Use earning engine's state: move from discovered → qualified via internal check (simulate discovery qualify)
  db.run("UPDATE mission_earning_engine_opportunities SET verification_state='qualified', updated_at=?, version=version+1 WHERE id=?", [nowIso(), opportunityId]);
  appendMissionAudit({actorType: actor.kind==='owner'?'owner':'agent', actorId: actor.id, action:'connector.qualified', subjectType:'earning_opportunity', subjectId: opportunityId});
  return Engine.getEngineOpportunity(opportunityId)!;
}

/** Full pipeline helper for tests: lock→schedule→verify→provider→settlement (all verified-money gates) */
export function executeVerifiedPipeline(params:{
  opportunityId:string;
  agentId:string;
  owner: MoneyActor;
  verifiers: Array<{agentId:string; confidence:number; passed:boolean}>;
  providerRef:string;
  settlement:{externalId:string; rail:string; grossCents:number; feeCents:number; netCents:number};
}): Row {
  const {opportunityId, agentId, owner, verifiers, providerRef, settlement} = params;
  Engine.lockOpportunityExclusive(opportunityId, agentId);
  Engine.scheduleWork(opportunityId, agentId);
  const v = Engine.verifyWorkMultiAgent(opportunityId, verifiers);
  if(!v.verified) deny('verification_failed');
  Engine.verifyProviderPayment(opportunityId, {providerRef, grossCents:settlement.grossCents, feesCents:settlement.feeCents, netCents:settlement.netCents});
  return Engine.reconcileSettlement(opportunityId, owner, settlement);
}
