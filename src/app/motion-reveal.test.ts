/**
 * AKBARAL! motion primitives — Reveal + BlurReveal (dependency-free).
 *
 * Every assertion here guards a safety rail rather than an aesthetic:
 *   - content is visible on the very first render (opacity is pinned to 1)
 *   - reduced motion never hides anything
 *   - content can never be left hidden (observer + 1200ms safety timeout)
 *   - only opacity/transform/filter animate, so there is no layout shift
 *
 * Runner note: the repo's own suite (`npm test`) runs this file with
 * node:test via tsx, while `npx vitest run` collects suites only through
 * the vitest API (vitest is not a project dependency). The suites below
 * are therefore registered with whichever API is available, so the file
 * passes under both runners.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as nodeDescribe, it as nodeIt } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const component = read('src/app/_components/motion-reveal.tsx');

// @ts-expect-error intentional dual-runner shim: top-level await needs
// "module": "esnext" in tsconfig, and the vitest package only resolves
// when the vitest runner itself provides it.
const vitest = await import('vitest').catch(() => null);
const { describe, it } = vitest ?? { describe: nodeDescribe, it: nodeIt };

describe('Reveal — block entrance', () => {
  it('is exported from the required location', () => {
    assert.match(component, /export function Reveal\(/);
    assert.match(component, /export default Reveal;/);
    assert.match(component, /"use client";/);
  });

  it('imports nothing but react — no CSS module remains', () => {
    assert.match(component, /import \* as React from "react";/);
    assert.equal(component.match(/^import /gm)?.length, 1, 'react is the only import');
    assert.doesNotMatch(component, /motion-reveal\.module\.css/, 'no CSS-module import remains');
    assert.doesNotMatch(component, /\.css['"]/, 'no stylesheet import of any kind');
  });

  it('triggers on viewport entry at a ~0.15 threshold', () => {
    assert.match(component, /threshold = 0\.15/);
    assert.match(component, /new IntersectionObserver\(/);
  });

  it('pins opacity to 1 and travels y 24 -> 0 over ~700ms ease-out with an optional delay', () => {
    assert.doesNotMatch(component, /opacity:\s*0/, 'content is never faded out');
    assert.match(component, /transform: shown \? "none" : "translateY\(24px\)"/);
    assert.match(component, /transition: "opacity 700ms ease-out, transform 700ms ease-out"/);
    assert.match(component, /transitionDelay: `\$\{delay\}ms`/);
  });
});

describe('BlurReveal — word-by-word blur reveal', () => {
  it('is exported and takes the copy as a text prop', () => {
    assert.match(component, /export function BlurReveal\(/);
    assert.match(component, /text: string;/);
  });

  it('splits text into words and staggers them ~100ms apart', () => {
    assert.match(component, /text\.split\(" "\)/, 'splits the text prop on spaces');
    assert.match(component, /words\.map\(\(word, i\) =>/);
    assert.match(component, /React\.createElement\(\s*"span"/, 'each word renders as its own span');
    // Word i is delayed by delay + i * 100ms, so the stagger increments per word.
    assert.match(component, /transitionDelay: `\$\{delay \+ i \* 100\}ms`/);
  });

  it('animates blur 10px -> 0 and y 20 -> 0 while opacity stays 1', () => {
    assert.match(component, /filter: shown \? "blur\(0px\)" : "blur\(10px\)"/);
    assert.match(component, /transform: shown \? "none" : "translateY\(20px\)"/);
    assert.match(component, /transition:\s*"opacity 700ms ease-out, filter 700ms ease-out, transform 700ms ease-out"/);
    assert.doesNotMatch(component, /opacity:\s*0/);
  });

  it('keeps the container wrapping with a 0.1em row gap and visual word spacing', () => {
    assert.match(component, /display: "flex"/);
    assert.match(component, /flexWrap: "wrap"/);
    assert.match(component, /rowGap: "0\.1em"/);
    assert.match(component, /marginRight: "0\.28em"/, 'words are spaced visually, not with layout-affecting nodes');
    assert.match(component, /justifyContent: align === "center" \? "center" : "flex-start"/);
  });

  it('never hides the words from assistive tech', () => {
    assert.match(component, /React\.createElement\(\s*"span"/);
    assert.doesNotMatch(component, /aria-hidden/, 'the revealed text is not hidden from AT');
  });
});

describe('safety rails', () => {
  it('never hides anything under prefers-reduced-motion', () => {
    assert.match(component, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/, 'JS checks the media query');
    const shortCircuits = component.match(/if \(prefersReducedMotion\(\)\) \{\s*setShown\(true\);\s*return;\s*\}/g);
    assert.ok(shortCircuits && shortCircuits.length === 2, 'both primitives stay visible without arming');
    // The hidden state is only ever a blur/translate — opacity is pinned at 1.
    assert.doesNotMatch(component, /opacity:\s*0/);
  });

  it('forces the visible state with a ~1200ms safety timeout', () => {
    const timers = component.match(/window\.setTimeout\(\(\) => setShown\(true\), 1200\)/g);
    assert.ok(timers && timers.length === 2, 'both primitives arm the safety timeout');
  });

  it('stays visible when IntersectionObserver or matchMedia is missing', () => {
    const fallbacks = component.match(/if \(typeof IntersectionObserver === "undefined"\) \{\s*window\.clearTimeout\(timer\);\s*setShown\(true\);\s*return;\s*\}/g);
    assert.ok(fallbacks && fallbacks.length === 2, 'both primitives fall back to visible without an observer');
    assert.match(component, /typeof window === "undefined" \|\| !window\.matchMedia/, 'a missing matchMedia never hides content');
  });

  it('un-hides on viewport entry and cleans up the observer', () => {
    assert.match(component, /entries\.some\(\(e\) => e\.isIntersecting\)/);
    assert.match(component, /io\.observe\(node\)/);
    assert.match(component, /io\.disconnect\(\)/);
  });

  it('renders visible by default — the first paint never hides content', () => {
    assert.match(component, /useState\(false\)/, 'both primitives start un-shown but never invisible');
    assert.doesNotMatch(component, /visibility:\s*hidden/);
    assert.doesNotMatch(component, /display: "none"/);
    assert.doesNotMatch(component, /opacity:\s*0/);
  });

  it('animates only opacity, transform and filter — no layout shift', () => {
    const transitions = component.match(/transition:\s*"[^"]+"/g) ?? [];
    assert.ok(transitions.length >= 2, 'both primitives declare their transitions');
    const compositorOnly = ['opacity', 'transform', 'filter'];
    for (const declaration of transitions) {
      const value = declaration.replace(/^transition:\s*"/, '').replace(/"$/, '');
      for (const timing of value.split(',')) {
        const property = timing.trim().split(' ')[0];
        assert.ok(compositorOnly.includes(property), `${property} is compositor-only`);
      }
    }
  });

  it('adds no client-side dependency for motion', () => {
    assert.doesNotMatch(component, /from 'framer-motion'/);
    assert.doesNotMatch(component, /from 'gsap'/);
    assert.doesNotMatch(component, /from '@gsap\/react'/);
  });
});
