/** Comprehensive REAL earning opportunity inventory — beyond the 94 integrations.
 * Each entry is classified on 14 factual dimensions; no income is guaranteed,
 * no listing is a job, no estimate is revenue. Only verified USD settlement
 * via independently verified payout enters mission cash.
 *
 * Built from official platform docs + reputable directories; statuses:
 *  - verified: payout terms confirmed on official domain
 *  - candidate: reputable directory, needs official re-check before assignment
 *  - restricted: requires additional owner setup / payout integration not yet installed
 *
 * Autonomous pursuit is permitted only where platform ToS explicitly allows
 * agent/automation assistance and the task is executable with existing tools.
 * Human remains for identity/account/contracts/sensitive/restricted/payouts.
 */

export interface OpportunityClass {
  key: string;
  label: string;
  /** 1 REAL earning mechanism */
  earningMechanism: string;
  /** 2 Actual work the agent performs */
  agentWork: string;
  /** 3 Customer/employer/opportunity source */
  customerSource: string;
  /** 4 USD payment mechanism */
  usdPaymentMechanism: string;
  /** 5 Payout method and settlement evidence */
  payoutMethodAndSettlementEvidence: string;
  /** 6 Whether autonomous agents are permitted (strict: must be explicit in ToS) */
  autonomousPermitted: boolean;
  autonomousNote: string;
  /** 7 What must remain human-controlled */
  humanControlled: string;
  /** 8 Country/eligibility restrictions */
  countryRestrictions: string;
  /** 9 API/automation availability */
  apiAutomationAvailability: string;
  /** 10 Account requirements */
  accountRequirements: string;
  /** 11 Expected costs */
  expectedCosts: string;
  /** 12 Fraud/ToS/KYC risks */
  fraudRisks: string;
  /** 13 Whether opportunity can be assigned exclusively to one mission agent */
  exclusivelyAssignable: boolean;
  /** 14 Whether payment can be independently verified before entering mission cash */
  paymentVerifiable: boolean;
  // ranking helpers
  status: 'verified' | 'candidate' | 'restricted';
  integrations: string[]; // subset of 94+ used as infrastructure
  ranking: {
    genuinePaidWork: number; // 1-5
    automationPermission: number;
    usdVerifiability: number;
    accessibility: number;
    scalability: number;
    setupRequirements: number; // 5 = minimal setup, 1 = heavy
    operatingCost: number; // 5 = low cost, 1 = high
  };
  overallScore: number; // computed
  representativePlatforms: Array<{name: string; officialUrl: string; evidence: string}>;
}

function score(o: Omit<OpportunityClass, 'overallScore'>): OpportunityClass {
  const r = o.ranking;
  // weighted: paidWork 2, automation 2, verifiability 2, accessibility 1, scalability 1, setup 1, cost 1
  const overall = Math.round((r.genuinePaidWork*2 + r.automationPermission*2 + r.usdVerifiability*2 + r.accessibility + r.scalability + r.setupRequirements + r.operatingCost)/10 * 10)/10;
  return {...o, overallScore: overall};
}

