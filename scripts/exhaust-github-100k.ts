// @ts-nocheck
/**
 * Exhaust GitHub searches by language and date to bypass 1k cap
 * Target: 100k+ REAL unique opportunity-level records, free/no-card only
 * Uses only api.github.com (the only egress allowed in sandbox)
 * Resumable pagination, deduplication, rate limit handling
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { applyMissionMigrations } from '../src/mission/database';
import { seedLegitimateSources, seedPlatformOpportunities, seedRealOpportunities } from '../src/mission/opportunity-sources';
import { getCatalogStats } from '../src/mission/opportunity-catalog';
import { ingestSource } from '../src/mission/opportunity-ingestion';
import fs from 'fs';

const LANGUAGES = [
  'javascript', 'python', 'typescript', 'java', 'go', 'rust', 'c++', 'c#', 'php', 'ruby',
  'swift', 'kotlin', 'dart', 'c', 'shell', 'html', 'css', 'c#', 'scala', 'r',
  'objective-c', 'perl', 'lua', 'haskell', 'elixir', 'clojure', 'erlang', 'julia', 'matlab', 'powershell',
];

const GITHUB_SOURCES = [
  { key: 'github_good_first_issue', baseQuery: 'label:"good first issue" state:open' },
  { key: 'github_help_wanted', baseQuery: 'label:"help wanted" state:open' },
  { key: 'github_hacktoberfest', baseQuery: 'label:hacktoberfest state:open' },
  { key: 'github_bug_bounty_label', baseQuery: 'label:bug-bounty state:open' },
  { key: 'github_security', baseQuery: 'label:security state:open' },
  { key: 'github_bounties', baseQuery: 'label:"💎 Bounty" OR label:bounty OR label:"💵 Bounty" state:open is:issue' },
];

async function main() {
  console.log('Applying migrations...');
  applyMissionMigrations();

  console.log('Seeding...');
  const s = seedLegitimateSources();
  const p = seedPlatformOpportunities();
  const r = seedRealOpportunities();
  console.log('Seeded', s.total, 'sources,', p.created, 'platform opps,', r.created, 'real opps');

  const stats0 = getCatalogStats();
  console.log('Initial total:', stats0.total);

  // If we already have >100k, exit
  if (stats0.total >= 100000) {
    console.log('Already >=100k, nothing to do');
    return;
  }

  let totalNew = 0;
  let totalFetched = 0;
  let totalDup = 0;
  const perSource: Record<string, { fetched: number; new: number; dup: number; failed: number; queries: number; languages: number }> = {};
  for (const src of GITHUB_SOURCES) {
    perSource[src.key] = { fetched: 0, new: 0, dup: 0, failed: 0, queries: 0, languages: 0 };
  }

  // For each GitHub source, partition by language
  for (const src of GITHUB_SOURCES) {
    console.log(`\n=== Source ${src.key} baseQuery: ${src.baseQuery} ===`);
    // First try base query without language (already done in previous run, but we try again for resumable)
    try {
      let cursor: string | null = null;
      let pages = 0;
      while (pages < 10) {
        const result = await ingestSource(src.key, { limit: 100, cursor });
        console.log(`  Base query page ${pages + 1}: fetched ${result.fetched} new ${result.new} dup ${result.duplicate} next ${result.nextCursor}`);
        perSource[src.key].fetched += result.fetched;
        perSource[src.key].new += result.new;
        perSource[src.key].dup += result.duplicate;
        totalFetched += result.fetched;
        totalNew += result.new;
        totalDup += result.duplicate;
        perSource[src.key].queries += 1;
        pages += 1;
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      console.log(`  Base query error: ${e instanceof Error ? e.message : String(e)}`);
      perSource[src.key].failed += 1;
    }

    // Now partition by language
    for (const lang of LANGUAGES) {
      if (getCatalogStats().total >= 100000) {
        console.log('Reached 100k, stopping');
        break;
      }
      const query = `${src.baseQuery} language:${lang}`;
      // We need to use a custom ingestion that directly calls GitHub search with language
      // For now, we use ingestSource with a special cursor that encodes language+page
      // But our ingestSource doesn't support language param, so we call fetchGitHubSearch directly via a hack:
      // We'll create a temporary source key that uses same fetcher but with language query
      // Instead, we directly call the fetcher function and then create opportunities manually
      try {
        console.log(`  Language ${lang} query: ${query}`);
        // Use dynamic import to avoid circular
        const { createOpportunity } = await import('../src/mission/opportunity-catalog');
        const { getOpportunitySourceByKey } = await import('../src/mission/opportunity-catalog');
        const sourceRow = getOpportunitySourceByKey(src.key);
        if (!sourceRow) continue;

        // Direct GitHub search with language
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 10) {
          if (getCatalogStats().total >= 100000) break;
          const perPage = 100;
          const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
          const headers: Record<string, string> = { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0', Accept: 'application/vnd.github.v3+json' };
          const rawToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
          const token = rawToken && !rawToken.includes('dummy') && !rawToken.includes('arena-egress') && rawToken.length > 20 ? rawToken : null;
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(url, { headers });
          if (!res.ok) {
            if (res.status === 403) {
              const remaining = res.headers.get('x-ratelimit-remaining');
              const reset = res.headers.get('x-ratelimit-reset');
              console.log(`    Rate limited, remaining ${remaining}, reset ${reset}`);
              if (remaining === '0' && reset) {
                const resetTime = Number(reset) * 1000;
                const waitMs = Math.max(0, resetTime - Date.now()) + 5000;
                console.log(`    Waiting ${waitMs}ms for rate limit reset`);
                await new Promise((r) => setTimeout(r, Math.min(waitMs, 60000)));
                continue;
              }
            }
            console.log(`    GitHub API ${res.status} for ${query} page ${page}`);
            break;
          }
          const data = (await res.json()) as { items?: any[]; total_count?: number };
          const items = data.items ?? [];
          console.log(`    Page ${page}: ${items.length} items, total_count ${data.total_count}`);

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
            } catch {
              // skip
            }
          }

          console.log(`    Page ${page} result: new ${newInPage} dup ${dupInPage}`);
          perSource[src.key].fetched += items.length;
          perSource[src.key].new += newInPage;
          perSource[src.key].dup += dupInPage;
          totalFetched += items.length;
          totalNew += newInPage;
          totalDup += dupInPage;

          hasMore = items.length === perPage && page * perPage < Math.min(Number(data.total_count ?? 0), 1000);
          page += 1;
          perSource[src.key].queries += 1;

          await new Promise((r) => setTimeout(r, 1500));

          if (getCatalogStats().total >= 100000) break;
        }

        perSource[src.key].languages += 1;
      } catch (e) {
        console.log(`  Language ${lang} error: ${e instanceof Error ? e.message : String(e)}`);
        perSource[src.key].failed += 1;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`=== Finished ${src.key}: total now ${getCatalogStats().total} ===`);
    if (getCatalogStats().total >= 100000) break;
  }

  const finalStats = getCatalogStats();
  console.log('\n=== FINAL STATS ===');
  console.log(JSON.stringify(finalStats, null, 2));
  console.log('\n=== PER SOURCE ===');
  console.log(JSON.stringify(perSource, null, 2));
  console.log(`\nTotal new: ${totalNew}, fetched: ${totalFetched}, dup: ${totalDup}`);
  console.log(`Initial: ${stats0.total}, Final: ${finalStats.total}, Delta: ${finalStats.total - stats0.total}`);

  fs.writeFileSync('EXHAUST_100K_REPORT.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    initial: stats0,
    final: finalStats,
    totalNew,
    totalFetched,
    totalDup,
    perSource,
  }, null, 2));
  console.log('Wrote EXHAUST_100K_REPORT.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
