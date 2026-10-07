/**
 * AKBARAL! liquid-glass design system — token, material and honesty guards.
 *
 * These assertions protect the rules that are easy to break by accident:
 *   - glass tokens are DERIVED from existing primitives (no new hue)
 *   - public/tokens.css is regenerated and consistent with tokens.json
 *   - the mission dashboard accent is the AKBARAL! green
 *   - both @supports fallbacks ship with the material
 *   - no third-party media creeps into source, tokens or public/
 *   - the Google Fonts contract and the AdSense block are untouched
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const tokensJson = JSON.parse(read('design-system/tokens.json'));
const tokensCss = read('public/tokens.css');
const buildScript = read('design-system/build.mjs');
const glassCss = read('src/app/glass.css');
const missionCss = read('mission-dashboard/styles.css');

/** Every colour literal in the PRIMITIVE section of the token source. */
function primitiveColorLiterals(): Set<string> {
  const { glass, atmosphere, color, shadow } = tokensJson;
  const values: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') values.push(node);
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  };
  // The pre-existing primitive blocks only — level1/2/3, atmosphere, palette.
  collect({ level1: glass.level1, level2: glass.level2, level3: glass.level3 });
  collect(atmosphere);
  collect(color);
  collect(shadow.dark);
  return new Set(values);
}

const HEX = /#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_TRIPLE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

/** Normalised set of colour identities in a blob of text. */
function colorIdentities(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(HEX)) {
    let hex = match[1].toLowerCase();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    found.add(`hex:${hex}`);
  }
  for (const match of text.matchAll(RGB_TRIPLE)) {
    found.add(`rgb:${Number(match[1])},${Number(match[2])},${Number(match[3])}`);
  }
  return found;
}

