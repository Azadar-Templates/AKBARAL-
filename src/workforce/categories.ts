/**
 * WORKFORCE CATEGORIES — the legitimate earning models the 4,000+ agent
 * workforce may pursue. Every category is:
 *   · lawful and platform-terms compliant by construction (no fake engagement,
 *     no KYC bypass, no impersonation — those live on the compiled deny-list);
 *   · mapped to registry domains (for multi-category agent matching) and to
 *     the mission's allowed-activity allow-list (for the policy gate);
 *   · discovered through the secure SSRF-guarded search layer only.
 *
 * An agent is NEVER restricted to one category: eligibility is computed from
 * registry capabilities + tools + owner grants, so every agent can work across
 * many applicable categories when opportunities exist.
 */

export interface WorkforceCategory {
  key: string;
  label: string;
  /** Discovery queries (first N used per sweep; all legitimate research queries). */
  queries: string[];
  defaultRevenueCents: number;
  defaultCostCents: number;
  defaultTimeHours: number;
  defaultProbability: number;
  defaultRisk: 'low' | 'medium' | 'high';
  /** Registry domain slugs whose specialists are a natural fit (matching hint, not a restriction). */
  registryDomains: string[];
  /** Mission allowed-activity key for the policy gate. */
  missionActivity: string;
  /** Tool keys the work typically needs (must be individually permitted + configured). */
  typicalTools: string[];
  /** Env/provider that must exist before real execution (honest prerequisite). */
  requiresProvider: string;
}

