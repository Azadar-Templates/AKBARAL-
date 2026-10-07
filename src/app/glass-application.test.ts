/**
 * AKBARAL! liquid-glass — application guards.
 *
 * Covers what the material must never break once it is applied to real
 * surfaces: WCAG AA contrast on glass, the honesty contract, accessibility
 * of the chrome, the absence of third-party media, and the presence of the
 * mission stack that this redesign was explicitly not allowed to touch.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const tokensCss = read('public/tokens.css');
const tokens = JSON.parse(read('design-system/tokens.json'));
const landingCss = read('src/app/_components/landing-reset.module.css');
const publicInfoCss = read('src/app/(public)/public-info.module.css');
const shellCss = read('src/app/_components/app-shell.module.css');
const workbenchCss = read('src/app/_components/workbench/workbench-shell.module.css');
const chromeCss = read('src/app/_components/public-site-chrome.module.css');
const missionCss = read('mission-dashboard/styles.css');

/* ======================================================================
   Colour maths — the contrast numbers below are COMPUTED, not asserted
   from memory, so they stay true if a token ever changes.
   ====================================================================== */

type Rgb = [number, number, number];

function parseColor(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = value.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function alphaOf(value: string): number {
  const rgba = value.trim().match(/^rgba?\([^)]*?,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Number(rgba[1]);
  return 1;
}

/** Flatten a translucent colour over an opaque backdrop. */
function composite(fg: string, bg: string): Rgb {
  const f = parseColor(fg);
  const b = parseColor(bg);
  assert.ok(f && b, `both colours parse: ${fg} over ${bg}`);
  const a = alphaOf(fg);
  return [0, 1, 2].map((i) => a * f![i] + (1 - a) * b![i]) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function token(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `token ${name} is declared in public/tokens.css`);
  return match[1].trim();
}

describe('glass panel text meets WCAG AA', () => {
  const bgDeep = token('--bg-deep');
  const surfaces = {
    subtle: token('--glass-surface'),
    strong: token('--glass-surface-strong'),
    'subtle (no-backdrop-filter fallback)': token('--glass-solid-fallback'),
    'strong (no-backdrop-filter fallback)': token('--glass-solid-fallback-strong'),
  };
  const inks = {
    primary: token('--text-primary'),
    secondary: token('--text-secondary'),
    tertiary: token('--text-tertiary'),
  };

  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    for (const [inkName, ink] of Object.entries(inks)) {
      it(`${inkName} text on the ${surfaceName} surface clears 4.5:1`, () => {
        const ratio = contrast(composite(ink, bgDeep), composite(surface, bgDeep));
        assert.ok(
          ratio >= 4.5,
          `${inkName} on ${surfaceName} is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`,
        );
      });
    }
  }

  it('the dark base is genuinely dark and body text is white', () => {
    const base = parseColor(bgDeep);
    assert.ok(base);
    assert.ok(relativeLuminance(base!) < 0.02, `--bg-deep ${bgDeep} is a dark base`);
    assert.equal(token('--text-primary').toLowerCase(), tokens.color.dark.text.toLowerCase());
  });

  it('supplies a text scrim for text placed over atmosphere or media', () => {
    const glass = read('src/app/glass.css');
    assert.match(glass, /\.ak-glass-text-scrim::after/);
    assert.match(glass, /rgba\(2, 6, 23, 0\.7\d\)/, 'the scrim is a flat dark layer, not glass');
  });

  it('never leaves text on a bare translucent fill in the composer or message bubbles', () => {
    // Text-bearing surfaces keep an opaque background-color and add the
    // glass tint as a background IMAGE on top of it.
    assert.match(workbenchCss, /\.message\s*\{[^}]*background-color:\s*var\(--bg\)/);
    assert.match(workbenchCss, /\.composer\s*\{[^}]*background-color:\s*var\(--surface\)/);
    assert.match(workbenchCss, /\.message,\s*\.composer\s*\{\s*background-image:\s*linear-gradient\(var\(--glass-surface\)/);
  });

  it('keeps public form fields opaque under their glass tint', () => {
    const site = read('src/app/(public)/site.css');
    assert.match(site, /background-color:var\(--bg-2\)/);
    assert.match(site, /background-image: linear-gradient\(var\(--glass-surface\), var\(--glass-surface\)\)/);
  });
});

describe('the redesign is applied to every required surface', () => {
  const expectations: Array<[string, string, RegExp]> = [
    ['public landing', landingCss, /ak-glass-(subtle|strong) from global/],
    ['public inner pages', publicInfoCss, /ak-glass-(subtle|strong) from global/],
    ['public nav + drawer', chromeCss, /ak-glass-(subtle|strong|scrim) from global/],
    ['authenticated shell', shellCss, /ak-glass-(subtle|strong|scrim) from global/],
    ['chat/work workbench', workbenchCss, /ak-glass-(subtle|strong) from global/],
    ['mission dashboard', missionCss, /\.ak-glass-(subtle|strong)\b/],
  ];

  for (const [name, source, pattern] of expectations) {
    it(`applies the glass material to the ${name}`, () => {
      assert.match(source, pattern);
    });
  }

  it('shares one material: composes the global layer, or restates the same tokens', () => {
    // Most surfaces `composes` the global glass layer. Selectors that other
    // contracts match by their literal ".name{first-property" prefix cannot
    // carry a leading `composes`, so they restate the SAME tokens instead.
    // Either way there is exactly one definition of the material.
    for (const file of [landingCss, publicInfoCss, chromeCss, shellCss, workbenchCss]) {
      assert.match(
        file,
        /composes: ak-glass-(subtle|strong|scrim) from global|var\(--glass-(surface|surface-strong|scrim)\)/,
        'every styled surface resolves to the shared glass tokens',
      );
    }
    // The shared layer is the single source for the composes path.
    assert.match(read('src/app/glass.css'), /\.ak-glass-subtle \{/);
    assert.match(read('src/app/glass.css'), /\.ak-glass-strong \{/);
  });

  it('gives the mission dashboard glass panels, table headers and badges', () => {
    assert.match(missionCss, /th \{[^}]*text-transform:\s*uppercase/);
    assert.match(missionCss, /\.pill \{[^}]*border-radius:\s*999px/);
    assert.match(missionCss, /--accent:\s*#2f8348/);
  });
});

describe('honesty: no fabricated metrics, no private identifier leak', () => {
  const publicSources = [
    'src/app/page.tsx',
    'src/app/_components/landing-reset.tsx',
    'src/app/_components/public-site-chrome.tsx',
    'src/app/_components/public-pricing.tsx',
    'src/app/(public)/public-info.tsx',
    'src/app/_components/atmosphere.tsx',
    'src/app/_components/motion-reveal.tsx',
  ].map(read).join('\n');

  const publicCss = [
    landingCss, publicInfoCss, chromeCss,
    read('src/app/(public)/site.css'),
    read('src/app/_components/public-pricing.module.css'),
  ].join('\n');

  it('never mentions the private mission identifier on a public surface', () => {
    assert.doesNotMatch(publicSources, /ZA141251SA/);
    assert.doesNotMatch(publicCss, /ZA141251SA/);
    assert.doesNotMatch(tokensCss, /ZA141251SA/);
  });

  it('phrases agent counts only as registered agent contracts', () => {
    assert.match(publicSources, /4,001 registered agent contracts/);
    // "4,001 agents" / "4001 available" would overstate a contract count.
    assert.doesNotMatch(publicSources, /4,001 (?:available |live |active )?agents(?! contracts)/i);
  });

  it('adds no invented customers, brands, testimonials or team members', () => {
    for (const phrase of [/trusted by/i, /testimonial/i, /loved by \d/i, /join \d[\d,]* (?:teams|companies|users)/i]) {
      assert.doesNotMatch(publicSources, phrase, `no fabricated social proof: ${phrase}`);
    }
  });

  it('keeps the six plans exactly as the single pricing source defines them', () => {
    const pricing = read('src/app/_lib/pricing.ts');
    for (const plan of tokens ? ['Free', 'Starter', 'Pro', 'Business', 'Scale', 'Enterprise'] : []) {
      assert.match(pricing, new RegExp(`name: '${plan}'`));
    }
    const entries = [...pricing.matchAll(/name: '([^']+)', price: '([^']+)', tasks: '([^']+)'/g)];
    assert.equal(entries.length, 6, 'exactly six plans');
  });

  it('preserves the honest empty-state copy on team and blog', () => {
    assert.match(read('src/app/(public)/team/page.tsx'), /Team information coming soon/);
    assert.match(read('src/app/(public)/public-info.tsx'), /Empty is more honest than a made-up newsroom/);
  });

  it('keeps the Google Fonts contract and leaves AdSense disabled', () => {
    const layout = read('src/app/layout.tsx');
    assert.match(layout, /family=Inter:wght@400;500;600;700&family=JetBrains\+Mono:wght@400;500&display=swap/);
    assert.doesNotMatch(layout, /data-ad-slot|adsbygoogle/);
  });
});

describe('accessibility of the glass chrome', () => {
  const chrome = read('src/app/_components/public-site-chrome.tsx');

  it('keeps Escape, focus trap and focus restore on the mobile drawer', () => {
    assert.match(chrome, /event\.key === 'Escape'/);
    assert.match(chrome, /event\.key !== 'Tab'/);
    assert.match(chrome, /previousFocus\.focus\(\)/);
    assert.match(chrome, /triggerRef\.current\?\.focus\(\)/);
  });

  it('exposes aria-expanded / aria-controls on the menu trigger', () => {
    assert.match(chrome, /aria-expanded=\{open\}/);
    assert.match(chrome, /aria-controls="public-mobile-navigation"/);
    assert.match(chrome, /aria-modal="true"/);
  });

  it('marks the current page with aria-current in the existing six-link order', () => {
    assert.match(chrome, /aria-current=\{active \? 'page' : undefined\}/);
    const order = ['Home', 'About Us', 'Pricing', 'Our Team', 'Blogs', 'Contact Us'];
    let previous = -1;
    for (const label of order) {
      const at = chrome.indexOf(`label: '${label}'`);
      assert.ok(at > previous, `${label} keeps its position in the nav order`);
      previous = at;
    }
    assert.match(chrome, /href="\/signin"[^>]*>Sign in</);
    assert.match(chrome, /Start Free Trial/);
    assert.match(chrome, /href="\/signup"/);
  });

  it('keeps every interactive chrome target at 44px or larger', () => {
    const selectors: Array<[string, RegExp]> = [
      ['.navLink / .signIn / .trial', /\.navLink,\s*\.signIn,\s*\.trial\s*\{[^}]*\}/],
      ['.menuButton', /\.menuButton\s*\{[^}]*\}/],
      ['.closeButton', /\.closeButton\s*\{[^}]*\}/],
      ['.footer a', /\.footer a\s*\{[^}]*\}/],
    ];
    // Several of these selectors appear in more than one rule (a shared type
    // rule and a layout rule). At least one declaration must set the height.
    for (const [name, pattern] of selectors) {
      const matches = chromeCss.match(new RegExp(pattern.source, 'g')) ?? [];
      assert.ok(matches.length > 0, `chrome rule ${name} exists`);
      const sized = matches.filter((rule) => /(?:min-height|height):\s*(?:4[4-9]|[5-9]\d|1\d\d)px/.test(rule));
      assert.ok(sized.length > 0, `${name} is at least 44px tall`);
    }
  });

  it('keeps a visible focus ring on the glass pills and buttons', () => {
    assert.match(chromeCss, /:focus-visible[\s\S]*?outline:\s*2px solid var\(--accent-bright\)/);
  });

  it('keeps decorative layers inert and clipped so they never take focus or overflow', () => {
    const atmosphere = read('src/app/_components/atmosphere.module.css');
    // The container is the contract: it is inert, clipped and paint-contained,
    // so every layer inside it inherits "cannot take focus, cannot overflow".
    const container = atmosphere.match(/\.atmosphere\s*\{[^}]*\}/);
    assert.ok(container, '.atmosphere rule exists');
    assert.match(container![0], /pointer-events:\s*none/);
    assert.match(container![0], /overflow:\s*hidden/);
    assert.match(container![0], /contain:\s*paint/);

    const layers = atmosphere.match(/\.fieldIndigo,[\s\S]*?\.grain\s*\{[^}]*\}/);
    assert.ok(layers, 'the shared layer rule exists');
    assert.match(layers![0], /position:\s*absolute/);

    const video = atmosphere.match(/\.video\s*\{[^}]*\}/);
    assert.ok(video, '.video rule exists');
    assert.match(video![0], /pointer-events:\s*none/);
    assert.match(video![0], /object-fit:\s*cover/);
  });

  it('marks the atmosphere and the owner video as decorative', () => {
    const atmosphere = read('src/app/_components/atmosphere.tsx');
    assert.match(atmosphere, /aria-hidden="true"/);
    assert.match(atmosphere, /tabIndex=\{-1\}/);
    assert.match(atmosphere, /disablePictureInPicture/);
  });
});

