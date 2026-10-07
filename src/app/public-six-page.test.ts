import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const publicSources = [
  'src/app/_components/public-site-chrome.tsx',
  'src/app/_components/public-pricing.tsx',
  'src/app/_components/landing-reset.tsx',
  'src/app/(public)/public-info.tsx',
  'src/app/(public)/team/page.tsx',
  'src/app/(public)/blog/page.tsx',
  'src/app/pricing/page.tsx',
].map(read).join('\n');
const navOrder = ['Home', 'About Us', 'Pricing', 'Our Team', 'Blogs', 'Contact Us'];

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('the six public routes exist and share the six-entry nav contract', () => {
  for (const route of ['about', 'pricing', 'team', 'blog', 'contact']) {
    assert.ok(existsSync(path.join(root, 'src/app', route === 'pricing' ? 'pricing/page.tsx' : `(public)/${route}/page.tsx`)), `${route} route exists`);
  }
  let previous = -1;
  for (const label of navOrder) {
    const position = publicSources.indexOf(`label: '${label}'`);
    assert.ok(position > previous, `${label} follows the required nav order`);
    previous = position;
  }
  assert.match(publicSources, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(publicSources, /aria-label=\{open \? 'Close public navigation' : 'Open public navigation'\}/);
  assert.match(publicSources, /event\.key === 'Escape'/);
});

test('pricing is one exact six-plan source shared by /pricing and the landing anchor', () => {
  const pricing = read('src/app/_lib/pricing.ts');
  for (const entry of [
    "name: 'Free', price: '$0', tasks: '5 tasks', note: '30-day trial'",
    "name: 'Starter', price: '$10', tasks: '25 tasks'",
    "name: 'Pro', price: '$50', tasks: '100 tasks'",
    "name: 'Business', price: '$90', tasks: '250 tasks'",
    "name: 'Scale', price: '$200', tasks: '750 tasks'",
    "name: 'Enterprise', price: '$400', tasks: '2,000 tasks'",
  ]) assert.ok(pricing.includes(entry), `${entry} remains exact`);
  assert.match(read('src/app/pricing/page.tsx'), /PublicPricingTable/);
  assert.match(read('src/app/_components/landing-reset.tsx'), /<PublicPricingTable/);
  assert.match(read('src/app/_components/landing-reset.tsx'), /id="pricing"/);
});

test('team and blog are honest when no verified records or repository posts exist', () => {
  const team = read('src/app/(public)/team/page.tsx');
  const blog = read('src/app/(public)/blog/page.tsx');
  assert.match(team, /Team information coming soon/);
  assert.match(blog, /No published posts yet/);
  assert.match(blog, /Subscribe/);
  assert.match(read('src/app/_lib/public-published-content.ts'), /content', 'blog/);
  assert.doesNotMatch(publicSources, /fake|fabricated|testimonial|trusted by/i);
});

test('public copy uses registered-agent-contract wording and never exposes the private mission identifier', () => {
  assert.match(publicSources, /4,001 registered agent contracts/);
  assert.doesNotMatch(publicSources, /4,001[^.]{0,180}\b(?:all active|active|earning)\b/i);
  assert.doesNotMatch(publicSources, /ZA141251SA/);
  assert.doesNotMatch(read('src/routes/public.ts'), /ZA141251SA/);
});

test('public sources and built public entries contain no reference-site brand strings', () => {
  const forbiddenReferenceBrands = ['Webflow', 'Wix', 'Squarespace', 'Framer', 'WordPress', 'Shopify', 'Salesforce', 'HubSpot', 'Notion', 'Slack', 'Canva', 'Figma'];
  for (const brand of forbiddenReferenceBrands) assert.doesNotMatch(publicSources, new RegExp(`\\b${brand}\\b`, 'i'), `${brand} is absent from public source`);
  const buildFiles = [...filesUnder(path.join(root, '.next', 'server', 'app')), ...filesUnder(path.join(root, '.next', 'static'))].filter((file) => /\.js$/.test(file));
  for (const file of buildFiles) {
    const source = readFileSync(file, 'utf8');
    for (const brand of forbiddenReferenceBrands) assert.doesNotMatch(source, new RegExp(`\\b${brand}\\b`, 'i'), `${brand} is absent from ${file}`);
  }
});
