// @ts-nocheck
/**
 * Exhaust free/no-card public APIs — GitHub-based sources that work in sandbox
 * Prioritizes opportunity-level records, deduplicates, resumable queues
 */

import { applyMissionMigrations } from '../src/mission/database';
import { seedLegitimateSources, seedPlatformOpportunities, seedRealOpportunities } from '../src/mission/opportunity-sources';
import { getCatalogStats } from '../src/mission/opportunity-catalog';
import { ingestSource } from '../src/mission/opportunity-ingestion';

async function main() {
  console.log('Applying migrations...');
  applyMissionMigrations();

  console.log('Seeding sources...');
  const s = seedLegitimateSources();
  console.log('Sources seeded:', s);
  const p = seedPlatformOpportunities();
  console.log('Platform opportunities seeded:', p);
  const r = seedRealOpportunities();
  console.log('Real opportunities seeded:', r);

  const stats0 = getCatalogStats();
  console.log('Initial stats:', { total: stats0.total, verified: stats0.verified, sourcesTotal: stats0.sourcesTotal });

  // Free/no-card sources that work via api.github.com (the only egress allowed in sandbox)
  // These are genuinely free, no paid subscription, no card
  const freeGitHubSources = [
    'github_bounties',
    'github_good_first_issue',
    'github_help_wanted',
    'github_hacktoberfest',
    'github_bug_bounty_label',
    'github_security',
  ];

  // Also try other free sources that may work in production (will fail in sandbox but we try)
  const otherFreeSources = [
    'remotive',
    'arbeitnow',
    'jobicy',
    'remoteok',
    'himalayas',
    'themuse',
    'remotejobs_org',
    'working_nomads',
    'hacker_news_jobs',
    'reddit_forhire',
    'reddit_remotejobs',
    'lobsters_jobs',
    'topcoder',
    'devpost',
    'challenge_gov',
    'grants_gov',
    'greenhouse',
    'lever',
    'ashby',
  ];

  const allFree = [...freeGitHubSources, ...otherFreeSources];

  let totalNew = 0;
  let totalFetched = 0;
  const perSource: Record<string, { fetched: number; new: number; duplicate: number; failed: number; pages: number; exhausted: boolean; lastError?: string }> = {};

  for (const sourceKey of allFree) {
    console.log(`\n=== Ingesting ${sourceKey} ===`);
    perSource[sourceKey] = { fetched: 0, new: 0, duplicate: 0, failed: 0, pages: 0, exhausted: false };
    let cursor: string | null = null;
    let pages = 0;
    const maxPages = sourceKey.startsWith('github_') ? 10 : 5; // GitHub search caps at 1000 results (10 pages × 100), others 5 pages
    const limit = sourceKey.startsWith('github_') ? 100 : 50;

    while (pages < maxPages) {
      try {
        console.log(`  Page ${pages + 1}, cursor=${cursor ?? 'none'}, limit=${limit}`);
        const result = await ingestSource(sourceKey, { limit, cursor });
        console.log(`  -> fetched ${result.fetched}, new ${result.new}, dup ${result.duplicate}, failed ${result.failed}, nextCursor=${result.nextCursor ?? 'none'}`);
        perSource[sourceKey].fetched += result.fetched;
        perSource[sourceKey].new += result.new;
        perSource[sourceKey].duplicate += result.duplicate;
        perSource[sourceKey].failed += result.failed;
        perSource[sourceKey].pages += 1;
        totalFetched += result.fetched;
        totalNew += result.new;

        pages += 1;

        if (!result.nextCursor) {
          console.log(`  Exhausted ${sourceKey} after ${pages} pages`);
          perSource[sourceKey].exhausted = true;
          break;
        }
        cursor = result.nextCursor;

        // Small delay to respect rate limits
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ERROR ingesting ${sourceKey} page ${pages + 1}: ${msg}`);
        perSource[sourceKey].lastError = msg.slice(0, 500);
        perSource[sourceKey].failed += 1;
        // If rate limited, break and try next source
        if (msg.toLowerCase().includes('rate limited') || msg.includes('403') || msg.includes('429')) {
          console.log(`  Rate limited on ${sourceKey}, moving to next source`);
          break;
        }
        // For other errors (e.g., egress blocked), break
        if (msg.includes('fetch failed') || msg.includes('SSL_ERROR') || msg.includes('000') || msg.includes('ENOTFOUND') || msg.includes('ECONN')) {
          console.log(`  Network/egress blocked for ${sourceKey}, skipping`);
          break;
        }
        pages += 1;
        if (pages >= maxPages) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  const finalStats = getCatalogStats();
  console.log('\n=== FINAL STATS ===');
  console.log(JSON.stringify(finalStats, null, 2));
  console.log('\n=== PER SOURCE ===');
  console.log(JSON.stringify(perSource, null, 2));
  console.log(`\nTotal new records added in this run: ${totalNew}`);
  console.log(`Total fetched: ${totalFetched}`);
  console.log(`Initial total: ${stats0.total}, Final total: ${finalStats.total}, Delta: ${finalStats.total - stats0.total}`);

  // Write report
  const fs = await import('fs');
  const report = {
    timestamp: new Date().toISOString(),
    initial: stats0,
    final: finalStats,
    totalNew,
    totalFetched,
    perSource,
    freeSourcesAttempted: allFree.length,
    githubSourcesExhausted: freeGitHubSources.filter((k) => perSource[k]?.exhausted).length,
    blockedSources: Object.entries(perSource).filter(([_, v]) => v.lastError).map(([k, v]) => ({ key: k, error: v.lastError })),
  };
  fs.writeFileSync('EXHAUST_REPORT.json', JSON.stringify(report, null, 2));
  console.log('Wrote EXHAUST_REPORT.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
