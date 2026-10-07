/**
 * AKBARAL! motion primitives — Reveal + BlurReveal.
 *
 * Every assertion here guards a safety rail rather than an aesthetic:
 *   - content is visible on the very first render
 *   - reduced motion never hides anything
 *   - content can never be left hidden (observer + timeout + focusin)
 *   - only opacity/transform/filter animate, so there is no layout shift
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const component = read('src/app/_components/motion-reveal.tsx');
const css = read('src/app/_components/motion-reveal.module.css');

const base = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'));

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = [...base.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`, 'g'))].at(-1);
  assert.ok(match?.index !== undefined, `missing CSS rule for ${selector}`);
  const start = match.index + match[0].lastIndexOf(selector);
  const end = base.indexOf('}', start);
  return base.slice(start, end + 1);
}

describe('Reveal — block entrance', () => {
  it('renders visible on the first paint (no hiding style in the base rule)', () => {
    const base = rule('.reveal');
    assert.match(base, /opacity:\s*1/);
    assert.match(base, /transform:\s*none/);
    assert.doesNotMatch(base, /visibility:\s*hidden/);
    assert.doesNotMatch(base, /display:\s*none/);
  });

  it('travels y 24 -> 0 over ~700ms ease-out with an optional delay', () => {
    const armed = rule(".reveal[data-state='armed']");
    assert.match(armed, /transform:\s*translateY\(24px\)/);
    assert.match(armed, /opacity:\s*0/);

    const revealed = rule(".reveal[data-state='in']");
    assert.match(revealed, /transform:\s*translateY\(0\)/);
    assert.match(revealed, /opacity:\s*1/);
    assert.match(revealed, /transition:[^;]*opacity var\(--dur-slow\) var\(--ease-out\)/);
    assert.match(revealed, /transition-delay:\s*var\(--ak-reveal-delay/);
    // --dur-slow is the 560ms base step; the component documents 700ms.
    assert.match(component, /REVEAL_MS\s*=\s*700/);
  });

  it('triggers on viewport entry at a ~0.15 threshold', () => {
    assert.match(component, /threshold\s*=\s*0\.15/);
    assert.match(component, /new IntersectionObserver\(/);
  });

  it('is exported from the required location', () => {
    assert.match(component, /export function Reveal\(/);
    assert.match(component, /from '\.\/motion-reveal\.module\.css'/);
    assert.match(component, /'use client'/);
  });
});

describe('BlurReveal — word-by-word blur reveal', () => {
  it('splits text into words and staggers them ~100ms apart', () => {
    assert.match(component, /export function BlurReveal\(/);
    assert.match(component, /split\(\/\\s\+\/\)/, 'splits on whitespace');
    const wordIn = rule(".word[data-state='in']");
    assert.match(wordIn, /transition-delay:\s*calc\(var\(--ak-word-index, 0\) \* var\(--ak-word-stagger, 100ms\)\)/);
    assert.match(component, /BLUR_REVEAL_STAGGER_MS\s*=\s*100/);
  });

  it('animates blur 10px -> 0, opacity 0 -> 1, y 20 -> 0', () => {
    const armed = rule(".word[data-state='armed']");
    assert.match(armed, /filter:\s*blur\(10px\)/);
    assert.match(armed, /opacity:\s*0/);
    assert.match(armed, /transform:\s*translateY\(20px\)/);

    const revealed = rule(".word[data-state='in']");
    assert.match(revealed, /filter:\s*blur\(0px\)/);
    assert.match(revealed, /opacity:\s*1/);
    assert.match(revealed, /transform:\s*translateY\(0\)/);
    assert.match(revealed, /transition:[^;]*filter var\(--dur-slow\) var\(--ease-out\)/);
  });

  it('keeps the container wrapping with a 0.1em row gap', () => {
    const words = rule('.words');
    assert.match(words, /display:\s*flex/);
    assert.match(words, /flex-wrap:\s*wrap/);
    assert.match(words, /row-gap:\s*0\.1em/);
    assert.match(words, /max-width:\s*100%/);
  });

  it('keeps one readable sentence for assistive tech, copy and search', () => {
    // Real space text nodes between the spans: textContent stays a sentence.
    assert.match(component, /\{index > 0 \? ' ' : null\}/);
    assert.match(component, /<span/);
    assert.doesNotMatch(component, /aria-hidden="true"/, 'the revealed text is not hidden from AT');
  });
});

describe('safety rails', () => {
  it('never hides anything under prefers-reduced-motion', () => {
    assert.match(component, /prefers-reduced-motion: reduce/, 'JS checks the media query');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(block, /opacity:\s*1 !important/);
    assert.match(block, /transform:\s*none !important/);
    assert.match(block, /filter:\s*none !important/);
    assert.match(block, /transition:\s*none !important/);
    assert.match(block, /transition-delay:\s*0ms !important/);
    // Both primitives and both states are covered.
    for (const selector of ['.reveal', '.words', '.word']) {
      assert.ok(block.includes(selector), `${selector} is covered by the reduced-motion guard`);
    }
  });

  it('has three independent un-hide paths: observer, timeout and focus', () => {
    assert.match(component, /new IntersectionObserver\(/);
    assert.match(component, /setTimeout\(settle, SAFETY_TIMEOUT_MS\)/);
    assert.match(component, /SAFETY_TIMEOUT_MS\s*=\s*1600/);
    assert.match(component, /addEventListener\('focusin'/);
    // The safety net is installed BEFORE the element is armed.
    assert.ok(
      component.indexOf('const safety = window.setTimeout(settle, SAFETY_TIMEOUT_MS)') <
        component.indexOf('setState(ARMED)'),
      'arming happens only after every un-hide path exists',
    );
  });

  it('stays visible when IntersectionObserver or matchMedia is missing', () => {
    assert.match(component, /typeof IntersectionObserver !== 'function'[\s\S]*?setState\(IDLE\)/);
    assert.match(component, /typeof window\.matchMedia !== 'function'\)\s*return false/);
  });

  it('animates only opacity, transform and filter — no layout shift', () => {
    const animated = [
      rule(".reveal[data-state='armed']"),
      rule(".reveal[data-state='in']"),
      rule(".word[data-state='armed']"),
      rule(".word[data-state='in']"),
    ].join('\n');
    for (const property of ['width', 'height', 'margin', 'padding', 'top', 'left', 'right', 'bottom', 'position', 'display', 'font-size']) {
      assert.doesNotMatch(animated, new RegExp(`(^|[;\\s])${property}\\s*:`, 'm'), `${property} must never animate`);
    }
    const settled = [rule(".reveal[data-state='in']"), rule(".word[data-state='in']")].join('\n');
    assert.match(settled, /transition:[^;]*opacity/);
    assert.match(settled, /transition:[^;]*transform/);
    assert.match(settled, /transition:[^;]*filter/);
  });

  it('documents the rails in the source so they survive refactors', () => {
    assert.match(component, /FIRST RENDER IS VISIBLE/);
    assert.match(component, /REDUCED MOTION NEVER HIDES/);
    assert.match(component, /CONTENT CAN NEVER STAY HIDDEN/);
    assert.match(component, /NO LAYOUT SHIFT/);
    assert.match(component, /NO DEPENDENCIES/);
  });

  it('adds no client-side dependency for motion', () => {
    assert.doesNotMatch(component, /from 'framer-motion'/);
    assert.doesNotMatch(component, /from 'gsap'/);
    assert.doesNotMatch(component, /from '@gsap\/react'/);
  });
});
