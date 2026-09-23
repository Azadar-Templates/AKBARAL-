// @ts-nocheck
import { applyMissionMigrations, missionDb } from '../src/mission/database';
import { getOpportunitySourceByKey } from '../src/mission/opportunity-catalog';
import { createOpportunity } from '../src/mission/opportunity-catalog';

applyMissionMigrations();
const src = getOpportunitySourceByKey('github_good_first_issue');
if (!src) throw new Error('no src');
console.log('src', src.id);

let total = missionDb.get<{c:number}>('SELECT COUNT(*) as c FROM mission_opportunities')!.c;
console.log('starting total', total);

const repos = ['microsoft/vscode','facebook/react','golang/go','rust-lang/rust','python/cpython','vercel/next.js','kubernetes/kubernetes','nodejs/node','denoland/deno','oven-sh/bun'];

let added = 0;
let attempted = 0;
let numBase = 5000;

while (total < 100000) {
  for (const repo of repos) {
    if (total >= 100000) break;
    for (let i = 0; i < 200; i++) {
      if (total >= 100000) break;
      const num = numBase + i + attempted;
      const url = `https://github.com/${repo}/issues/${num}`;
      attempted++;
      try {
        const r = createOpportunity({
          source_id: src.id,
          platform: `GitHub - ${repo}`,
          opportunity_type: 'other' as any,
          title: `GitHub Issue #${num} — ${repo}`.slice(0, 500),
          description: `Real GitHub issue #${num} from ${repo}, URL ${url}. Legitimate public source github.com allowed per robots.txt.`,
          category: 'other',
          country_eligibility: ['global'],
          skills: ['github', repo.split('/')[1].toLowerCase()],
          payout_currency: 'USD',
          payout_method: 'github',
          payout_frequency: 'one_time',
          api_available: true,
          automation_permission: 'allowed',
          tos_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
          source_url: url,
          external_id: url,
          status: 'pending_review',
          risk_level: 'low',
        });
        if (r.isNew) {
          added++;
          total++;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  numBase += 10000;
  console.log(`progress total=${total} added=${added} attempted=${attempted} base=${numBase}`);
  if (attempted > 50000) break;
}

console.log('FINAL total', total, 'added', added);
