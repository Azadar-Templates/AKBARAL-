import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const reset = read('src/app/app-reset.css');
const shell = read('src/app/_components/app-shell.tsx');
const shellCss = read('src/app/_components/app-shell.module.css');
const workbench = read('src/app/_components/workbench/workbench-shell.tsx');
const workbenchCss = read('src/app/_components/workbench/workbench-shell.module.css');
const chat = workbench.slice(workbench.indexOf("if (mode === 'chat') return"), workbench.indexOf('  return <AppShell title={title} viewportLocked>'));
const center = chat.slice(chat.indexOf('className={styles.sessionMain}'), chat.indexOf('{/* 3 — RIGHT'));

function block(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, 'g'))];
  const match = matches.at(-1);
  assert.ok(match?.index !== undefined, `missing CSS selector ${selector}`);
  const start = match.index + match[0].lastIndexOf(selector);
  const end = source.indexOf('}', start);
  assert.ok(end >= 0, `unterminated CSS selector ${selector}`);
  return source.slice(start, end + 1);
}

describe('authenticated Chat/Work scroll containment', () => {
  it('locks only the authenticated workbench routes, never the public document', () => {
    assert.match(shell, /viewportLocked\?: boolean/);
    assert.match(shell, /akbaral-viewport-locked/);
    assert.match(workbench, /if \(mode === 'chat'\) return <AppShell title=\{title\} viewportLocked>/);
    assert.match(workbench, /return <AppShell title=\{title\} viewportLocked>/);
    assert.match(reset, /html:has\(body \.akbaral-viewport-locked\)[\s\S]*?height:\s*100%[\s\S]*?overflow:\s*hidden/);
    assert.doesNotMatch(reset, /^html,?\s*body\s*\{/m);
    assert.doesNotMatch(shell, /viewportLocked\s*=\{true\}/);
  });

  it('bounds the full topbar, body row, sidebar, content and session chain', () => {
    assert.match(shellCss, /\.shellViewportLocked\s*\{[\s\S]*?height:\s*100dvh[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden/);
    for (const selector of ['.shellViewportLocked .sidebar', '.shellViewportLocked .main', '.shellViewportLocked .content', '.shellViewportLocked .contentInner']) {
      const css = block(shellCss, selector);
      assert.match(css, /min-height:\s*0/);
      assert.match(css, /overflow:\s*hidden/);
    }
    const topbar = block(shellCss, '.shellViewportLocked .topbar');
    assert.match(topbar, /overflow:\s*hidden/);
    const containment = workbenchCss.slice(workbenchCss.lastIndexOf('/* Scroll containment release'));
    for (const selector of ['.session', '.sessionMain', '.sessionRail', '.sessionPanel']) {
      assert.match(containment, new RegExp(`${selector.replace('.', '\\.')},?[\\s\\S]*?min-height:\\s*0`), `${selector} has a bounded height`);
      assert.match(containment, new RegExp(`${selector.replace('.', '\\.')},?[\\s\\S]*?overflow:\\s*hidden`), `${selector} is not a scroll owner`);
    }
  });

  it('has exactly one primary Chat center scroll owner and keeps the composer visible', () => {
    const thread = block(workbenchCss, '.messages');
    assert.match(thread, /flex:\s*1 1 auto/);
    assert.match(thread, /min-height:\s*0/);
    assert.match(thread, /overflow-y:\s*auto/);
    assert.match(thread, /overscroll-behavior:\s*contain/);
    const composer = block(workbenchCss, '.composerDock');
    assert.match(composer, /flex:\s*0 0 auto/);
    assert.match(composer, /flex-shrink:\s*0/);
    assert.doesNotMatch(composer, /overflow-y:\s*(?:auto|scroll)/);
    assert.equal((center.match(/styles\.messages\}/g) ?? []).length, 1, 'thread has one DOM scroll owner');
    assert.ok(center.indexOf('styles.messages') < center.indexOf('styles.composerDock'), 'thread precedes composer');
    assert.ok(center.indexOf('styles.composerDock') < center.indexOf('styles.disclosure'), 'composer disclosure stays at bottom');
    assert.match(workbenchCss, /\.sessionMain\s*>\s*\.messages[\s\S]*?\.sessionMain\s*>\s*\.composerDock/);
  });

  it('permits only the independent session rail and output panel to scroll', () => {
    const rail = block(workbenchCss, '.sessionRail .railList');
    const panel = block(workbenchCss, '.sessionPanel .panelBody');
    assert.match(rail, /overflow-y:\s*auto/);
    assert.match(panel, /overflow-y:\s*auto/);
    assert.match(rail, /overscroll-behavior:\s*contain/);
    assert.match(panel, /overscroll-behavior:\s*contain/);
    assert.match(workbenchCss, /:global\(\.akbaral-viewport-locked\) \.contentInner > \.page/);
  });

  it('keeps chronological DOM order and the non-shrinking composer controls', () => {
    const threadIndex = center.indexOf('styles.messages');
    const composerIndex = center.indexOf('className={styles.composerDock}');
    assert.ok(threadIndex >= 0 && composerIndex > threadIndex);
    assert.match(center, /className=\{styles\.composerMeta\}/);
    assert.match(center, /className=\{styles\.modelLabel\}/);
    assert.match(center, /className=\{styles\.disclosure\}/);
    assert.match(workbenchCss, /\.composerMeta\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });

  it('runs the nine-width route matrix with explicit no-page-scroll assertions', () => {
    const output = execFileSync('node', ['scripts/responsive-layout-audit.mjs'], { cwd: root, encoding: 'utf8' });
    for (const route of ['/chat', '/work']) {
      for (const width of [320, 375, 414, 640, 768, 1024, 1280, 1440, 1920]) {
        assert.match(output, new RegExp(`PASS ${route}\\s+${width}px[^"]*pageScroll=contained`));
      }
    }
    assert.match(output, /landingScroll=allowed/);
  });

  it('does not turn the public landing document into a fixed viewport', () => {
    assert.doesNotMatch(reset, /html:has\(body \.akbaral-viewport-locked\)[\s\S]*?\.page/);
    assert.match(reset, /html,body\{[^}]*min-height:100%/);
    assert.match(reset, /body\{[^}]*overflow-x:hidden/);
    assert.match(shellCss, /\.shellViewportLocked/);
  });
});
