import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const landing = read('src/app/_components/landing-reset.tsx');
const landingCss = read('src/app/_components/landing-reset.module.css');
const pricing = read('src/app/_lib/pricing.ts');
const publicPage = read('src/app/page.tsx');

describe('AKBARAL! landing reset contract', () => {
  it('uses the exact identity, tagline and honest calls to action', () => {
    assert.match(landing, /AKBARAL!/);
    assert.match(landing, /One Intelligence\. Every Solution\./);
    assert.match(landing, /Start free/);
    assert.match(landing, /Go to your workspace/);
    assert.match(landing, /See plans and pricing/);
    assert.match(landing, /Sign in/);
    assert.doesNotMatch(landing, /AKBARAL AI/);
  });

  it('follows the required section flow', () => {
    const order = ['topbar', 'hero', 'Product interface overview', 'Quick paths', 'features-title', 'integrations-title', 'thread-title', 'agents-title', 'security-title', 'steps-title', 'faq-title', 'final-title', 'footer'];
    let previous = -1;
    for (const marker of order) {
      const index = landing.indexOf(marker);
      assert.ok(index > previous, `${marker} appears in order`);
      previous = index;
    }
  });

  it('publishes the six exact USD prices and Work quotas unchanged', () => {
    for (const value of [
      "name: 'Free', price: '$0', tasks: '5 tasks', note: '30-day trial'",
      "name: 'Starter', price: '$10', tasks: '25 tasks'",
      "name: 'Pro', price: '$50', tasks: '100 tasks'",
      "name: 'Business', price: '$90', tasks: '250 tasks'",
      "name: 'Scale', price: '$200', tasks: '750 tasks'",
      "name: 'Enterprise', price: '$400', tasks: '2,000 tasks'",
    ]) assert.ok(pricing.includes(value), `missing plan: ${value}`);
    assert.match(pricing, /All prices are USD/);
  });

  it('describes 4,001 agents truthfully as registered contracts', () => {
    assert.match(landing, /4,001 registered agent contracts/);
    assert.match(landing, /never describes them as active or earning/);
    assert.doesNotMatch(landing, /4,001 active|4,001 earning/i);
  });

  it('enforces accessible target sizes and responsive no-overflow composition', () => {
    assert.match(landingCss, /min-height:42px/);
    assert.match(landingCss, /overflow-x:hidden/);
    assert.match(landingCss, /@media\(max-width:880px\)/);
    assert.match(landingCss, /@media\(max-width:560px\)/);
    assert.match(landingCss, /grid-template-columns:1fr/);
  });

  it('uses dashboard theme tokens without introducing new hex colors', () => {
    assert.doesNotMatch(landingCss, /#[0-9a-f]{3,8}\b/i);
    for (const token of ['--bg-deep', '--bg', '--text', '--text-2', '--text-dim', '--accent', '--accent-bright']) {
      assert.ok(landingCss.includes(`var(${token})`), `landing must consume ${token}`);
    }
  });

  it('keeps public sources free of forbidden reference strings and private identifiers', () => {
    const publicSources = [landing, landingCss, publicPage, pricing].join('\n');
    assert.doesNotMatch(publicSources, /Atlas|WorkOS|Slack|use\.ai|ChatGPT/i);
    assert.doesNotMatch(publicSources, /ZA141251SA/);
  });
});