function expandHexToRgb(hex: string): string | null {
  let value = hex.toLowerCase();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (value.length !== 6) return null;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgb:${r},${g},${b}`;
}

describe('glass tokens are derived from existing primitives', () => {
  it('declares the full semantic glass contract in the token source', () => {
    const semantic = tokensJson.glass.semantic;
    assert.ok(semantic, 'glass.semantic exists in tokens.json');
    for (const key of [
      'surface',
      'surfaceStrong',
      'border',
      'strokeGradient',
      'strokeWidthPx',
      'blurSubtle',
      'blurStrong',
      'insetHighlight',
      'insetHighlightStrong',
      'solidFallback',
      'solidFallbackStrong',
    ]) {
      assert.ok(semantic[key] !== undefined, `glass.semantic.${key} is declared`);
    }
  });

  it('introduces NO new hue — every semantic colour identity already exists as a primitive', () => {
    const primitives = primitiveColorLiterals();
    const primitiveIdentities = colorIdentities([...primitives].join(' '));
    // Hex primitives also count as their rgb form, so #020617 matches rgba(2,6,23,…).
    for (const value of primitives) {
      for (const match of value.matchAll(HEX)) {
        const rgb = expandHexToRgb(match[1]);
        if (rgb) primitiveIdentities.add(rgb);
      }
    }

    const semantic = tokensJson.glass.semantic;
    const semanticKeys = [
      'surface',
      'surfaceStrong',
      'border',
      'strokeGradient',
      'insetHighlight',
      'insetHighlightStrong',
      'solidFallback',
      'solidFallbackStrong',
      'shadowSoft',
      'shadowStrong',
      'scrim',
    ] as const;

    for (const key of semanticKeys) {
      const value = String(semantic[key]);
      for (const identity of colorIdentities(value)) {
        assert.ok(
          primitiveIdentities.has(identity),
          `glass.semantic.${key} uses ${identity}, which is not an existing primitive colour (${value})`,
        );
      }
    }
  });

  it('keeps the blur amounts and stroke width on the existing glass ramp', () => {
    const { level1, level3, semantic } = tokensJson.glass;
    assert.equal(semantic.blurSubtle, level1.blur, 'subtle blur reuses level1');
    assert.equal(semantic.blurStrong, level3.blur, 'strong blur reuses level3');
    assert.ok(semantic.strokeWidthPx > 0 && semantic.strokeWidthPx <= 2, 'stroke stays a hairline');
  });

  it('derives the semantic text ramp and micro-label from the existing type scale', () => {
    assert.equal(tokensJson.semantic.text.primary, tokensJson.color.dark.text);
    assert.equal(tokensJson.semantic.text.secondary, tokensJson.color.dark.text2);
    assert.equal(tokensJson.semantic.text.tertiary, tokensJson.color.dark.textDim);
    const micro = tokensJson.semantic.microLabel;
    assert.equal(micro.font, 'mono', 'micro-label is mono');
    assert.equal(String(micro.case).toLowerCase(), 'upper', 'micro-label is uppercase');
    assert.ok(micro.trackingEm >= 0.1 && micro.trackingEm <= 0.2, `tracking ~0.15em (got ${micro.trackingEm})`);
    assert.ok(micro.sizePx >= 10 && micro.sizePx <= 12, `size 10-12px (got ${micro.sizePx})`);
    assert.equal(micro.sizePx, tokensJson.typography.scale.micro.webSize, 'reuses the micro step of the type scale');
  });

  it('derives the space scale from the existing spacing primitives', () => {
    const spacing = tokensJson.spacing;
    for (const key of ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'] as const) {
      assert.equal(tokensJson.semantic.space[key], spacing[key], `--space-${key} mirrors spacing.${key}`);
    }
  });
});

describe('public/tokens.css is regenerated and consistent with the source', () => {
  it('emits every glass semantic token the components consume', () => {
    for (const name of [
      '--glass-surface',
      '--glass-surface-strong',
      '--glass-border',
      '--glass-stroke-gradient',
      '--glass-stroke-width',
      '--glass-blur-subtle',
      '--glass-blur-strong',
      '--glass-inset-highlight',
      '--glass-inset-highlight-strong',
      '--glass-solid-fallback',
      '--glass-solid-fallback-strong',
      '--text-primary',
      '--text-secondary',
      '--text-tertiary',
      '--micro-label',
      '--micro-label-tracking',
      '--space-xs',
      '--space-section',
      '--radius-pill',
    ]) {
      assert.ok(tokensCss.includes(`${name}:`), `tokens.css declares ${name}`);
    }
  });

  it('is byte-identical to a fresh build of the token source', () => {
    const before = tokensCss;
    execFileSync(process.execPath, [join(root, 'design-system', 'build.mjs')], { cwd: root, stdio: 'pipe' });
    const after = read('public/tokens.css');
    assert.equal(after, before, 'public/tokens.css is in sync with design-system/tokens.json');
  });

  it('keeps the pre-existing primitive contract intact', () => {
    for (const name of ['--bg-deep', '--accent', '--accent-bright', '--line', '--text', '--radius-xl', '--shadow', '--ease-out', '--glass-3-fill', '--atmo-indigo']) {
      assert.ok(tokensCss.includes(`${name}:`), `tokens.css still declares ${name}`);
    }
    assert.ok(tokensCss.includes(`--accent: ${tokensJson.color.dark.accent};`), 'AKBARAL! green is still the accent');
  });

  it('is compiled by build.mjs, which is the single write path', () => {
    assert.match(buildScript, /write\(join\(root, 'public', 'tokens\.css'\), tokensCss\)/);
    assert.match(tokensCss, /DO NOT EDIT BY HAND/);
  });
});

describe('the glass material ships both fallbacks', () => {
  it('paints the gradient stroke with a masked ::before at 1.4px', () => {
    assert.match(glassCss, /--glass-stroke-width/);
    assert.match(glassCss, /--glass-stroke-gradient/);
    assert.match(glassCss, /-webkit-mask-composite:\s*xor/);
    assert.match(glassCss, /mask-composite:\s*exclude/);
    assert.match(glassCss, /pointer-events:\s*none/);
  });

  it('falls back to a plain low-alpha border when mask compositing is unavailable', () => {
    const fallback = glassCss.slice(glassCss.indexOf('FALLBACK 1'));
    const block = fallback.slice(0, fallback.indexOf('FALLBACK 2'));
    assert.match(block, /@supports not \([\s\S]*?mask-composite: exclude[\s\S]*?or \(-webkit-mask-composite: xor\)/);
    assert.match(block, /border:\s*1px solid var\(--glass-border\)/);
    assert.match(block, /display:\s*none/, 'the masked ::before is dropped, not painted as a slab');
  });

  it('falls back to an opaque solid when backdrop-filter is unavailable', () => {
    const block = glassCss.slice(glassCss.indexOf('FALLBACK 2'));
    assert.match(block, /@supports not \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?or \(-webkit-backdrop-filter: blur\(1px\)\)/);
    assert.match(block, /--glass-solid-fallback\)/);
    assert.match(block, /--glass-solid-fallback-strong\)/);
  });

  it('defines a subtle depth and a strong depth', () => {
    const subtle = glassCss.slice(glassCss.indexOf('.ak-glass-subtle {'), glassCss.indexOf('/* ---------- STRONG'));
    assert.match(subtle, /background:\s*var\(--glass-surface\)/);
    assert.match(subtle, /backdrop-filter:\s*blur\(var\(--glass-blur-subtle\)\)/);
    assert.match(subtle, /inset 0 1px 0 var\(--glass-inset-highlight\)/);
    assert.doesNotMatch(subtle, /border:\s*1px/, 'subtle carries no flat border');

    const strong = glassCss.slice(glassCss.indexOf('.ak-glass-strong {'), glassCss.indexOf('/* ---------- helpers'));
    assert.match(strong, /background:\s*var\(--glass-surface-strong\)/);
    assert.match(strong, /backdrop-filter:\s*blur\(var\(--glass-blur-strong\)\)/);
    assert.match(strong, /var\(--glass-shadow-strong\)/);
    assert.match(strong, /inset 0 1px 0 var\(--glass-inset-highlight-strong\)/);
  });

  it('never creates overflow: decorative layers are absolute, inset and inert', () => {
    const beforeFallbacks = glassCss.slice(0, glassCss.indexOf('FALLBACK 1'));
    const layers = beforeFallbacks.match(/\.ak-glass-(?:subtle|strong|stroke)::before(?:\s*,\s*\.ak-glass-(?:subtle|strong|stroke)::before)*\s*\{[^}]*\}/g) ?? [];
    assert.equal(layers.length, 1, 'one shared stroke rule');
    for (const layer of layers) {
      assert.match(layer, /position:\s*absolute/);
      assert.match(layer, /inset:\s*0/);
      assert.match(layer, /pointer-events:\s*none/);
      assert.doesNotMatch(layer, /width:\s*(?:1\d\d|[2-9]\d\d)(?:px|vw|%)/);
    }
  });

  it('is loaded globally by the root layout', () => {
    assert.match(read('src/app/layout.tsx'), /import '\.\/glass\.css'/);
  });
});

describe('mission dashboard uses the AKBARAL! green accent', () => {
  it('replaces the hardcoded blue #4da3ff with the brand green', () => {
    assert.doesNotMatch(missionCss, /#4da3ff/i, 'no hardcoded blue accent remains');
    assert.match(missionCss, new RegExp(`--accent:\\s*${tokensJson.color.dark.accent}`, 'i'));
  });

  it('keeps every other mission dashboard token untouched', () => {
    assert.match(missionCss, /--panel:/);
    assert.match(missionCss, /--good:/);
    assert.match(missionCss, /--bad:/);
  });
});

describe('no third-party media, and the font/ads contracts are untouched', () => {
  const mediaSourceFiles = [
    'src/app/glass.css',
    'src/app/_components/atmosphere.tsx',
    'src/app/_components/atmosphere.module.css',
    'src/app/_components/motion-reveal.tsx',
    'src/app/_components/motion-reveal.module.css',
    'public/tokens.css',
  ];

  it('contains no remote media URLs in the new glass sources or tokens', () => {
    const banned = /https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)/i;
    for (const file of mediaSourceFiles) {
      assert.doesNotMatch(read(file), banned, `${file} has no third-party URL`);
    }
    // Remote MEDIA specifically. The owner hero loop is a local path by
    // contract, so a bare ".mp4" is allowed — a hosted one never is.
    const remoteMedia = /(?:https?:)?\/\/[A-Za-z0-9._\-]+[^\s"')]*\.(?:mp4|webm|mov|m4v|png|jpe?g|gif|webp|avif|svg)\b/i;
    for (const file of mediaSourceFiles) {
      const text = read(file);
      assert.doesNotMatch(text, /url\(\s*['"]?https?:/i, `${file} references no remote url()`);
      assert.doesNotMatch(text, remoteMedia, `${file} requests no remotely hosted media file`);
      assert.doesNotMatch(text, /(?:src|href|poster)\s*=\s*["']https?:/i, `${file} points no element at a remote asset`);
    }
  });

  it('keeps the Google Fonts loading contract exactly as it was', () => {
    const layout = read('src/app/layout.tsx');
    assert.match(layout, /rel="preconnect"[^>]*fonts\.googleapis\.com/);
    assert.match(layout, /rel="preconnect"[^>]*fonts\.gstatic\.com/);
    assert.match(
      layout,
      /family=Inter:wght@400;500;600;700&family=JetBrains\+Mono:wght@400;500&display=swap/,
      'the font request is unchanged',
    );
    assert.doesNotMatch(layout, /next\/font/, 'no self-hosting was introduced');
  });

  it('leaves the conditional AdSense block disabled and unextended', () => {
    const layout = read('src/app/layout.tsx');
    assert.match(layout, /AKBARAL_ADSENSE_CLIENT/);
    assert.doesNotMatch(layout, /AKBARAL_ADSENSE_SLOT|data-ad-slot|adsbygoogle/, 'no ad slot was added');
    const appJs = read('public/app.js');
    assert.match(appJs, /akbaral-adsense-client/);
  });
});
