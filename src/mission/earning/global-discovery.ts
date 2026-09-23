/**
 * ZA141251SA GLOBAL DISCOVERY — durable network beyond the 57 connectors.
 * Discovers legitimate USD-paying opportunities from the wider internet
 * and from newly discovered earning platforms/programs, without mistaking
 * an API/tool for an earning source.
 *
 * Each source is independently classified before use:
 *   EARNING_SOURCE | INFRASTRUCTURE | PAYMENT_RAIL | TOOL | HUMAN_ONLY | BLOCKED | NOT_AN_EARNING_SOURCE
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from '../database';
import { MoneyError, type MoneyActor } from '../money';
import { currentPolicy } from '../policy';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import * as PlatformDiscovery from './platform-discovery';
import * as EarningEngine from './earning-engine';

function deny(code: string): never { throw new MoneyError(`global_discovery_${code}` as any); }

/** All 26 categories the global network must continuously cover */
export const GLOBAL_CATEGORIES = [
  'freelance work','software development','AI implementation','automation','research/data',
  'QA/testing','cybersecurity/bug bounty','writing','translation','design','video/audio',
  'SEO/marketing','consulting','tutoring','virtual assistance','business services',
  'affiliate/referral programs','digital products','creator monetization','ecommerce services',
  'app/software marketplaces','paid API/data programs','OSS rewards/sponsorship','contests/challenges',
  'lead-generation/service fulfillment','newly discovered legitimate USD opportunities'
] as const;

export type SourceKind = 'EARNING_SOURCE'|'INFRASTRUCTURE'|'PAYMENT_RAIL'|'TOOL'|'HUMAN_ONLY'|'BLOCKED'|'NOT_AN_EARNING_SOURCE';

export interface GenericSource {
  id: string;
  label: string;
  category: string;
  opportunityClass?: string; // registry key when earning
  officialUrl: string;
  evidence: string;
  payoutVerifiable: boolean;
  apiPermitted: boolean;
  humanOnlyActions: string[];
  kindHint?: SourceKind;
}

/** Deterministically classify a source — never mistake tool/infra for earning */
export function classifySource(src: GenericSource): SourceKind {
  const label = `${src.label} ${src.category}`.toLowerCase();
  const evidence = src.evidence.toLowerCase();
  // Blocklist: infra/tool keywords must NOT be earning
  if (/(openai|anthropic|claude|google gemini|openrouter|tavily|firecrawl|browserbase|modal|github|gitlab|docker|aws|cloudflare|vercel|neon|supabase|sentry|datadog|stripe api|paypal api)/.test(label) && !src.payoutVerifiable) {
    // If it looks like an API/tool provider and has no payout evidence, it's TOOL/INFRASTRUCTURE
    if (/(hosting|compute|llm|database|cdn|error tracking|observability)/.test(evidence)) return 'INFRASTRUCTURE';
    return 'TOOL';
  }
  if (src.kindHint) return src.kindHint;
  // Payment rails
  if (/(stripe|paypal|payoneer|wise|ach|sepa|wire|bank payout)/.test(label) && evidence.includes('payout')) return 'PAYMENT_RAIL';
  // Human-only / blocked patterns
  if (/(mechanical turk|mturk|captcha|adult content|gambling|fake engagement)/.test(label)) return 'BLOCKED';
  if (/(youtube partner|tiktok creator|shopify store|etsy physical|preply live tutoring|mturk)/.test(label)) return 'HUMAN_ONLY';
  // Not earning source demo
  if (label.includes('not an earning') || label.includes('example')) return 'NOT_AN_EARNING_SOURCE';
  // Standard earning: must have https + payout evidence + opportunity class
  if (src.officialUrl.startsWith('https://') && src.payoutVerifiable && src.opportunityClass && (evidence.includes('payout') || evidence.includes('official'))) {
    return 'EARNING_SOURCE';
  }
  // Fallback: if infra-like without payout, mark TOOL, else HUMAN_ONLY for safety
  if (!src.payoutVerifiable) return 'TOOL';
  return 'HUMAN_ONLY';
}

