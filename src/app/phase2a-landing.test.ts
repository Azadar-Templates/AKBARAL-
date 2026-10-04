import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const landing = read('src/app/_components/landing/cinematic-landing.tsx');
const landingCss = read('src/app/_components/landing/cinematic-landing.module.css');
const publicPage = read('src/app/page.tsx');
const tokens = JSON.parse(read('design-system/tokens.json')) as { palette: Record<string, Record<string, string>> };
const packageJson = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

describe('ChatGPT-style landing contract', () => {
  it('uses the exact public identity, tagline and compact calls to action', () => {
    assert.match(landing, /AKBARAL!/);
    assert.match(landing, /One Intelligence\./);
    assert.match(landing, /Every Solution\./);
    assert.match(landing, /Start Free Trial/);
    assert.match(landing, /See Plans/);
    assert.match(landing, /Sign in/);
    assert.doesNotMatch(landing, /AKBARAL AI/);
  });

  it('uses a concise three-step explanation rather than the old six-scene page', () => {
    assert.match(landing, /One request\. Three clear steps\./);
    for (const step of ['Plan', 'Build', 'Verify']) assert.match(landing, new RegExp(`>${step}<`));
    assert.doesNotMatch(landing, /id="scene-[1-6]"/);
  });

  it('implements all four deterministic scroll-narrative markers', () => {
    for (const marker of ['walk', 'power', 'work', 'handoff']) {
      assert.match(landing, new RegExp(`\\['${marker}'`));
    }
    assert.match(landing, /data-narrative=\{marker\}/);
    for (const state of ['Planning', 'Building', 'Verifying', 'Result ready']) assert.match(landing, new RegExp(state));
    assert.match(landing, /ScrollTrigger/);
    assert.match(landing, /useGSAP/);
  });

  it('publishes the six exact USD prices and Work quotas unchanged', () => {
    for (const value of [
      "['Free', '$0', '5 tasks', '30-day trial']",
      "['Starter', '$10', '25 tasks', 'For focused work']",
      "['Pro', '$50', '100 tasks', 'For professionals']",
      "['Business', '$90', '250 tasks', 'For growing teams']",
      "['Scale', '$200', '750 tasks', 'For high-volume work']",
      "['Enterprise', '$400', '2,000 tasks', 'For organizations']",
    ]) assert.ok(landing.includes(value), `missing plan: ${value}`);
    assert.match(landing, /Simple plans · USD/);
    assert.match(landing, /charged only after verified success/);
  });

  it('describes 4,001 agents truthfully as registered contracts', () => {
    assert.match(landing, /4,001/);
    assert.match(landing, /registered agent contracts/);
    assert.match(landing, /not active or earning agents/);
    assert.doesNotMatch(landing, /4,001 active|4,001 earning/i);
  });

  it('fully bypasses motion when reduced motion is requested', () => {
    assert.match(landing, /prefers-reduced-motion: reduce/);
    assert.match(landingCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(landingCss, /\.progress \{ display: none; \}/);
    assert.match(landingCss, /transform: none !important; opacity: 1 !important/);
  });

  it('enforces accessible target sizes and responsive no-overflow composition', () => {
    assert.match(landingCss, /min-width: 44px; min-height: 44px/);
    assert.match(landingCss, /overflow: clip/);
    assert.match(landingCss, /@media \(max-width: 760px\)/);
    assert.match(landingCss, /@media \(max-width: 460px\)/);
    assert.match(landingCss, /grid-template-columns: 1fr/);
  });

  it('uses generated dashboard theme tokens without introducing a color palette', () => {
    assert.equal(tokens.palette.primary['500'], '#0ea5e9');
    assert.equal(tokens.palette.neutral['900'], '#0f172a');
    assert.doesNotMatch(landingCss, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const token of ['--bg-deep', '--bg', '--bg-2', '--text', '--text-2', '--text-dim', '--accent', '--telemetry']) {
      assert.ok(landingCss.includes(`var(${token})`), `landing must consume ${token}`);
    }
  });

  it('keeps every public source free of the private mission identity and secret material', () => {
    const publicSources = [landing, landingCss, publicPage].join('\n');
    assert.doesNotMatch(publicSources, /ZA141251SA/);
    assert.doesNotMatch(publicSources, /(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']+/i);
  });

  it('reuses the approved animation and icon dependencies without adding packages', () => {
    for (const dependency of ['gsap', '@gsap/react', 'framer-motion', 'lucide-react']) {
      assert.ok(packageJson.dependencies[dependency], `missing dependency ${dependency}`);
    }
    assert.ok(packageJson.devDependencies['@types/gsap']);
    assert.match(landing, /from 'framer-motion'/);
    assert.match(landing, /from 'lucide-react'/);
  });
});