describe('no third-party media anywhere in the shipped sources', () => {
  const ALLOWED_HOST = /fonts\.(googleapis|gstatic)\.com/;
  const remoteMedia = /(?:https?:)?\/\/[A-Za-z0-9._-]+[^\s"'')]*\.(?:mp4|webm|mov|m4v|png|jpe?g|gif|webp|avif|svg)\b/gi;

  function filesUnder(dir: string, filter: RegExp): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') return [];
      const full = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(full, filter) : filter.test(full) ? [full] : [];
    });
  }

  it('has no remote media URL in source, tokens, public or the mission dashboard', () => {
    const files = [
      ...filesUnder(join(root, 'src'), /\.(ts|tsx|css)$/),
      ...filesUnder(join(root, 'public'), /\.(css|js|html)$/),
      ...filesUnder(join(root, 'mission-dashboard'), /\.(css|js|html)$/),
      ...filesUnder(join(root, 'design-system'), /\.(json|mjs)$/),
    ];
    assert.ok(files.length > 100, `scanned a real tree (${files.length} files)`);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(remoteMedia)) {
        assert.ok(ALLOWED_HOST.test(match[0]), `${file} references remote media: ${match[0]}`);
      }
    }
  });

  it('rejects remote paths and directory traversal in the owner-asset guard', () => {
    const atmosphere = read('src/app/_components/atmosphere.tsx');
    assert.match(atmosphere, /value\.includes\(':\/\/'\)/);
    assert.match(atmosphere, /value\.startsWith\('\/\/'\)\s*\|\|\s*value\.startsWith\('\\\\\\\\'\)/);
    assert.match(atmosphere, /value\.includes\('\.\.'\)/);
    assert.match(atmosphere, /enableVideo = false/, 'the owner video is OFF by default');
    assert.match(atmosphere, /AKBARAL_ENABLE_HERO_VIDEO/);
  });

  it('never renders a <video> unless the flag and a local path both hold', () => {
    const atmosphere = read('src/app/_components/atmosphere.tsx');
    const allowed = atmosphere.indexOf('const videoAllowed');
    const render = atmosphere.indexOf('{videoAllowed ?');
    assert.ok(allowed > 0 && render > allowed, 'the guard is computed before the element');
    assert.match(atmosphere, /enableVideo === true && isLocalOwnerAssetPath\(videoSrc\)/);
  });
});

