import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Responsive correctness contract.
 *
 * The width matrix is NOT a screenshot diff and NOT a hand-written fixture: it
 * mounts the real page components in jsdom at each width (scripts/responsive/)
 * and reads the delivered DOM back. The CSS assertions below guard the rules
 * that no single width can prove on its own — box sizing, min-width leaks,
 * long-text wrapping, tap targets and viewport-relative heights.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const WIDTHS = [320, 375, 414, 640, 768, 1024, 1280, 1440, 1920];

const sessionCss = read('src/app/_components/workbench/workbench-shell.module.css');
const shellCss = read('src/app/_components/app-shell.module.css');
const landingCss = read('src/app/_components/landing-reset.module.css');
const dashboardCss = read('src/app/dashboard/dashboard.module.css');
const ui = read('src/app/_components/workbench/workbench-shell.tsx');

type MatrixResult = {
  widths: number[];
  pages: string[];
  problems: Array<{ kind: string; page: string; width: number; detail: string }>;
  states: Array<{ width: number; rail: string; panel: string; hasIconStrip: boolean; railHidden: boolean; hasRailToggle: boolean }>;
};

/** One subprocess renders every page at every width; all cases read its result. */
let cached: MatrixResult | null = null;
function matrix(): MatrixResult {
  if (cached) return cached;
  const out = execFileSync(
    'npx',
    ['tsx', '--import', './scripts/responsive/register-hooks.mjs', 'scripts/responsive-matrix.mjs',
      '--skip-cascade', '--json', `--widths=${WIDTHS.join(',')}`],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cached = JSON.parse(out) as MatrixResult;
  return cached;
}

describe('responsive width matrix — every page, every width', () => {
  it('renders every registered page at all nine widths without a layout problem', () => {
    const result = matrix();
    assert.deepEqual(result.widths, WIDTHS);
    assert.ok(result.pages.length >= 13, `expected the whole surface area, got ${result.pages.length} pages`);
    assert.deepEqual(result.problems, [], `layout problems: ${JSON.stringify(result.problems, null, 2)}`);
  });

  it('keeps both side panes closed below 1024px so the centre owns the width', () => {
    for (const state of matrix().states.filter((s) => s.width < 1024)) {
      assert.equal(state.rail, 'drawer-closed', `rail at ${state.width}px`);
      assert.equal(state.railHidden, true, `closed rail must leave the grid at ${state.width}px`);
      assert.equal(state.panel, 'closed', `panel at ${state.width}px`);
      assert.equal(state.hasRailToggle, true, `no way to open the rail at ${state.width}px`);
    }
  });

  it('shows the 56px icon rail between 1024px and 1279px', () => {
    for (const state of matrix().states.filter((s) => s.width >= 1024 && s.width < 1280)) {
      assert.equal(state.rail, 'icons', `rail at ${state.width}px`);
      assert.equal(state.hasIconStrip, true, `icon strip at ${state.width}px`);
      assert.equal(state.panel, 'closed', `panel at ${state.width}px`);
    }
  });

  it('expands the rail from 1280px up', () => {
    const wide = matrix().states.filter((s) => s.width >= 1280);
    assert.ok(wide.length >= 3, 'the matrix must cover 1280, 1440 and 1920');
    for (const state of wide) {
      assert.equal(state.rail, 'expanded', `rail at ${state.width}px`);
      assert.equal(state.hasIconStrip, false, `no icon strip at ${state.width}px`);
    }
  });
});

describe('responsive CSS invariants', () => {
  it('declares the documented grid bands from two custom properties', () => {
    assert.match(sessionCss, /\.session\{[^}]*--ak-rail:280px;--ak-panel:320px/);
    assert.match(sessionCss, /grid-template-columns:var\(--ak-rail\) minmax\(0,1fr\) var\(--ak-panel\)/);
    assert.match(sessionCss, /\.session\[data-rail='icons'\]\{--ak-rail:56px\}/);
    assert.match(sessionCss, /\.session\[data-rail='drawer-closed'\],\.session\[data-rail='drawer-open'\]\{--ak-rail:0px\}/);
    assert.match(sessionCss, /@media\(max-width:1023px\)\{\.session\{--ak-rail:0px\}/);
    assert.match(sessionCss, /@media\(max-width:1279px\)\{\.session\{--ak-panel:0px\}/);
    assert.match(sessionCss, /@media\(min-width:1600px\)\{\.session\{width:min\(1400px,100%\);margin-inline:auto/);
  });

  it('matches the rail mode in the component to the same three bands', () => {
    assert.match(ui, /window\.matchMedia\('\(min-width: 1280px\)'\)/);
    assert.match(ui, /window\.matchMedia\('\(min-width: 1024px\)'\)/);
    assert.match(ui, /expanded\.matches \? 'expanded' : icons\.matches \? 'icons' : 'drawer'/);
    assert.match(ui, /railMode === 'expanded' \? 'expanded'/);
  });

  it('box-sizes and width-caps every descendant of every shell', () => {
    for (const [name, css] of [['session', sessionCss], ['app shell', shellCss], ['landing', landingCss], ['dashboard', dashboardCss]] as const) {
      assert.match(css, /\*\{box-sizing:border-box;max-width:100%\}/, `${name} caps descendant width`);
    }
    assert.match(shellCss, /:where\(img,video,iframe,canvas,svg\)\{max-width:100%;height:auto\}/);
  });

  it('wraps long titles, URLs and unbroken tokens everywhere text can land', () => {
    assert.match(sessionCss, /\.session :where\([^)]*\)\{overflow-wrap:anywhere\}/);
    assert.match(shellCss, /\.shell :where\([^)]*\)\{overflow-wrap:anywhere\}/);
    assert.match(landingCss, /\.page :where\([^)]*\)\{overflow-wrap:anywhere\}/);
    assert.match(dashboardCss, /\.page :where\([^)]*\)\{overflow-wrap:anywhere\}/);
  });

  it('leaks no intrinsic minimum through a flex or grid child', () => {
    // Every grid/flex track that can hold text is declared minmax(0,…) or 1fr
    // guarded by min-width:0 — a bare `1fr` next to long text is the classic
    // source of horizontal scroll.
    const bare = [...sessionCss.matchAll(/grid-template-columns:([^;}]+)/g)]
      .map((m) => m[1]!)
      .filter((value) => /(^|[\s,(])1fr/.test(value) && !value.includes('minmax(0'));
    assert.deepEqual(bare, [], `unguarded 1fr tracks: ${bare.join(' | ')}`);
  });

  it('never pins a layout box to a fixed viewport-sized height', () => {
    // `height:<n>px` is only legitimate for icons and fixed chrome rows; any
    // full-height surface must use dvh/min-height so phone browser chrome and
    // the on-screen keyboard cannot clip it.
    for (const css of [sessionCss, shellCss, landingCss, dashboardCss]) {
      assert.ok(!/[^-]height:100vh/.test(css), 'a 100vh height survived; use 100dvh');
    }
    assert.match(sessionCss, /max-height:30dvh/);
    assert.match(shellCss, /\.shellFocus\{[^}]*height:100dvh/);
  });

  it('keeps every session control at a 44px tap target', () => {
    for (const klass of ['railOpenButton,.panelToggle', 'railIconButton', 'newSessionButton', 'panelTab', 'panelClose', 'railCollapse']) {
      const pattern = new RegExp(`\\.${klass.replace(/[.,]/g, (c) => (c === ',' ? ',' : '\\.'))}\\{[^}]*(min-height:44px|height:44px)`);
      assert.match(sessionCss, pattern, `${klass} tap target`);
    }
    assert.match(sessionCss, /\.backLink\{min-width:44px;min-height:44px/);
    assert.match(sessionCss, /\.newBelowToast\{[^}]*min-height:44px/);
  });

  it('docks the composer with safe-area padding and a phone-sized textarea', () => {
    assert.match(sessionCss, /\.composerDock\{[^}]*padding-bottom:env\(safe-area-inset-bottom,0px\)/);
    assert.match(sessionCss, /@media\(max-width:639px\)\{[^@]*\.composer textarea\{min-height:44px\}/);
    assert.match(sessionCss, /\.composer textarea\{[^}]*max-height:30dvh/);
    assert.match(ui, /const floor = window\.innerWidth < 640 \? 44 : 96/);
  });

  it('scrolls the output tabs sideways instead of wrapping them', () => {
    assert.match(sessionCss, /\.panelTabs\{[^}]*flex-wrap:nowrap;overflow-x:auto/);
    assert.match(sessionCss, /\.panelTab\{flex:0 0 auto;white-space:nowrap\}/);
  });

  it('sizes drawers and the scrim to the documented values', () => {
    assert.match(sessionCss, /\.sessionRail\[data-mode='drawer-open'\]\{position:absolute[^}]*width:min\(280px,85vw\)/);
    assert.match(sessionCss, /@media\(max-width:1279px\)\{[^@]*width:min\(320px,90vw\)/);
    assert.match(sessionCss, /\.sessionScrim\{[^}]*background:rgba\(0,0,0,\.6\)/);
    assert.match(sessionCss, /@media\(min-width:768px\)\{\.sessionScrim\{backdrop-filter:blur\(2px\)\}\}/);
  });

  it('collapses every page grid to one column below 768px and two above', () => {
    assert.match(shellCss, /@media\(max-width:767px\)\{\.grid2,\.grid3,\.grid4\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(shellCss, /@media\(min-width:768px\) and \(max-width:1023px\)\{\.grid3,\.grid4\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
    assert.match(dashboardCss, /@media\(max-width:767px\)\{\.metrics\{grid-template-columns:minmax\(0,1fr\)\}\}/);
    assert.match(landingCss, /@media\(max-width:1023px\) and \(min-width:640px\)\{\.grid3,\.steps\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
    assert.match(landingCss, /@media\(max-width:639px\)\{\.grid3,\.steps\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  });

  it('never hides a navigation destination to make room', () => {
    assert.ok(!/\.page nav a:last-child\{display:none\}/.test(dashboardCss), 'a nav link was hidden instead of wrapped');
    assert.match(dashboardCss, /\.page nav\{display:flex;gap:8px;flex-wrap:wrap;min-width:0\}/);
  });

  it('moves the global nav drawer to the documented 1024px line', () => {
    assert.match(shellCss, /@media\(max-width:1023px\)\{\.shell,\.shellCollapsed\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.ok(!/@media\(max-width:1040px\)/.test(shellCss), 'the old 1040px drawer line is gone');
  });

  it('gives wide desktops a centred measure with gutters', () => {
    assert.match(shellCss, /@media\(min-width:1600px\)\{\.content\{padding:clamp\(18px,3vw,32px\) 24px\}[^@]*\.contentFlush\{padding:0 24px\}\}/);
  });
});

describe('responsive harness integrity', () => {
  it('registers every real page in the matrix, not a curated subset', () => {
    const harness = read('scripts/responsive/render-page.mjs');
    const routes = readdirSync(join(root, 'src/app'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('('))
      .map((entry) => entry.name)
      .filter((name) => ['chat', 'work', 'dashboard', 'settings', 'files', 'projects', 'images', 'agents', 'automations', 'billing', 'help', 'pricing'].includes(name));
    for (const route of routes) assert.ok(harness.includes(`'/${route}'`), `/${route} is audited`);
    assert.ok(harness.includes("'/':"), 'the landing page is audited');
  });

  it('mounts real components rather than fixture markup', () => {
    const harness = read('scripts/responsive/render-page.mjs');
    assert.match(harness, /createRoot/);
    assert.match(harness, /import\(specifier\)/);
    assert.ok(!/innerHTML = ['"`]</.test(harness), 'no hand-written DOM in the harness');
  });
});
