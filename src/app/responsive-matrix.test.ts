import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const widths = '320,375,414,640,768,1024,1280,1440,1920';
const sessionCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');

describe('responsive width matrix — every page, every width', () => {
  it('runs the shipped layout model at all nine required widths', () => {
    const output = execFileSync('node', ['scripts/responsive-layout-audit.mjs', `--widths=${widths}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.match(output, /54 route\/width checks passed/);
    assert.doesNotMatch(output, /FAIL|overflow|finding/i);
  });

  it('keeps the green chat contract covered by the same matrix', () => {
    assert.match(sessionCss, /\.sessionMain\s*\{[\s\S]*?display:\s*flex/);
    assert.match(sessionCss, /\.messages\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:auto/);
    assert.match(sessionCss, /\.composerDock\s*\{[^}]*flex:\s*0 0 auto/);
    assert.match(sessionCss, /@media\(max-width:639px\)/);
    assert.match(sessionCss, /@media\s*\(min-width:\s*1600px\)/);
  });
});
