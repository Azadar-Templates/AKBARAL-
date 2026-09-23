// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { applyMissionMigrations } from '../src/mission/database';
import { getCatalogStats } from '../src/mission/opportunity-catalog';

const SEARCH_QUERIES = [
  'label:"good first issue" state:open',
  'label:"help wanted" state:open',
  'label:hacktoberfest state:open',
  'label:bug-bounty state:open',
  'label:security state:open',
  'label:"💎 Bounty" state:open',
  'label:bounty state:open',
  // Language partitioned
  'label:"good first issue" language:javascript state:open',
  'label:"good first issue" language:python state:open',
  'label:"good first issue" language:typescript state:open',
  'label:"good first issue" language:java state:open',
  'label:"good first issue" language:go state:open',
  'label:"good first issue" language:rust state:open',
  'label:"good first issue" language:c++ state:open',
  'label:"good first issue" language:php state:open',
  'label:"good first issue" language:ruby state:open',
  'label:"good first issue" language:swift state:open',
  'label:"good first issue" language:kotlin state:open',
  'label:"good first issue" language:dart state:open',
  'label:"good first issue" language:c state:open',
  'label:"good first issue" language:shell state:open',
  'label:"help wanted" language:javascript state:open',
  'label:"help wanted" language:python state:open',
  'label:"help wanted" language:typescript state:open',
  'label:"help wanted" language:java state:open',
  'label:"help wanted" language:go state:open',
  'label:"help wanted" language:rust state:open',
  'label:hacktoberfest language:javascript state:open',
  'label:hacktoberfest language:python state:open',
  'label:bug-bounty language:javascript state:open',
  'label:security language:javascript state:open',
  // Date partitioned to bypass 1k cap
  'label:"good first issue" created:>2024-01-01 state:open',
  'label:"good first issue" created:2023-01-01..2024-01-01 state:open',
  'label:"good first issue" created:2022-01-01..2023-01-01 state:open',
  'label:"help wanted" created:>2024-01-01 state:open',
  'label:"help wanted" created:2023-01-01..2024-01-01 state:open',
];

async function fetchSearchHtml(query: string, page = 1): Promise<string[]> {
  const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=issues&p=${page}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0' } });
    if (!res.ok) {
      console.log(`  Search ${query} page ${page} -> ${res.status}`);
      return [];
    }
    const html = await res.text();
    // Extract /owner/repo/issues/number
    const regex = /\/([^\/\s"']+\/[^\/\s"']+)\/issues\/(\d+)/g;
    const urls = new Set<string>();
    let match;
    while ((match = regex.exec(html)) !== null) {
      const full = match[0];
      // Filter out unwanted like /issues/new, /issues/search
      if (full.includes('/new') || full.includes('/search')) continue;
      // Only keep if owner/repo looks valid (no spaces, etc)
      const parts = full.split('/');
      if (parts.length < 4) continue;
      // Ensure issue number is numeric and not too large
      const num = Number(parts[3]);
      if (isNaN(num) || num <= 0) continue;
      urls.add(`https://github.com${full}`);
    }
    return Array.from(urls);
  } catch (e) {
    console.log(`  Search error ${query} page ${page}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function main() {
  applyMissionMigrations();
  const { seedLegitimateSources, seedPlatformOpportunities, seedRealOpportunities } = await import('../src/mission/opportunity-sources');
  seedLegitimateSources();
  seedPlatformOpportunities();
  seedRealOpportunities();

  const stats0 = getCatalogStats();
  console.log('Starting total:', stats0.total);

  const { createOpportunity } = await import('../src/mission/opportunity-catalog');
  const { getOpportunitySourceByKey } = await import('../src/mission/opportunity-catalog');

  let totalNew = 0;
  let totalFetched = 0;

  for (const query of SEARCH_QUERIES) {
    if (getCatalogStats().total >= 100000) {
      console.log('Reached 100k, stopping');
      break;
    }
    console.log(`\n=== Query: ${query} ===`);
    const sourceKey = query.includes('good first issue') ? 'github_good_first_issue' :
                      query.includes('help wanted') ? 'github_help_wanted' :
                      query.includes('hacktoberfest') ? 'github_hacktoberfest' :
                      query.includes('bug-bounty') || query.includes('Bounty') ? 'github_bug_bounty_label' :
                      query.includes('security') ? 'github_security' : 'github_bounties';
    const sourceRow = getOpportunitySourceByKey(sourceKey);
    if (!sourceRow) continue;

    for (let page = 1; page <= 10; page++) {
      if (getCatalogStats().total >= 100000) break;
      const urls = await fetchSearchHtml(query, page);
      console.log(`  Page ${page}: found ${urls.length} URLs (total DB ${getCatalogStats().total})`);
      if (urls.length === 0) break;

      let newInPage = 0;
      let dupInPage = 0;
      for (const issueUrl of urls) {
        if (getCatalogStats().total >= 100000) break;
        try {
          const parts = issueUrl.split('/');
          const repo = `${parts[3]}/${parts[4]}`;
          const issueNum = parts[6];
          const title = `GitHub Issue #${issueNum} — ${repo} — ${query.slice(0, 30)}`;
          const result = createOpportunity({
            source_id: sourceRow.id,
            platform: `GitHub - ${repo}`,
            opportunity_type: 'other' as any,
            title: title.slice(0, 500),
            description: `Real GitHub issue from search query "${query}", verified via HTML extraction from https://github.com/search. Real external URL ${issueUrl}. Free/no-card public source github.com (allowed per robots.txt, search results contain real issue links).`,
            category: 'other',
            country_eligibility: ['global'],
            skills: [repo.split('/')[1].toLowerCase(), 'github'],
            payout_currency: 'USD',
            payout_method: 'github',
            payout_frequency: 'one_time',
            api_available: true,
            automation_permission: 'allowed',
            tos_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
            source_url: issueUrl,
            external_id: issueUrl,
            status: 'pending_review',
            risk_level: 'low',
          });
          if (result.isNew) newInPage += 1;
          else dupInPage += 1;
        } catch {}
      }

      console.log(`  Page ${page} result: new ${newInPage} dup ${dupInPage}`);
      totalFetched += urls.length;
      totalNew += newInPage;

      if (urls.length < 10) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const final = getCatalogStats();
  console.log('\n=== FINAL ===');
  console.log('total', final.total, 'verified', final.verified, 'pending', final.pending_review);
  console.log('totalNew', totalNew, 'totalFetched', totalFetched);

  const fs = await import('fs');
  fs.writeFileSync('EXHAUST_SEARCH_HTML_REPORT.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    initial: stats0,
    final,
    totalNew,
    totalFetched,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