export const WORKFORCE_CATEGORIES: WorkforceCategory[] = [
  {
    key: 'freelance', label: 'Freelancing',
    queries: ['freelance web development projects open for proposals', 'freelance writing gigs accepting new freelancers'],
    defaultRevenueCents: 45_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.15, defaultRisk: 'medium',
    registryDomains: ['software-engineering', 'web-development', 'writing', 'copywriting', 'graphic-design', 'data-analysis'],
    missionActivity: 'consulting', typicalTools: ['web_search', 'page_fetch', 'knowledge_search'],
    requiresProvider: 'none for research; platform account (owner-created) before bidding/submission',
  },
  {
    key: 'software_services', label: 'Software & services',
    queries: ['small business custom software development demand', 'API integration services for businesses pricing'],
    defaultRevenueCents: 60_000, defaultCostCents: 300, defaultTimeHours: 12, defaultProbability: 0.1, defaultRisk: 'medium',
    registryDomains: ['software-engineering', 'web-development', 'mobile-development', 'api-engineering', 'devops'],
    missionActivity: 'software_development', typicalTools: ['web_search', 'code_repository_read', 'knowledge_search'],
    requiresProvider: 'none for scoping; owner-approved repo/hosting before delivery',
  },
  {
    key: 'saas', label: 'SaaS',
    queries: ['micro SaaS ideas validated demand', 'indie SaaS pricing benchmarks small teams'],
    defaultRevenueCents: 50_000, defaultCostCents: 300, defaultTimeHours: 20, defaultProbability: 0.06, defaultRisk: 'high',
    registryDomains: ['software-engineering', 'product-management', 'ai-economy', 'marketing'],
    missionActivity: 'software_development', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'hosting + payment provider (Stripe) connected by owner before charging users',
  },
  {
    key: 'digital_products', label: 'Digital products',
    queries: ['digital product marketplace listing fees comparison', 'selling templates online platforms'],
    defaultRevenueCents: 12_000, defaultCostCents: 80, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'low',
    registryDomains: ['writing', 'graphic-design', 'education', 'excel-spreadsheet', 'documents'],
    missionActivity: 'marketplace_products', typicalTools: ['web_search', 'knowledge_search', 'excel_build'],
    requiresProvider: 'marketplace seller account (owner-created) before listing',
  },
  {
    key: 'content_creation', label: 'Content creation',
    queries: ['content writing services demand pricing', 'newsletter content packages for businesses'],
    defaultRevenueCents: 15_000, defaultCostCents: 100, defaultTimeHours: 8, defaultProbability: 0.1, defaultRisk: 'low',
    registryDomains: ['writing', 'copywriting', 'seo', 'search-content-strategy', 'social-media'],
    missionActivity: 'content_production', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'none for production; publishing needs platform account + owner approval',
  },
  {
    key: 'youtube', label: 'YouTube',
    queries: ['YouTube channel niches with high CPM 2026', 'YouTube partner program requirements'],
    defaultRevenueCents: 20_000, defaultCostCents: 150, defaultTimeHours: 10, defaultProbability: 0.08, defaultRisk: 'medium',
    registryDomains: ['youtube', 'video', 'short-form-video', 'marketing'],
    missionActivity: 'content_publishing', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'YouTube channel OAuth (YOUTUBE_ACCESS_TOKEN) + owner approval before publish',
  },
  {
    key: 'tiktok', label: 'TikTok',
    queries: ['TikTok creator monetization requirements 2026', 'short-form video niches brand deals'],
    defaultRevenueCents: 10_000, defaultCostCents: 100, defaultTimeHours: 8, defaultProbability: 0.07, defaultRisk: 'medium',
    registryDomains: ['tiktok', 'short-form-video', 'social-media', 'video'],
    missionActivity: 'content_publishing', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'TikTok account activation + owner approval before publish',
  },
  {
    key: 'affiliate', label: 'Affiliate marketing',
    queries: ['affiliate programs legitimate high commission', 'software affiliate programs terms'],
    defaultRevenueCents: 8_000, defaultCostCents: 50, defaultTimeHours: 3, defaultProbability: 0.15, defaultRisk: 'low',
    registryDomains: ['marketing', 'seo', 'social-media', 'writing'],
    missionActivity: 'affiliate_programs', typicalTools: ['web_search', 'page_fetch', 'knowledge_search'],
    requiresProvider: 'affiliate program enrollment (owner-approved, real identity) before link issuance',
  },
  {
    key: 'ecommerce', label: 'E-commerce',
    queries: ['print on demand vs dropshipping fees 2026', 'Shopify store setup costs small catalog'],
    defaultRevenueCents: 25_000, defaultCostCents: 250, defaultTimeHours: 10, defaultProbability: 0.08, defaultRisk: 'medium',
    registryDomains: ['e-commerce', 'marketing', 'branding', 'customer-support'],
    missionActivity: 'marketplace_products', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'Shopify/store credentials (SHOPIFY_STORE_DOMAIN + SHOPIFY_ACCESS_TOKEN) before listing',
  },
  {
    key: 'lead_generation', label: 'Lead generation',
    queries: ['B2B lead generation services demand', 'appointment setting services market'],
    defaultRevenueCents: 35_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.1, defaultRisk: 'medium',
    registryDomains: ['sales', 'crm', 'marketing', 'business-strategy'],
    missionActivity: 'lead_generation', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'none for research; outreach needs consent + owner-approved template (no bulk spam)',
  },
  {
    key: 'advertising', label: 'Advertising / revenue platforms',
    queries: ['niche site ad revenue benchmarks 2026', 'newsletter sponsorship rates by niche'],
    defaultRevenueCents: 18_000, defaultCostCents: 150, defaultTimeHours: 8, defaultProbability: 0.07, defaultRisk: 'medium',
    registryDomains: ['advertising', 'marketing', 'seo', 'business-analytics'],
    missionActivity: 'marketing_services', typicalTools: ['web_search', 'knowledge_search', 'excel_build'],
    requiresProvider: 'ad/sponsor platform account (owner-created) before monetization',
  },
  {
    key: 'licensing', label: 'Licensing',
    queries: ['stock photo licensing royalties contributors', 'licensing digital templates terms'],
    defaultRevenueCents: 9_000, defaultCostCents: 60, defaultTimeHours: 5, defaultProbability: 0.1, defaultRisk: 'low',
    registryDomains: ['graphic-design', 'image-generation', 'music', 'writing', 'video'],
    missionActivity: 'marketplace_products', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'licensing marketplace account (owner-created) before submission',
  },
  {
    key: 'b2b_services', label: 'B2B services',
    queries: ['fractional operations services for startups demand', 'B2B research services outsourcing demand'],
    defaultRevenueCents: 40_000, defaultCostCents: 200, defaultTimeHours: 8, defaultProbability: 0.1, defaultRisk: 'medium',
    registryDomains: ['business-strategy', 'enterprise-operations', 'project-management', 'research', 'automation'],
    missionActivity: 'consulting', typicalTools: ['web_search', 'knowledge_search', 'excel_build'],
    requiresProvider: 'none for scoping; engagement needs owner-approved agreement before work starts',
  },
  {
    key: 'marketplaces', label: 'Marketplaces',
    queries: ['freelance marketplace seller fees comparison 2026', 'service marketplace onboarding requirements'],
    defaultRevenueCents: 22_000, defaultCostCents: 150, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'medium',
    registryDomains: ['marketplace', 'e-commerce', 'sales', 'customer-support'],
    missionActivity: 'marketplace_products', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'marketplace seller account (owner-created, real identity) before listing',
  },
  {
    key: 'education', label: 'Education products',
    queries: ['online course platforms revenue share comparison', 'corporate training content demand'],
    defaultRevenueCents: 20_000, defaultCostCents: 120, defaultTimeHours: 10, defaultProbability: 0.09, defaultRisk: 'low',
    registryDomains: ['education', 'tutoring', 'writing', 'video'],
    missionActivity: 'education_content', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'course platform account (owner-created) before publishing',
  },
  {
    key: 'apps', label: 'Apps / software products',
    queries: ['indie mobile app monetization benchmarks', 'desktop utility software market gaps'],
    defaultRevenueCents: 30_000, defaultCostCents: 250, defaultTimeHours: 16, defaultProbability: 0.06, defaultRisk: 'high',
    registryDomains: ['mobile-development', 'software-engineering', 'ui-ux', 'product-management'],
    missionActivity: 'software_development', typicalTools: ['web_search', 'code_repository_read', 'knowledge_search'],
    requiresProvider: 'app-store / hosting accounts (owner-created) before distribution',
  },
  {
    key: 'seo', label: 'SEO services',
    queries: ['SEO consulting demand small business', 'technical SEO audit services pricing'],
    defaultRevenueCents: 30_000, defaultCostCents: 100, defaultTimeHours: 5, defaultProbability: 0.12, defaultRisk: 'low',
    registryDomains: ['seo', 'search-content-strategy', 'marketing', 'writing'],
    missionActivity: 'marketing_services', typicalTools: ['web_search', 'page_fetch', 'knowledge_search'],
    requiresProvider: 'none for audits; site access granted by the client before implementation',
  },
  {
    key: 'automation', label: 'Automation services',
    queries: ['business process automation consulting demand', 'workflow automation services pricing'],
    defaultRevenueCents: 38_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'medium',
    registryDomains: ['automation', 'workflow-automation', 'integrations', 'devops'],
    missionActivity: 'automation_services', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'client system access (scoped, owner-approved) before implementation',
  },
  {
    key: 'research', label: 'Research & data services',
    queries: ['market research services outsourcing demand', 'data cleanup services for businesses pricing'],
    defaultRevenueCents: 25_000, defaultCostCents: 100, defaultTimeHours: 5, defaultProbability: 0.15, defaultRisk: 'low',
    registryDomains: ['research', 'data-analysis', 'data-science', 'business-analytics'],
    missionActivity: 'research_and_analysis', typicalTools: ['web_search', 'page_fetch', 'knowledge_search', 'excel_build'],
    requiresProvider: 'none for research deliverables',
  },
  {
    key: 'design', label: 'Design services',
    queries: ['brand identity packages pricing small business', 'pitch deck design services demand'],
    defaultRevenueCents: 28_000, defaultCostCents: 120, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'low',
    registryDomains: ['graphic-design', 'branding', 'ui-ux', 'image-generation'],
    missionActivity: 'design_services', typicalTools: ['web_search', 'knowledge_search'],
    requiresProvider: 'none for design deliverables; asset licensing checked per brief',
  },
  {
    key: 'support', label: 'Support services',
    queries: ['outsourced customer support pricing startups', 'knowledge base setup services demand'],
    defaultRevenueCents: 24_000, defaultCostCents: 150, defaultTimeHours: 8, defaultProbability: 0.12, defaultRisk: 'low',
    registryDomains: ['customer-support', 'crm', 'knowledge-management'],
    missionActivity: 'support_services', typicalTools: ['knowledge_search', 'web_search'],
    requiresProvider: 'client helpdesk access (scoped, owner-approved) before live support',
  },
];

export function findWorkforceCategory(key: string): WorkforceCategory | undefined {
  return WORKFORCE_CATEGORIES.find((c) => c.key === key);
}

export function workforceCategoryKeys(): string[] {
  return WORKFORCE_CATEGORIES.map((c) => c.key);
}
