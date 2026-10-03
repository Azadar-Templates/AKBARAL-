import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const landing = read('src/app/_components/landing/cinematic-landing.tsx');
const landingCss = read('src/app/_components/landing/cinematic-landing.module.css');
const tokens = JSON.parse(read('design-system/tokens.json')) as {
  palette: Record<string, Record<string, string>>;
};
const typedTokens = read('src/design-system/tokens/index.ts');
const packageJson = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('Phase 2A cinematic landing contract', () => {
  it('uses the exact AKBARAL! identity and public calls to action', () => {
    assert.match(landing, /One Intelligence\./);
    assert.match(landing, /Every Solution\./);
    assert.match(landing, /Start Free Trial/);
    assert.match(landing, /See Plans/);
    assert.doesNotMatch(landing, /AKBARAL AI/);
    assert.doesNotMatch(landing, /ZA141251SA/);
  });

  it('renders exactly six narrative scenes', () => {
    const sections = [...landing.matchAll(/<section id="scene-(\d)"/g)].map((match) => match[1]);
    assert.deepEqual(sections, ['1', '2', '3', '4', '5', '6']);
    assert.match(landing, /Understanding/);
    assert.match(landing, /Planning/);
    assert.match(landing, /Routing/);
    assert.match(landing, /Execution & verification/);
    assert.match(landing, /Delivery/);
  });

  it('publishes the six exact prices and successful Work quotas', () => {
    for (const value of [
      "['Free', '$0', '5 tasks', '30-day trial']",
      "['Starter', '$10', '25 tasks', 'For focused work']",
      "['Pro', '$50', '100 tasks', 'For professionals']",
      "['Business', '$90', '250 tasks', 'For growing teams']",
      "['Scale', '$200', '750 tasks', 'For high-volume work']",
      "['Enterprise', '$400', '2,000 tasks', 'For organizations']",
    ]) assert.ok(landing.includes(value), `missing plan: ${value}`);
    assert.match(landing, /charged only after verified success/);
  });

  it('uses GSAP ScrollTrigger and preserves reduced-motion and touch behavior', () => {
    assert.match(landing, /ScrollTrigger/);
    assert.match(landing, /useGSAP/);
    assert.match(landing, /prefers-reduced-motion/);
    assert.match(landingCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(landingCss, /\.root button, \.root a \{ (?:min-width: 44px; )?min-height: 44px; \}/);
  });

  it('keeps the requested blue and neutral token ramps as the source of truth', () => {
    assert.equal(tokens.palette.primary['500'], '#0ea5e9');
    assert.equal(tokens.palette.neutral['900'], '#0f172a');
    assert.equal(tokens.palette.semantic.success, '#22c55e');
  });

  it('exports the complete typed typography, spacing and effects contract', () => {
    assert.match(typedTokens, /JetBrains Mono/);
    assert.match(typedTokens, /'7xl': '4\.5rem'/);
    assert.match(typedTokens, /48: '12rem'/);
    assert.match(typedTokens, /'glow-lg'/);
    assert.match(typedTokens, /dramatic: 'cubic-bezier\(0\.87, 0, 0\.13, 1\)'/);
  });

  it('declares and uses the animation and icon dependencies', () => {
    for (const dependency of ['gsap', '@gsap/react', 'framer-motion', 'lucide-react']) {
      assert.ok(packageJson.dependencies[dependency], `missing dependency ${dependency}`);
    }
    assert.ok(packageJson.devDependencies['@types/gsap']);
    assert.match(landing, /from 'framer-motion'/);
  });
});