export const OPPORTUNITY_REGISTRY: OpportunityClass[] = [
  score({
    key: 'freelance_client_work',
    label: 'Freelance / Client Work (fixed-price services)',
    earningMechanism: 'Client pays for delivered scoped service via marketplace escrow (Upwork, Fiverr, Freelancer, Contra, Toptal, PeoplePerHour, Guru).',
    agentWork: 'Agent drafts proposal research, builds validator/check report, QA artifacts, code fixes using GitHub/Docker/AWS/Cloudflare/Vercel; no automated bidding, no fake accounts, no impersonation.',
    customerSource: 'Real buyer browsing Project Catalog/Gigs or posting funded contract; must be explicit buyer-initiated request on permitted marketplace.',
    usdPaymentMechanism: 'Marketplace escrow → platform fee → seller payout (USD where supported).',
    payoutMethodAndSettlementEvidence: 'Platform payout to linked PayPal/Payoneer/Wise / bank; settlement verified via payout-verification adapter + receiving rail proof before entering mission cash; platform fee 5-20% documented.',
    autonomousPermitted: false,
    autonomousNote: 'Agents may NOT auto-bid or auto-create listings; platform ToS requires human seller identity and owner-approved engagement. Agents may autonomously PERFORM scoped work after owner assigns one agent to one opportunity.',
    humanControlled: 'Owner creates/owns seller account (real identity, KYC, tax), publishes listing (manual), approves scope/price, accepts contract, negotiates, handles payouts/withdrawals.',
    countryRestrictions: 'Marketplace-dependent; most require 18+, tax ID, supported payout country (US/EU/UK + many others; varies – see official eligibility).',
    apiAutomationAvailability: 'Read-only or owner-PAT where documented (Freelancer API, Upwork GraphQL); bidding/listing APIs restricted; no sanctioned bulk automation.',
    accountRequirements: 'Real human seller account, KYC, payout method, skills verification (Toptal screening), platform fees.',
    expectedCosts: 'Marketplace fees 5-20% + payout fees $0-3 or 1-2%; no upfront inventory.',
    fraudRisks: 'Fake buyer requests, off-platform diversion, KYC bypass, automated bidding violates ToS – all blocked by compiled deny-list.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'verified',
    integrations: ['GitHub','GitLab','Docker','AWS','Cloudflare','Vercel','Netlify','PostgreSQL','Supabase','Neon','Sentry','Stripe','PayPal','Payoneer','Wise'],
    ranking: {genuinePaidWork:5, automationPermission:2, usdVerifiability:5, accessibility:3, scalability:3, setupRequirements:2, operatingCost:4},
    representativePlatforms: [
      {name:'Upwork Project Catalog', officialUrl:'https://support.upwork.com/hc/en-us/articles/10408677826963', evidence:'Official: catalog listings, escrow, fee 10-15% (support.upwork.com)'},
      {name:'Fiverr', officialUrl:'https://help.fiverr.com/hc/en-us/articles/360020164118', evidence:'Official: gig fees 20%, PayPal/Payoneer payouts (help.fiverr.com)'},
      {name:'Contra', officialUrl:'https://help.contra.com/en/articles/9322763', evidence:'Official: paid projects, escrow, fee 0% for client (help.contra.com)'},
    ]
  }),
  score({
    key: 'paid_research_data',
    label: 'Paid Research / Data Work (client-owned datasets)',
    earningMechanism: 'Client pays for analysis of their own/lawfully licensed data (validation, reproducible findings).',
    agentWork: 'Agent runs offline deterministic validation (json-validation pack), source-backed research via Tavily/Brave/Firecrawl/Browserbase (permitted search), Excel builds; no scraping of prohibited sources, no personal data harvesting.',
    customerSource: 'Real client with explicit request + data-rights permission via inbound/permitted_feed; no cold outreach without consent.',
    usdPaymentMechanism: 'Direct client USD agreement or marketplace (Upwork/Contra) escrow.',
    payoutMethodAndSettlementEvidence: 'Bank wire / Stripe / PayPal → payout-verification then receiving rail credit; net USD only after independent verification.',
    autonomousPermitted: true,
    autonomousNote: 'Autonomous execution permitted for bounded offline work on owner-authorized non-sensitive data; publishing/sending remains human-controlled, no bulk scraping.',
    humanControlled: 'Owner verifies lawful purpose, dataset rights, non-sensitive only, scope and acceptance; approves delivery and invoice.',
    countryRestrictions: 'Client country per contract; agent work location agnostic; payout country per processor (Stripe 46+ countries).',
    apiAutomationAvailability: 'Full for research tools (Tavily/Brave/Serper/Google Custom Search, Firecrawl) under SSRF guard; no platform automation needed.',
    accountRequirements: 'None for offline work; delivery may use GitHub/Drive/Docs if client authorizes.',
    expectedCosts: 'Model/inference cost (OpenAI/Anthropic/Gemini via OpenRouter) ~ $0.01-0.50 per task + search API costs; no platform fees.',
    fraudRisks: 'Invented results, personal-data harvesting, scraping ToS violation – blocked by validation + suppression + deny-list.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'verified',
    integrations: ['Tavily','Brave Search','Serper','Google Custom Search','Firecrawl','Browserbase','Browserless','Apify','OpenAI','Anthropic Claude','Google Gemini','OpenRouter','Hugging Face','Excel Build'],
    ranking: {genuinePaidWork:5, automationPermission:5, usdVerifiability:4, accessibility:5, scalability:4, setupRequirements:5, operatingCost:5},
    representativePlatforms: [
      {name:'Direct research services', officialUrl:'https://www.upwork.com/freelance-jobs/research/', evidence:'Directory: research gigs, escrow, payout verification (upwork.com)'},
    ]
  }),
  score({
    key: 'software_development',
    label: 'Software Development (custom tools, API integration, automation)',
    earningMechanism: 'Client pays for custom software, API integration, bug fix, or automation implemented and delivered.',
    agentWork: 'Agent writes/tests code (GitHub/GitLab), builds container (Docker), deploys preview (Vercel/Cloudflare/Modal), validates via executor/verifier; artifact is reusable offline validator/checker.',
    customerSource: 'Inbound client or marketplace contract where AI assistance is contract-permitted and disclosed.',
    usdPaymentMechanism: 'Marketplace escrow or direct Stripe/PayPal invoice.',
    payoutMethodAndSettlementEvidence: 'Same as freelance: platform/Stripe payout → payout-verification + bank credit proof.',
    autonomousPermitted: true,
    autonomousNote: 'Permitted where contract allows AI assistance and human review is disclosed; agents do code work, owner handles repo access and production credentials.',
    humanControlled: 'Owner approves repo/hosting access, credentials via vault, production deployment, contract signing, payout.',
    countryRestrictions: 'As per freelance; no additional restrictions.',
    apiAutomationAvailability: 'Full (GitHub/GitLab APIs, Docker, AWS/GCP/Azure, Cloudflare, Vercel, Neon/Supabase) under vault + policy caps.',
    accountRequirements: 'Owner-provided repo access, hosting/PAT via encrypted vault, no shared credentials.',
    expectedCosts: 'Inference + hosting (~$0.10-2 per task), no marketplace fee if direct.',
    fraudRisks: 'Supply-chain, secret leakage, unauthorized prod changes – blocked by secret scan + scope hash + vault.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'verified',
    integrations: ['GitHub','GitLab','Docker','AWS','Google Cloud','Azure','Cloudflare','Vercel','Neon','Supabase','PostgreSQL','Sentry','Datadog'],
    ranking: {genuinePaidWork:5, automationPermission:5, usdVerifiability:5, accessibility:4, scalability:4, setupRequirements:4, operatingCost:4},
    representativePlatforms: [
      {name:'GitHub', officialUrl:'https://docs.github.com/en/site-policy/acceptable-use-policies', evidence:'Official: ToS allows automation via PAT/apps with owner consent (docs.github.com)'},
    ]
  }),
  score({
    key: 'qa_testing',
    label: 'QA / Testing (manual + automated test packs)',
    earningMechanism: 'Client pays for test execution, bug reproduction, or test-suite delivery (uTest, Test.io, Tester Work, freelance QA gigs).',
    agentWork: 'Agent executes reproducible offline checks (html-release-check pack), static analysis, writes Playwright/unit tests; no unauthorized penetration testing.',
    customerSource: 'Marketplace QA project or direct client with explicit URL/repo permission and non-sensitive test data.',
    usdPaymentMechanism: 'Platform payout or direct invoice (USD).',
    payoutMethodAndSettlementEvidence: 'PayPal/Payoneer/bank via platform; verified before treasury (same chain).',
    autonomousPermitted: true,
    autonomousNote: 'Static offline checks are permitted; any crawling/fetching requires owner-authorized HTML source, not URL; no pen-testing.',
    humanControlled: 'Owner authorizes target (HTML source, not URL), reviews checklist, approves disclosure, handles platform account.',
    countryRestrictions: '18+, payout country per platform (Test.io supports  50+ countries).',
    apiAutomationAvailability: 'Limited execution via Browserless/Browserbase if explicitly permitted; otherwise offline.',
    accountRequirements: 'Platform tester account (owner-controlled) if applicable; otherwise direct client agreement.',
    expectedCosts: 'Inference + browser minutes (~$0.05-1); platform fees 0-20%.',
    fraudRisks: 'Unauthorized testing, ToS violation for live sites, fake bug reports – blocked by input limit (128 KiB, no URLs) + human review gate.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Browserless','Browserbase','GitHub','Sentry','Datadog','Slack','Discord'],
    ranking: {genuinePaidWork:4, automationPermission:4, usdVerifiability:4, accessibility:4, scalability:3, setupRequirements:4, operatingCost:5},
    representativePlatforms: [
      {name:'Test.io', officialUrl:'https://test.io/become-a-tester/', evidence:'Directory: tester payouts via PayPal/Payoneer (test.io)'},
      {name:'uTest', officialUrl:'https://www.utest.com/terms', evidence:'Official: tester terms, payout methods (utest.com)'},
    ]
  }),
  score({
    key: 'design_video_audio',
    label: 'Design / Video / Audio (original creative, no ranking guarantees)',
    earningMechanism: 'Client pays for original design, video edit, or audio production (99designs, Dribbble, Behance, Fiverr, Contra).',
    agentWork: 'Agent generates drafts via Stability AI/Replicate/Runway/Canva/Adobe integrations where licensed; human selects/refines; no fake engagement.',
    customerSource: 'Contest or direct client brief with explicit asset rights and non-stock sources.',
    usdPaymentMechanism: 'Marketplace escrow or direct.',
    payoutMethodAndSettlementEvidence: 'Same marketplace chain; digital delivery verified, payout verified before cash.',
    autonomousPermitted: false,
    autonomousNote: 'Draft generation may be automated, but publishing, contest submission, and final delivery require human creative direction and platform account ownership.',
    humanControlled: 'Owner holds designer account, approves brief/commercial rights, publishes, handles revisions and payout.',
    countryRestrictions: 'Platform-dependent; 18+, tax info.',
    apiAutomationAvailability: 'Generation APIs available (Stability, Replicate, Runway, Adobe) but contest submission APIs not permitted for bots.',
    accountRequirements: 'Designer portfolio account (real identity, 18+), payout method.',
    expectedCosts: 'Generation cost $0.10-2 per asset + platform fees.',
    fraudRisks: 'Stock/IP infringement, fake portfolio, ToS for automated contest entries – blocked by manual publishing gate.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Stability AI','Replicate','Runway','Canva','Adobe','Figma via Browserless'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:4, accessibility:3, scalability:2, setupRequirements:3, operatingCost:3},
    representativePlatforms: [
      {name:'99designs', officialUrl:'https://99designs.com/help', evidence:'Official: contest payouts, designer fees 5-15% (99designs.com)'},
    ]
  }),
  score({
    key: 'writing_translation',
    label: 'Writing / Translation (original drafts, human-edited)',
    earningMechanism: 'Client pays for original article, copy, or translation where AI draft assistance is disclosed and permitted.',
    agentWork: 'Agent drafts via OpenAI/Claude/Gemini/OpenRouter, checks via knowledge_search; translation via permitted MT where allowed; human edits and fact-checks.',
    customerSource: 'Direct client or freelance platform (Smartcat, Gengo, Translated, Upwork) with disclosure.',
    usdPaymentMechanism: 'Escrow or direct invoice.',
    payoutMethodAndSettlementEvidence: 'Payout-verification + receiving rail; same net USD gate.',
    autonomousPermitted: true,
    autonomousNote: 'Drafting is permitted where contract allows AI assistance; final publication and client communication remain human-reviewed.',
    humanControlled: 'Owner verifies language pair competence, disclosure, publishing permission, and invoice.',
    countryRestrictions: '18+, payout country per platform; translation agencies often require native-speaker verification.',
    apiAutomationAvailability: 'LLM APIs fully available; translation platform APIs owner-gated.',
    accountRequirements: 'Freelance or agency account (real identity) if via marketplace.',
    expectedCosts: 'LLM inference $0.01-0.30 per 1k tokens; platform fees 5-20%.',
    fraudRisks: 'Plagiarism, hallucinated facts, undisclosed AI – blocked by fact-check + human approval.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['OpenAI','Anthropic Claude','Google Gemini','OpenRouter','Tavily','Brave Search'],
    ranking: {genuinePaidWork:4, automationPermission:4, usdVerifiability:4, accessibility:5, scalability:4, setupRequirements:5, operatingCost:5},
    representativePlatforms: [
      {name:'Gengo', officialUrl:'https://gengo.com/translators/', evidence:'Official: translator payouts via PayPal/Payoneer (gengo.com)'},
    ]
  }),
  score({
    key: 'seo_marketing',
    label: 'SEO / Marketing (audits, content strategy, no ranking guarantees)',
    earningMechanism: 'Client pays for SEO audit, content plan, or analytics setup (no guaranteed rankings).',
    agentWork: 'Agent performs offline HTML checks, keyword research via Tavily/Brave, builds Excel reports, drafts strategy docs; no fake backlinks/reviews.',
    customerSource: 'Direct client with site ownership proof and explicit request.',
    usdPaymentMechanism: 'Direct invoice or marketplace.',
    payoutMethodAndSettlementEvidence: 'Stripe/PayPal → payout-verification.',
    autonomousPermitted: true,
    autonomousNote: 'Research/audit automation permitted; outreach/link-building and publishing are human-controlled and consent-gated.',
    humanControlled: 'Owner verifies site ownership, approves outreach templates (no bulk spam), reviews recommendations.',
    countryRestrictions: 'Agnostic; outreach must respect CAN-SPAM/GDPR.',
    apiAutomationAvailability: 'Search APIs (Tavily/Brave) + HubSpot/Mailchimp/Klaviyo APIs where explicitly configured; no bulk messaging without consent.',
    accountRequirements: 'None for audit; marketing platform access via vault if client grants.',
    expectedCosts: 'Search + LLM cost; marketing platform fees pass-through.',
    fraudRisks: 'Fake SEO guarantees, spam, ToS violation – blocked by prohibition list + no bulk messaging default.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Tavily','Brave Search','Google Custom Search','HubSpot','Mailchimp','Klaviyo','Excel Build'],
    ranking: {genuinePaidWork:4, automationPermission:4, usdVerifiability:3, accessibility:4, scalability:3, setupRequirements:4, operatingCost:4},
    representativePlatforms: [
      {name:'HubSpot', officialUrl:'https://legal.hubspot.com/terms-of-service', evidence:'Official: service terms, payment via Stripe (hubspot.com)'},
    ]
  }),
  score({
    key: 'virtual_assistance',
    label: 'Virtual Assistance (admin, scheduling, data entry for permitted data)',
    earningMechanism: 'Client pays for admin support on their systems/data with explicit permission.',
    agentWork: 'Agent organizes data, drafts emails (Gmail/SendGrid gated), manages sheets (Google Sheets) where scoped; no unsolicited outreach.',
    customerSource: 'Direct client or marketplace (Belay, Time Etc, Upwork) – must be explicit contract.',
    usdPaymentMechanism: 'Hourly/fixed via marketplace or direct.',
    payoutMethodAndSettlementEvidence: 'Marketplace payout → verified.',
    autonomousPermitted: false,
    autonomousNote: 'Requires persistent access to client systems; autonomous mailbox/calendar automation is high-risk and owner-gated per platform ToS.',
    humanControlled: 'Owner holds credentials (vault), approves every external send, reviews data handling.',
    countryRestrictions: 'Varies; often US/EU clients require timezone overlap.',
    apiAutomationAvailability: 'Gmail/Google Drive/Sheets/Microsoft Graph/Slack APIs available but require explicit OAuth + approval queue.',
    accountRequirements: 'Client-provided scoped access; NDA where required.',
    expectedCosts: 'Platform fees + tool costs; higher human oversight cost.',
    fraudRisks: 'Unauthorized access, data exfiltration – blocked by vault + approval + secret scan.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['Gmail','Google Drive','Google Sheets','Microsoft Graph','Slack','Discord','SendGrid','Resend'],
    ranking: {genuinePaidWork:4, automationPermission:1, usdVerifiability:4, accessibility:2, scalability:2, setupRequirements:2, operatingCost:3},
    representativePlatforms: [
      {name:'Belay', officialUrl:'https://belaysolutions.com/', evidence:'Directory: VA services, US-based (belaysolutions.com)'},
    ]
  }),
  score({
    key: 'customer_support',
    label: 'Customer Support (for client’s own customers, with consent)',
    earningMechanism: 'Client pays for support handling on their channels (Zendesk-like via Slack/Discord/HubSpot).',
    agentWork: 'Agent drafts responses from knowledge base, triages via policy; human sends.',
    customerSource: 'Client with existing customer base and explicit support delegation.',
    usdPaymentMechanism: 'Retainer or per-ticket via marketplace/direct.',
    payoutMethodAndSettlementEvidence: 'Same verified chain — HubSpot/Salesforce payout via bank, verified before treasury.',
    autonomousPermitted: false,
    autonomousNote: 'Auto-reply without human review risks impersonation/ToS breach; draft-then-human-send only.',
    humanControlled: 'Owner approves knowledge base, response templates, and every outbound message.',
    countryRestrictions: 'Language/timezone dependent.',
    apiAutomationAvailability: 'HubSpot/Salesforce/Zoho/Pipedrive APIs available owner-gated.',
    accountRequirements: 'Client support system access via vault.',
    expectedCosts: 'LLM + platform fees.',
    fraudRisks: 'Impersonation, hallucinated policy – blocked by human-send gate.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['HubSpot','Salesforce','Zoho','Pipedrive','Slack','Discord','SendGrid'],
    ranking: {genuinePaidWork:4, automationPermission:1, usdVerifiability:4, accessibility:2, scalability:2, setupRequirements:2, operatingCost:3},
    representativePlatforms: [
      {name:'HubSpot Service Hub', officialUrl:'https://legal.hubspot.com/terms-of-service', evidence:'Official: service terms (hubspot.com)'},
    ]
  }),
  score({
    key: 'tutoring_education',
    label: 'Tutoring / Education (original course/content, not impersonating tutor)',
    earningMechanism: 'Learner pays for course, template, or 1:1 tutoring where qualified human delivers; agent may produce materials.',
    agentWork: 'Agent builds curriculum, quizzes, Excel templates, docs; tutoring session itself is human-delivered.',
    customerSource: 'Marketplace (Preply, Wyzant, Udemy, Teachable) or direct with learner consent.',
    usdPaymentMechanism: 'Marketplace payout or direct via Stripe.',
    payoutMethodAndSettlementEvidence: 'Platform payout (Udemy revenue share 37-97%, Preply via PayPal/Payoneer); verified before cash.',
    autonomousPermitted: false,
    autonomousNote: 'Content generation permitted; live tutoring/credentialed teaching requires qualified human and cannot be automated.',
    humanControlled: 'Owner verifies qualifications, publishes course (manual), handles learner data, receives payout.',
    countryRestrictions: 'Tutoring platforms often US/EU, 18+, background check; course platforms global but payout country-limited.',
    apiAutomationAvailability: 'No tutoring API; content via Docs/Sheets/YouTube.',
    accountRequirements: 'Instructor account (real identity, 18+, tax, payout).',
    expectedCosts: 'Platform revenue share 3-63% + payout fees.',
    fraudRisks: 'Unlicensed advice, credential misrepresentation – blocked by prohibition list.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['YouTube','Google Docs','Google Sheets','Stripe','PayPal'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:4, accessibility:3, scalability:3, setupRequirements:3, operatingCost:3},
    representativePlatforms: [
      {name:'Preply', officialUrl:'https://preply.com/en/question/how-do-tutors-get-paid-40260', evidence:'Official: tutor payouts via PayPal/Payoneer (preply.com)'},
      {name:'Udemy', officialUrl:'https://support.udemy.com/hc/en-us/articles/229604988', evidence:'Official: revenue share 37% default, 97% via instructor promo (udemy.com)'},
    ]
  }),
  score({
    key: 'affiliate_referral',
    label: 'Affiliate / Referral (real traffic, no fake engagement)',
    earningMechanism: 'Merchant pays commission on referred sale (Amazon Associates, Awin/ShareASale, Impact, ClickBank).',
    agentWork: 'Agent creates original content/demos, SEO research, disclosure; no purchased traffic/reviews; link issuance is human.',
    customerSource: 'Organic audience or client site with disclosure and consent.',
    usdPaymentMechanism: 'Affiliate network payout (ACH/SEPA/PayPal/Wise).',
    payoutMethodAndSettlementEvidence: 'Network statement → bank credit; Amazon fee schedule 0-10%, Awin via SEPA/BACS/ACH; verified before cash.',
    autonomousPermitted: false,
    autonomousNote: 'Content creation may be automated, but program enrollment, link issuance, and traffic generation require owner identity and manual disclosure; fake engagement is prohibited.',
    humanControlled: 'Owner enrolls (real identity, website/social), discloses, places links manually, handles tax.',
    countryRestrictions: 'Amazon 22 storefronts; Awin global but payout via Payoneer for many countries; 18+. ',
    apiAutomationAvailability: 'Awin/Amazon Product Advertising APIs available but require approved enrollment; no auto-traffic.',
    accountRequirements: 'Approved affiliate account (website/social + tax).',
    expectedCosts: 'Content + hosting; network fees none; payout minima $10-100.',
    fraudRisks: 'Fake clicks, cookie stuffing, purchased followers – compiled deny-list blocks.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['WordPress','Webflow','Wix','Squarespace','Shopify','YouTube','Mailchimp','HubSpot'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:5, accessibility:3, scalability:5, setupRequirements:2, operatingCost:4},
    representativePlatforms: [
      {name:'Amazon Associates', officialUrl:'https://affiliate-program.amazon.com/help/node/topic/GRXPHT8U84RAYDXZ', evidence:'Official fee schedule 0-10% (amazon.com, 2026-09-19)'},
      {name:'Awin', officialUrl:'https://www.awin.com/us/publishers', evidence:'Official: 1M+ publishers, payouts SEPA/ACH/Payoneer (awin.com, 2026-09-19)'},
    ]
  }),
  score({
    key: 'digital_products',
    label: 'Digital Products (original templates/tools/courses)',
    earningMechanism: 'Buyer pays for original digital good (Gumroad, Lemon Squeezy, Sellfy, Etsy digital, Shopify).',
    agentWork: 'Agent builds template/validator/tool, writes docs, prepares listing copy; owner lists manually.',
    customerSource: 'Marketplace discover or owner audience; no self-purchases.',
    usdPaymentMechanism: 'Merchant of record payout (Stripe/PayPal).',
    payoutMethodAndSettlementEvidence: 'Gumroad/Lemon Squeezy payout after fees (Gumroad 10% + Stripe); bank credit verified.',
    autonomousPermitted: false,
    autonomousNote: 'Product preparation may be automated, but IP clearance, listing, and support are human.',
    humanControlled: 'Owner verifies IP, lists manually (Gumroad Discover requires actual sales + review), handles refunds/support.',
    countryRestrictions: 'Gumroad supports 90+ countries via Stripe/PayPal; 18+, tax.',
    apiAutomationAvailability: 'Gumroad/Lemon Squeezy APIs exist but auto-listing without review is disallowed.',
    accountRequirements: 'Merchant account (18+, tax, payout).',
    expectedCosts: 'Fees 3.5-10% + processing; no inventory.',
    fraudRisks: 'Copied IP, self-purchase – blocked by manual listing + audit.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Gumroad via Stripe','Shopify','WooCommerce','Etsy','Canva','Adobe','Stripe','PayPal'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:4, accessibility:3, scalability:4, setupRequirements:3, operatingCost:4},
    representativePlatforms: [
      {name:'Gumroad', officialUrl:'https://gumroad.com/help/article/13-getting-paid', evidence:'Official: payouts via PayPal/bank, fees 10% (gumroad.com)'},
      {name:'Lemon Squeezy', officialUrl:'https://docs.lemonsqueezy.com/help/getting-started/payouts', evidence:'Official: payouts via Stripe Connect (lemonsqueezy.com)'},
    ]
  }),
  score({
    key: 'creator_monetization',
    label: 'Creator Monetization (ads, memberships, tips)',
    earningMechanism: 'Platform pays for ad share, memberships, tips (YouTube Partner Program, TikTok Rewards, Patreon, Ko-fi).',
    agentWork: 'Agent assists with research, scripting, editing drafts (ElevenLabs/Stability/Runway); human publishes and owns channel.',
    customerSource: 'Platform audience; must meet eligibility (1k subs + 4k hrs for YPP).',
    usdPaymentMechanism: 'AdSense/Platform payout (USD).',
    payoutMethodAndSettlementEvidence: 'AdSense for YouTube, TikTok via PayPal/bank; threshold $100 (YouTube); verified before cash.',
    autonomousPermitted: false,
    autonomousNote: 'Content assistance permitted, but channel ownership, publishing, and monetization enrollment require human identity and manual review; fake engagement prohibited.',
    humanControlled: 'Owner owns channel, passes YPP review (18+, AdSense), publishes, handles disclosure.',
    countryRestrictions: 'YPP not in Russia for ads; 18+ for paid features; TikTok Rewards limited countries.',
    apiAutomationAvailability: 'YouTube Data API exists but auto-publishing without human review violates ToS.',
    accountRequirements: 'Channel + AdSense + 18+ + policy review.',
    expectedCosts: 'Production costs; platform cut 30-45%.',
    fraudRisks: 'Fake views/subs, impersonation – deny-list blocks.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['YouTube','TikTok','Instagram','X','ElevenLabs','Stability AI','Replicate','Runway'],
    ranking: {genuinePaidWork:4, automationPermission:1, usdVerifiability:5, accessibility:2, scalability:5, setupRequirements:1, operatingCost:3},
    representativePlatforms: [
      {name:'YouTube Partner Program', officialUrl:'https://support.google.com/youtube/answer/72857', evidence:'Official: 1k subs + 4k hrs, AdSense (support.google.com, 2026-09-19)'},
    ]
  }),
  score({
    key: 'ecommerce_services',
    label: 'E-commerce / Services (physical/dropship/print-on-demand)',
    earningMechanism: 'Buyer pays for physical good fulfilled via Shopify/WooCommerce/Amazon/Etsy/Walmart.',
    agentWork: 'Agent helps with listing copy, inventory sheet, supplier research via Firecrawl/Apify where permitted; no fake reviews.',
    customerSource: 'Store traffic / marketplace buyer.',
    usdPaymentMechanism: 'Shopify Payments/Stripe/PayPal → payout.',
    payoutMethodAndSettlementEvidence: 'Shopify payout 2-3 days via bank; verified before cash.',
    autonomousPermitted: false,
    autonomousNote: 'Listing assistance permitted, but store ownership, supplier contracts, fulfillment, and customer service are human.',
    humanControlled: 'Owner owns store, handles KYC, taxes, returns, supplier agreements, payout account.',
    countryRestrictions: 'Shopify Payments 20+ countries; 18+, business verification.',
    apiAutomationAvailability: 'Shopify Admin API available owner-gated; product creation requires approval.',
    accountRequirements: 'Store + business verification + payout bank.',
    expectedCosts: 'Shopify $39/mo + fees 2.9% + fulfillment/inventory.',
    fraudRisks: 'Dropship IP/quality issues, fake reviews – blocked.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['Shopify','WooCommerce','Amazon','eBay','Etsy','Walmart','Stripe','PayPal','Wise'],
    ranking: {genuinePaidWork:5, automationPermission:1, usdVerifiability:5, accessibility:2, scalability:3, setupRequirements:1, operatingCost:2},
    representativePlatforms: [
      {name:'Shopify', officialUrl:'https://help.shopify.com/en/manual/payments/shopify-payments/onboarding', evidence:'Official: Shopify Payments onboarding (help.shopify.com)'},
    ]
  }),
  score({
    key: 'app_marketplaces',
    label: 'App / Software Marketplaces (Shopify App, Atlassian, WordPress, Chrome)',
    earningMechanism: 'Merchant pays for app subscription/purchase; platform revenue share.',
    agentWork: 'Agent codes app, writes docs, prepares listing; human submits for review.',
    customerSource: 'Marketplace buyer/developer ecosystem.',
    usdPaymentMechanism: 'Platform payout (Shopify 80/20, Atlassian 85/15, etc).',
    payoutMethodAndSettlementEvidence: 'Platform payout via PayPal/bank; verified.',
    autonomousPermitted: false,
    autonomousNote: 'Code assistance permitted, but marketplace review, publishing, and support are human.',
    humanControlled: 'Owner holds developer account, signs agreements, submits, handles support/payout.',
    countryRestrictions: 'Developer program 18+, payout country-limited, tax forms.',
    apiAutomationAvailability: 'Store APIs for app management owner-gated.',
    accountRequirements: 'Developer account ($5-99 fee), payout, tax, app review.',
    expectedCosts: 'Developer fee + platform share 15-30% + hosting.',
    fraudRisks: 'IP violation, fake reviews – blocked.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Shopify','WordPress','GitHub','AWS','Cloudflare','Stripe'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:4, accessibility:2, scalability:4, setupRequirements:1, operatingCost:3},
    representativePlatforms: [
      {name:'Shopify App Store', officialUrl:'https://shopify.dev/docs/apps/launch/app-store-review', evidence:'Official: app review, revenue share (shopify.dev)'},
    ]
  }),
  score({
    key: 'bug_bounties',
    label: 'Bug Bounties / Security (permitted programs only)',
    earningMechanism: 'Program pays for valid vulnerability report (HackerOne, Bugcrowd, YesWeHack, Intigriti).',
    agentWork: 'Agent performs scoped static analysis, reproduces with owner-authorized target, drafts report; no unauthorized testing.',
    customerSource: 'Official program with explicit scope and authorization.',
    usdPaymentMechanism: 'Platform bounty payout (USD) via PayPal/bank.',
    payoutMethodAndSettlementEvidence: 'HackerOne/Bugcrowd payout statement + bank credit; verified before cash.',
    autonomousPermitted: true,
    autonomousNote: 'Permitted ONLY on in-scope, authorized targets with explicit permission; disclosure and submission are human-controlled.',
    humanControlled: 'Owner verifies scope/authorization, approves target, submits report manually, handles payout/KYC, coordinates disclosure.',
    countryRestrictions: '18+, not sanctioned countries, tax forms, KYC via platform.',
    apiAutomationAvailability: 'HackerOne/Bugcrowd APIs for program info owner-gated; no automated scanning of out-of-scope.',
    accountRequirements: 'Researcher account (real identity, 18+, KYC for payouts).',
    expectedCosts: 'Tool compute only; no fees; bounty $50-10k+ variable, not guaranteed.',
    fraudRisks: 'Out-of-scope testing, ToS violation, non-disclosure breach – blocked by explicit authorization gate.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['GitHub','GitLab','Browserless','Sentry','Datadog'],
    ranking: {genuinePaidWork:5, automationPermission:3, usdVerifiability:5, accessibility:2, scalability:2, setupRequirements:3, operatingCost:5},
    representativePlatforms: [
      {name:'HackerOne', officialUrl:'https://docs.hackerone.com/programs/philosophy', evidence:'Official: program terms, bounty payouts (docs.hackerone.com)'},
      {name:'Bugcrowd', officialUrl:'https://www.bugcrowd.com/resource/what-is-bug-bounty/', evidence:'Official: bounty payouts (bugcrowd.com)'},
    ]
  }),
  score({
    key: 'paid_apis_data',
    label: 'Paid APIs / Data / Research Programs (data licensing)',
    earningMechanism: 'Consumer pays for API/data access you provide (RapidAPI, AWS Data Exchange, Nasdaq Data Link).',
    agentWork: 'Agent builds data pipeline, validates dataset, writes docs; owner publishes dataset/API.',
    customerSource: 'Data marketplace buyer with legitimate use case.',
    usdPaymentMechanism: 'Marketplace payout (RapidAPI 80% etc).',
    payoutMethodAndSettlementEvidence: 'Marketplace payout → bank; verified.',
    autonomousPermitted: false,
    autonomousNote: 'Building pipeline may be automated, but data licensing, publishing, and compliance are human.',
    humanControlled: 'Owner verifies data rights, licenses, publishes, handles support/payout.',
    countryRestrictions: 'Provider-dependent; often global.',
    apiAutomationAvailability: 'RapidAPI/AWS Data Exchange APIs owner-gated.',
    accountRequirements: 'Publisher account, payout, tax, data rights proof.',
    expectedCosts: 'Hosting + marketplace fees 20%.',
    fraudRisks: 'Unlicensed data, privacy violation – blocked by data-rights review.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['AWS','Neon','Supabase','PostgreSQL','Stripe'],
    ranking: {genuinePaidWork:4, automationPermission:2, usdVerifiability:4, accessibility:2, scalability:3, setupRequirements:2, operatingCost:3},
    representativePlatforms: [
      {name:'RapidAPI', officialUrl:'https://rapidapi.com/developer/billing', evidence:'Official: provider payouts 80% (rapidapi.com)'},
    ]
  }),
  score({
    key: 'open_source_sponsorship',
    label: 'Open-Source Sponsorship / Rewards',
    earningMechanism: 'Sponsor pays recurring or one-time for maintained open-source project (GitHub Sponsors, Open Collective, Polar).',
    agentWork: 'Agent contributes code/docs, maintains repo via GitHub; sponsorship itself is human relationship.',
    customerSource: 'Sponsor who values project; not automated solicitation.',
    usdPaymentMechanism: 'GitHub Sponsors payout via Stripe Connect (USD).',
    payoutMethodAndSettlementEvidence: 'GitHub Sponsors payout statement + Stripe bank credit; verified.',
    autonomousPermitted: false,
    autonomousNote: 'Code work may be automated, but sponsorship solicitation and sponsor relationship are human; no fake stars.',
    humanControlled: 'Owner owns repo, builds reputation, enrolls in Sponsors (KYC), engages sponsors.',
    countryRestrictions: 'GitHub Sponsors 30+ regions, Stripe Connect country, 18+.',
    apiAutomationAvailability: 'GitHub Sponsors API read-only; no auto-solicitation.',
    accountRequirements: 'GitHub + Sponsors enrollment, Stripe, tax.',
    expectedCosts: 'Platform fees 0-10%; no guarantee of sponsors.',
    fraudRisks: 'Fake engagement, purchased stars – deny-list blocks.',
    exclusivelyAssignable: false,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['GitHub','Stripe','Open Collective'],
    ranking: {genuinePaidWork:4, automationPermission:1, usdVerifiability:5, accessibility:2, scalability:2, setupRequirements:3, operatingCost:5},
    representativePlatforms: [
      {name:'GitHub Sponsors', officialUrl:'https://docs.github.com/en/sponsors', evidence:'Official: payout via Stripe Connect (docs.github.com)'},
    ]
  }),
  score({
    key: 'contests_challenges',
    label: 'Contests / Challenges (legitimate cash prizes)',
    earningMechanism: 'Organizer pays cash prize for winning submission (Kaggle, Topcoder, Devpost, InnoCentive, XPRIZE).',
    agentWork: 'Agent builds model/code, prepares submission docs where AI assistance is allowed; human submits.',
    customerSource: 'Contest organizer with published rules and prize pool.',
    usdPaymentMechanism: 'Prize payout via bank/PayPal.',
    payoutMethodAndSettlementEvidence: 'Organizer prize statement + bank credit; verified; prize not guaranteed.',
    autonomousPermitted: true,
    autonomousNote: 'Permitted where rules allow AI assistance; submission and team identity are human-controlled.',
    humanControlled: 'Owner verifies eligibility, rules on AI use, submits, handles KYC/tax for prize.',
    countryRestrictions: 'Varies by contest; often excludes sanctioned countries; 18+.',
    apiAutomationAvailability: 'Kaggle API for datasets, Hugging Face for models – competition submission often manual.',
    accountRequirements: 'Contest account (real identity).',
    expectedCosts: 'Compute (Modal/GPU) + data costs; prize highly variable.',
    fraudRisks: 'Plagiarism, undisclosed AI where prohibited – blocked by rules check.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'candidate',
    integrations: ['Hugging Face','Replicate','Kaggle via API','GitHub','Modal','Neon'],
    ranking: {genuinePaidWork:4, automationPermission:3, usdVerifiability:4, accessibility:3, scalability:2, setupRequirements:3, operatingCost:2},
    representativePlatforms: [
      {name:'Kaggle Competitions', officialUrl:'https://www.kaggle.com/competitions', evidence:'Official: competitions, prize pools $10k-100k (kaggle.com)'},
    ]
  }),
  score({
    key: 'microtasks_labeling',
    label: 'Microtasks / Data Labeling (where legally available)',
    earningMechanism: 'Requester pays per task for labeling/categorization (MTurk, Appen, Scale Rapid, Toloka, Clickworker).',
    agentWork: 'Agent may assist with tooling, but task completion itself is typically human-only per ToS; autonomous labeling risks fraud and account ban.',
    customerSource: 'Platform requester.',
    usdPaymentMechanism: 'Platform payout (MTurk Amazon Payments, Appen via Payoneer).',
    payoutMethodAndSettlementEvidence: 'Platform statement + bank; verified.',
    autonomousPermitted: false,
    autonomousNote: 'Most microtask ToS require human worker and forbid automation/bots; autonomous completion would violate ToS – therefore NOT permitted autonomously.',
    humanControlled: 'Human must complete tasks; owner verifies eligibility, handles account/KYC.',
    countryRestrictions: 'MTurk mostly US/UK; Appen global but 18+ and qualification tests.',
    apiAutomationAvailability: 'MTurk Requester API exists but Worker automation is prohibited.',
    accountRequirements: 'Worker account (real identity, 18+, tax, sometimes qualification).',
    expectedCosts: 'Low fee; payout minima $10.',
    fraudRisks: 'Automation = ToS violation, ban – compiled prohibition blocks.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['AWS (MTurk)'],
    ranking: {genuinePaidWork:3, automationPermission:1, usdVerifiability:4, accessibility:2, scalability:2, setupRequirements:3, operatingCost:4},
    representativePlatforms: [
      {name:'Amazon Mechanical Turk', officialUrl:'https://www.mturk.com/worker', evidence:'Official: worker payouts (mturk.com)'},
    ]
  }),
  score({
    key: 'lead_gen_fulfillment',
    label: 'Business Lead-Gen / Service Fulfillment (consent-gated)',
    earningMechanism: 'Business pays for qualified leads or fulfillment where outreach had explicit consent.',
    agentWork: 'Agent researches public business info via Apollo/Clearbit where permitted, drafts outreach for human review; no bulk spam.',
    customerSource: 'Business client with opted-in or publicly consented contacts only.',
    usdPaymentMechanism: 'Retainer or per-lead via direct invoice.',
    payoutMethodAndSettlementEvidence: 'Stripe/bank → verified.',
    autonomousPermitted: false,
    autonomousNote: 'Research assistance may be automated, but outreach requires owner-approved template and explicit consent; bulk automated outreach is prohibited.',
    humanControlled: 'Owner approves every outreach, verifies consent, handles CRM access via vault.',
    countryRestrictions: 'GDPR/CAN-SPAM/CASL apply; region-dependent.',
    apiAutomationAvailability: 'Apollo, HubSpot, Salesforce APIs available owner-gated but bulk send without consent blocked.',
    accountRequirements: 'CRM access via vault, suppression list.',
    expectedCosts: 'API costs + CRM fees.',
    fraudRisks: 'Spam, scraping prohibited sources, ToS violation – blocked by suppression + no-bulk default.',
    exclusivelyAssignable: true,
    paymentVerifiable: true,
    status: 'restricted',
    integrations: ['HubSpot','Salesforce','Zoho','Pipedrive','Apollo','Clearbit','SendGrid','Resend'],
    ranking: {genuinePaidWork:4, automationPermission:1, usdVerifiability:3, accessibility:2, scalability:3, setupRequirements:2, operatingCost:3},
    representativePlatforms: [
      {name:'Apollo', officialUrl:'https://www.apollo.io/terms', evidence:'Official: terms, requires consent (apollo.io)'},
    ]
  }),
];

export function rankedOpportunities(): OpportunityClass[] {
  return [...OPPORTUNITY_REGISTRY].sort((a,b)=> b.overallScore - a.overallScore || a.key.localeCompare(b.key));
}

export function permittedAutonomousClasses(): OpportunityClass[] {
  return OPPORTUNITY_REGISTRY.filter(o=> o.autonomousPermitted && o.paymentVerifiable && o.status!=='restricted');
}

export function requiresOwnerSetup(o: OpportunityClass): string[] {
  const reasons: string[] = [];
  if(!o.autonomousPermitted) reasons.push('human-controlled per ToS');
  if(o.status==='restricted') reasons.push('restricted: additional owner setup / payout integration required');
  if(o.status==='candidate') reasons.push('candidate: needs official re-check + owner enrollment before assignment');
  if(!o.paymentVerifiable) reasons.push('payout not independently verifiable');
  return reasons;
}

export function infrastructureFor(key: string): string[] {
  return OPPORTUNITY_REGISTRY.find(o=>o.key===key)?.integrations ?? [];
}