describe('mission stack presence regression', () => {
  it('still ships every mission-stack file this redesign must not touch', () => {
    const required = [
      'src/mission/earning/model-layer.ts',
      'src/mission/earning/platform-adapters.ts',
      'src/mission/earning/discipline-engine.ts',
      'src/mission/earning/knowledge-catalog.ts',
      'src/mission/head-agent.ts',
      'src/mission/earning/github-bounty-parallel-executor.ts',
      'db/migrations-mission/0040_bounty_scale_executor.sql',
      'db/migrations-mission/0041_head_agent_control_plane.sql',
      'db/migrations-mission/0042_bug_bounty_agent_system.sql',
      'db/migrations-mission/0043_model_platform_discipline.sql',
      'db/migrations-mission/0044_vulnerability_knowledge_playbooks.sql',
      'src/app/(public)/team/page.tsx',
    ];
    for (const file of required) {
      assert.ok(existsSync(join(root, file)), `${file} is still present`);
    }
  });

  it('keeps the mission dashboard read-only behaviour markers intact', () => {
    assert.match(missionCss, /--good:/);
    assert.match(missionCss, /--warn:/);
    assert.match(missionCss, /--bad:/);
    // The dashboard is a read surface: no new interactive control was added.
    assert.doesNotMatch(missionCss, /cursor:\s*pointer;\s*pointer-events:\s*auto/);
  });
});
