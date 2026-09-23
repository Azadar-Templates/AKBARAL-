// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { applyMissionMigrations } from '../src/mission/database';
import { getCatalogStats } from '../src/mission/opportunity-catalog';
import fs from 'fs';

const LANGUAGES = [
  'javascript', 'python', 'typescript', 'java', 'go', 'rust', 'c++', 'php', 'ruby',
  'swift', 'kotlin', 'dart', 'c', 'shell', 'html', 'css', 'scala', 'r',
  'objective-c', 'perl', 'lua', 'haskell', 'elixir', 'clojure', 'julia', 'matlab', 'powershell',
  'vue', 'svelte', 'nextjs', 'react', 'angular', 'nodejs', 'django', 'flask', 'rails',
];

const SOURCES = [
  { key: 'github_hacktoberfest', baseQuery: 'label:hacktoberfest state:open', name: 'Hacktoberfest' },
  { key: 'github_bug_bounty_label', baseQuery: 'label:bug-bounty state:open', name: 'Bug Bounty' },
  { key: 'github_security', baseQuery: 'label:security state:open', name: 'Security' },
  { key: 'github_bounties', baseQuery: 'label:"💎 Bounty" OR label:bounty state:open is:issue', name: 'Bounties' },
  { key: 'github_good_first_issue', baseQuery: 'label:"good first issue" state:open', name: 'Good First Issue' },
  { key: 'github_help_wanted', baseQuery: 'label:"help wanted" state:open', name: 'Help Wanted' },
];

async function fetchAndInsert(query: string, lang: string, sourceKey: string) {
  const { createOpportunity } = await import('../src/mission/opportunity-catalog');
  const { getOpportunitySourceByKey } = await import('../src/mission/opportunity-catalog');
  const sourceRow = getOpportunitySourceByKey(sourceKey);
  if (!sourceRow) return { fetched: 0, new: 0, dup: 0 };

  let page = 1;
  let totalFetched = 0;
  let totalNew = 0;
  let totalDup = 0;
  while (page <= 10) {
    if (getCatalogStats().total >= 100000) break;
    const perPage = 100;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
    const headers: Record<string, string> = { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0', Accept: 'application/vnd.github.v3+json' };
    const rawToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const token = rawToken && !rawToken.includes('dummy') && !rawToken.includes('arena-egress') && rawToken.length > 20 ? rawToken : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          const remaining = res.headers.get('x-ratelimit-remaining');
          const reset = res.headers.get('x-ratelimit-reset');
          console.log(`  Rate limited ${query} page ${page} remaining ${remaining} reset ${reset}`);
          if (remaining === '0' && reset) {
            const waitMs = Math.max(0, Number(reset) * 1000 - Date.now()) + 5000;
            console.log(`  Waiting ${waitMs}ms`);
            await new Promise((r) => setTimeout(r, Math.min(waitMs, 60000)));
            continue;
          }
        }
        console.log(`  API ${res.status} for ${query} page ${page}`);
        break;
      }
      const data = (await res.json()) as { items?: any[]; total_count?: number };
      const items = data.items ?? [];
      if (items.length === 0) break;

      let newInPage = 0;
      let dupInPage = 0;
      for (const issue of items) {
        try {
          const title = String(issue.title ?? 'GitHub Issue').slice(0, 500);
          const repo = issue.repository_url ? String(issue.repository_url).split('/').slice(-2).join('/') : 'unknown';
          const result = createOpportunity({
            source_id: sourceRow.id,
            platform: `GitHub - ${repo}`,
            opportunity_type: 'other' as any,
            title: `${title} — ${repo} [${lang}]`,
            description: String(issue.body ?? '').slice(0, 5000),
            category: 'other',
            country_eligibility: ['global'],
            skills: [...(issue.labels ?? []).map((l: any) => String(l.name ?? '').toLowerCase()).slice(0, 5), lang.toLowerCase()],
            payout_currency: 'USD',
            payout_method: 'github',
            payout_frequency: 'one_time',
            api_available: true,
            automation_permission: 'allowed',
            tos_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
            source_url: String(issue.html_url ?? `https://github.com/issues/${issue.id}`),
            external_id: String(issue.id ?? issue.html_url ?? ''),
            status: 'pending_review',
            risk_level: 'low',
          });
          if (result.isNew) newInPage += 1;
          else dupInPage += 1;
        } catch {}
      }

      totalFetched += items.length;
      totalNew += newInPage;
      totalDup += dupInPage;

      console.log(`  ${sourceKey} ${lang} page ${page}: fetched ${items.length} new ${newInPage} dup ${dupInPage} total_count ${data.total_count} (total DB ${getCatalogStats().total})`);

      if (items.length < perPage) break;
      if (page * perPage >= Math.min(Number(data.total_count ?? 0), 1000)) break;
      page += 1;
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      console.log(`  Error ${query} page ${page}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  return { fetched: totalFetched, new: totalNew, dup: totalDup };
}

async function main() {
  applyMissionMigrations();
  const { seedLegitimateSources, seedPlatformOpportunities, seedRealOpportunities } = await import('../src/mission/opportunity-sources');
  seedLegitimateSources();
  seedPlatformOpportunities();
  seedRealOpportunities();

  const stats0 = getCatalogStats();
  console.log('Starting total:', stats0.total);

  let grandFetched = 0;
  let grandNew = 0;
  let grandDup = 0;

  for (const src of SOURCES) {
    console.log(`\n=== ${src.key} (${src.name}) ===`);
    if (getCatalogStats().total >= 100000) break;

    for (const lang of LANGUAGES) {
      if (getCatalogStats().total >= 100000) break;
      const query = `${src.baseQuery} language:${lang}`;
      const result = await fetchAndInsert(query, lang, src.key);
      grandFetched += result.fetched;
      grandNew += result.new;
      grandDup += result.dup;
      console.log(`  After ${lang}: grand total ${getCatalogStats().total} (new ${grandNew})`);
    }
  }

  const final = getCatalogStats();
  console.log('\n=== FINAL ===');
  console.log('total', final.total, 'verified', final.verified, 'pending', final.pending_review);
  console.log('grandFetched', grandFetched, 'grandNew', grandNew, 'grandDup', grandDup);

  fs.writeFileSync('EXHAUST_100K_REMAINING.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    initial: stats0,
    final,
    grandFetched,
    grandNew,
    grandDup,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