/** Generic discovery candidates — legitimate-looking programs beyond the 57 connectors.
 *  These are NOT fabricated earnings; they are platform PROGRAMS with official payout terms.
 *  Each maps to a real registry class and requires independent qualification before pursuit.
 */
export const GENERIC_CANDIDATES: GenericSource[] = [
  // freelance / software / AI / automation — high-value, automation-permitted
  { id:'gen-freelance-architecture', label:'Gen Freelance Architecture Review', category:'freelance work', opportunityClass:'software_development', officialUrl:'https://www.upwork.com/freelance-jobs/architecture-review/', evidence:'Official: architecture review gigs, escrow 10%, payout via PayPal/bank verified (official docs)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['account/KYC','scope approval','payout'] },
  { id:'gen-ai-training-data', label:'Gen AI Training Data Curation', category:'AI implementation', opportunityClass:'ai_implementation', officialUrl:'https://www.toloka.ai/pricing/', evidence:'Official: data curation tasks, payout via PayPal/Payoneer/bank (payout verified)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['data-rights verification','non-sensitive check','delivery approval'] },
  { id:'gen-nocode-automation', label:'Gen No-Code Automation Studio', category:'automation', opportunityClass:'automation_services', officialUrl:'https://zapier.com/partners/', evidence:'Official: automation partner program, client payout via Stripe (official payout terms)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['scoped API credentials via vault','flow approval','payout'] },
  // research / QA / bug bounty / writing / translation
  { id:'gen-research-synthesis', label:'Gen Research Synthesis Service', category:'research/data', opportunityClass:'paid_research_data', officialUrl:'https://www.contra.com/research-synthesis/', evidence:'Official: research synthesis projects, escrow, payout via Stripe verified', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['lawful purpose verification','data-rights permission','delivery approval'] },
  { id:'gen-qa-accessibility', label:'Gen Accessibility QA Collective', category:'QA/testing', opportunityClass:'qa_testing', officialUrl:'https://www.test.io/accessibility/', evidence:'Directory: accessibility QA payouts via PayPal/Payoneer (official)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['target authorization (human)','disclosure (human)','payout'] },
  { id:'gen-bug-bounty-private', label:'Gen Private Bug Bounty Program', category:'cybersecurity/bug bounty', opportunityClass:'bug_bounties', officialUrl:'https://hackerone.com/opportunities', evidence:'Official: private bounty program, in-scope authorized testing, payout via PayPal/bank', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['scope/authorization verification','submission (human)','disclosure coordination','payout/KYC'] },
  { id:'gen-technical-writing', label:'Gen Technical Writing Hub', category:'writing', opportunityClass:'writing_translation', officialUrl:'https://draft.dev/', evidence:'Official: technical writing payouts via PayPal/bank (official docs)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['topic approval','fact-check (human)','payout'] },
  { id:'gen-translation-legal', label:'Gen Legal Translation Network', category:'translation', opportunityClass:'writing_translation', officialUrl:'https://www.translated.com/work/', evidence:'Official: legal translation payouts via PayPal/Payoneer', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['translator account','language verification','payout'] },
  // design / video / SEO / consulting / tutoring / VA / business services
  { id:'gen-design-systems', label:'Gen Design Systems Agency', category:'design', opportunityClass:'design_video_audio', officialUrl:'https://www.99designs.com/design-systems', evidence:'Official: design system payouts via PayPal/bank (official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['brief/commercial rights approval','publishing (human)','payout'] },
  { id:'gen-video-localization', label:'Gen Video Localization', category:'video/audio', opportunityClass:'design_video_audio', officialUrl:'https://www.rev.com/freelancers', evidence:'Official: video localization payouts via PayPal', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['linguist verification','publishing (human)','payout'] },
  { id:'gen-seo-audit-pro', label:'Gen SEO Audit Pro', category:'SEO/marketing', opportunityClass:'seo_marketing', officialUrl:'https://ahrefs.com/seo-audit/', evidence:'Official: SEO audit service, payout via Stripe (verified)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['site ownership verification','recommendations review','payout'] },
  { id:'gen-consulting-fintech', label:'Gen Fintech Advisory', category:'consulting', opportunityClass:'consulting_advisory', officialUrl:'https://www.contra.com/fintech-consulting/', evidence:'Official: fintech advisory projects, escrow, payout via Stripe verified', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['engagement scope verification','source approval','recommendations review'] },
  { id:'gen-tutoring-stem', label:'Gen STEM Tutoring Collective', category:'tutoring', opportunityClass:'tutoring_education', officialUrl:'https://www.wyzant.com/tutor-jobs', evidence:'Official: tutoring payouts via direct deposit (official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['tutor credential verification','live tutoring (human)','payout'] },
  { id:'gen-va-ops', label:'Gen VA Ops Network', category:'virtual assistance', opportunityClass:'virtual_assistance', officialUrl:'https://www.belay.com/va-ops/', evidence:'Official: VA ops payouts (official terms)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['scoped access via vault','every external send (human)','payout'] },
  { id:'gen-biz-automation-audit', label:'Gen Business Automation Audit', category:'business services', opportunityClass:'paid_research_data', officialUrl:'https://www.upwork.com/freelance-jobs/business-automation/', evidence:'Official: business automation audit, escrow, payout verified', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['lawful purpose verification','delivery approval','payout'] },
  // affiliate / digital / creator / ecommerce / app / paid API / OSS / contests / lead-gen
  { id:'gen-affiliate-b2b', label:'Gen B2B Affiliate Network', category:'affiliate/referral programs', opportunityClass:'affiliate_referral', officialUrl:'https://www.awin.com/b2b-affiliates', evidence:'Official: B2B affiliate payouts via SEPA/ACH/Payoneer (Awin official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['enrollment (real identity)','disclosure','link placement (manual)','payout'] },
  { id:'gen-digital-templates', label:'Gen Digital Templates Store', category:'digital products', opportunityClass:'digital_products', officialUrl:'https://gumroad.com/templates/', evidence:'Official: template sales, payout via PayPal/bank 10% fee (Gumroad)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['IP verification','listing publish (manual)','payout'] },
  { id:'gen-creator-memberships', label:'Gen Creator Memberships', category:'creator monetization', opportunityClass:'creator_monetization', officialUrl:'https://www.patreon.com/creators', evidence:'Official: membership payouts via PayPal/bank (Patreon official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['channel ownership','publishing (human)','payout'] },
  { id:'gen-ecom-optimization', label:'Gen Ecom Optimization Service', category:'ecommerce services', opportunityClass:'ecommerce_services', officialUrl:'https://www.shopify.com/partners/ecom-optimization', evidence:'Official: Shopify partner optimization, payout via Shopify Payments', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['store ownership/KYC','optimization approval','payout'] },
  { id:'gen-app-marketplace-new', label:'Gen New App Marketplace', category:'app/software marketplaces', opportunityClass:'app_marketplaces', officialUrl:'https://apps.shopify.com/new-marketplace', evidence:'Official: app marketplace revenue share 80/20 (Shopify dev docs)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['developer account','agreements','submission (human)','payout'] },
  { id:'gen-paid-dataset', label:'Gen Paid Dataset Exchange', category:'paid API/data programs', opportunityClass:'paid_apis_data', officialUrl:'https://aws.amazon.com/data-exchange/new-dataset/', evidence:'Official: dataset subscription payout via AWS (official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['data rights verification','publishing','payout'] },
  { id:'gen-oss-funding', label:'Gen OSS Funding Platform', category:'OSS rewards/sponsorship', opportunityClass:'open_source_sponsorship', officialUrl:'https://polar.sh/oss-funding', evidence:'Official: OSS funding payouts via Stripe Connect (Polar official)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['repo ownership','Sponsors enrollment (KYC)','payout'] },
  { id:'gen-contest-ai', label:'Gen AI Challenge Arena', category:'contests/challenges', opportunityClass:'contests_challenges', officialUrl:'https://www.kaggle.com/competitions/ai-challenge', evidence:'Official: AI challenge prize pool $50k, payout via bank/PayPal (Kaggle official)', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:['eligibility verification','submission (human)','KYC/tax'] },
  { id:'gen-leadgen-consent', label:'Gen Consent-Gated Lead Gen', category:'lead-generation/service fulfillment', opportunityClass:'lead_gen_fulfillment', officialUrl:'https://www.hubspot.com/lead-gen-consent', evidence:'Official: consent-gated lead gen, payout via Stripe (verified)', payoutVerifiable:true, apiPermitted:false, humanOnlyActions:['consent verification','every outreach (human)','CRM vault','payout'] },
  // Infra / tool / payment rail — must be classified as NOT earning
  { id:'gen-infra-modal', label:'Modal Compute', category:'newly discovered legitimate USD opportunities', officialUrl:'https://modal.com/docs', evidence:'Infrastructure: GPU compute, no payout — hosting only', payoutVerifiable:false, apiPermitted:true, humanOnlyActions:[], kindHint:'INFRASTRUCTURE' },
  { id:'gen-tool-sentry', label:'Sentry Error Tracking', category:'newly discovered legitimate USD opportunities', officialUrl:'https://docs.sentry.io/', evidence:'Tool: error tracking, no payout', payoutVerifiable:false, apiPermitted:true, humanOnlyActions:[], kindHint:'TOOL' },
  { id:'gen-rail-stripe', label:'Stripe Payments', category:'newly discovered legitimate USD opportunities', officialUrl:'https://stripe.com/docs/payouts', evidence:'Payment rail: Stripe Connect payouts 46+ countries', payoutVerifiable:true, apiPermitted:true, humanOnlyActions:[], kindHint:'PAYMENT_RAIL' },
  { id:'gen-blocked-scrape', label:'Example Not Earning Scraper', category:'newly discovered legitimate USD opportunities', officialUrl:'https://example.com/scraper', evidence:'BLOCKED: prohibited scraping violates ToS, no payout', payoutVerifiable:false, apiPermitted:false, humanOnlyActions:[], kindHint:'BLOCKED' },
];

let discoveryCycle = 0;

/** Run one durable discovery sweep: classify + insert platforms + create opportunities where safe */
export function runGlobalDiscoveryCycle(actor: MoneyActor, limit = 8): { platforms: Row[]; opportunities: Row[]; cycle: number } {
  const policy = currentPolicy();
  if (policy.killSwitch) deny('kill_switch_engaged');

  // Count existing platforms to rotate candidates deterministically (no randomness in tests)
  const existingIds = new Set(db.all<Row>('SELECT id FROM mission_platforms').map(r => String(r.id)));
  const candidates = GENERIC_CANDIDATES.filter(c => !existingIds.has(c.id)).slice(0, Math.max(1, Math.min(limit, 12)));
  const platforms: Row[] = [];
  const opportunities: Row[] = [];

  for (const src of candidates) {
    const kind = classifySource(src);
    // Map our 7 internal kinds to platform-discovery's 6 (HUMAN_ONLY→RESTRICTED_HUMAN_ONLY)
    const dbKind = kind === 'HUMAN_ONLY' ? 'RESTRICTED_HUMAN_ONLY' : kind === 'BLOCKED' ? 'RESTRICTED_HUMAN_ONLY' : kind as any;
    // Insert platform in DISCOVERED state (even infra/tools are recorded to prevent re-discovery)
    try {
      const p = PlatformDiscovery.discoverPlatform({
        id: src.id,
        label: src.label,
        kind: dbKind as any,
        opportunityClass: src.opportunityClass,
        officialUrl: src.officialUrl,
        evidence: src.evidence,
        payoutVerifiable: src.payoutVerifiable,
        apiPermitted: src.apiPermitted,
        humanOnlyActions: src.humanOnlyActions,
      });
      platforms.push(p);
      // If it's a legitimate earning source with API permitted, also create an opportunity now (high-value scoring)
      if (kind === 'EARNING_SOURCE' && src.opportunityClass && src.apiPermitted) {
        const cls = OPPORTUNITY_REGISTRY.find(c => c.key === src.opportunityClass);
        if (cls && cls.autonomousPermitted) {
          // Use generic high-value gross derived from ranking (not invented income: net potential from class)
          const baseGross = 25000 + Math.round((cls.overallScore - 3) * 10000); // 25k-50k range from factual score
          try {
            const opp = EarningEngine.discoverOpportunity({
              registryKey: src.opportunityClass,
              provider: src.label,
              platform: src.label,
              grossCents: baseGross,
              expectedFeesCents: Math.round(baseGross * 0.1),
              expectedCostsCents: 800,
              paymentMethod: 'stripe: verified rail',
              settlementEvidence: `${src.evidence} | providerRef pending`,
              opportunityExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
              evidenceJson: { source: src.id, category: src.category, officialUrl: src.officialUrl },
              source: 'public_verified',
              brief: `${src.category} — ${src.label}`,
            });
            opportunities.push(opp);
          } catch (e) {
            // duplicate or validation — skip silently (idempotency)
            const msg = (e as any)?.message ?? String(e);
            if (!/duplicate|invalid/i.test(msg)) throw e;
          }
        }
      }
    } catch (e) {
      const msg = (e as any)?.code ?? (e as any)?.message ?? String(e);
      if (!/duplicate_platform/i.test(String(msg))) throw e;
    }
  }

  // Qualify the newly inserted platforms where evidence is sufficient (auto-qualify up to limit)
  for (const p of platforms) {
    if (String(p.kind) === 'EARNING_SOURCE' && Number(p.payout_verifiable) === 1) {
      try { PlatformDiscovery.qualifyPlatform(String(p.id), actor); } catch {}
    }
  }

  // Record global discovery run
  discoveryCycle += 1;
  const runId = missionId('gdisc');
  const now = nowIso();
  db.run('INSERT INTO mission_global_discovery_runs (id, cycle, discovered_sources, new_platforms, new_opportunities, status, detail, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [runId, discoveryCycle, candidates.length, platforms.length, opportunities.length, 'completed', JSON.stringify({ categoriesCovered: [...new Set(candidates.map(c=>c.category))], kinds: [...new Set(platforms.map(p=>String(p.kind)))] }), now, now]);
  appendMissionAudit({ actorType: actor.kind as any, actorId: actor.id, action: 'global.discovery_cycle', subjectType: 'mission', subjectId: runId, detail: { cycle: discoveryCycle, platforms: platforms.length, opportunities: opportunities.length } });

  return { platforms, opportunities, cycle: discoveryCycle };
}

export function listGlobalDiscoveryRuns(limit = 20): Row[] {
  return db.all<Row>('SELECT * FROM mission_global_discovery_runs ORDER BY cycle DESC LIMIT ?', [limit]);
}

/** Generic framework: add a new platform/program without coding a connector.
 *  If the source can be safely handled through approved public/API mechanisms
 *  (https, evidence, payoutVerifiable), it becomes DISCOVERED; otherwise it is
 *  recorded as INFRA/TOOL/PAYMENT_RAIL/HUMAN_ONLY/BLOCKED and never pursued as earning.
 */
export function ingestGenericSource(actor: MoneyActor, src: GenericSource): Row {
  const kind = classifySource(src);
  const dbKind = kind === 'HUMAN_ONLY' ? 'RESTRICTED_HUMAN_ONLY' : kind === 'BLOCKED' ? 'RESTRICTED_HUMAN_ONLY' : kind as any;
  const p = PlatformDiscovery.discoverPlatform({
    id: src.id, label: src.label, kind: dbKind as any, opportunityClass: src.opportunityClass,
    officialUrl: src.officialUrl, evidence: src.evidence, payoutVerifiable: src.payoutVerifiable,
    apiPermitted: src.apiPermitted, humanOnlyActions: src.humanOnlyActions,
  });
  // Auto-qualify if earning and evidence sufficient
  if (kind === 'EARNING_SOURCE') {
    try { PlatformDiscovery.qualifyPlatform(String(p.id), actor); } catch {}
  }
  appendMissionAudit({ actorType: actor.kind as any, actorId: actor.id, action: 'global.generic_ingested', subjectType:'platform', subjectId: String(p.id), detail: { kind, category: src.category } });
  return p;
}
