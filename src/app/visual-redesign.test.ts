import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('AKBARAL! visual redesign contracts', () => {
  it('uses the required green-led shared identity', () => {
    const tokens = read('design-system/tokens.json');
    const generated = read('public/tokens.css');
    const primitives = read('src/app/_components/ui/primitives.module.css');
    assert.match(tokens, /"accent": "#2f8348"/);
    assert.match(generated, /--accent: #2f8348/);
    assert.match(primitives, /var\(--accent\)/);
  });

  it('keeps application navigation intentional and names the workspace groups', () => {
    const shell = read('src/app/_components/app-shell.tsx');
    assert.match(shell, /PRIMARY MODES/);
    assert.match(shell, /WORKSPACE/);
    assert.match(shell, /ACCOUNT/);
    assert.doesNotMatch(shell, /Others|More/);
  });

  it('makes Agent Factory a real API-backed surface instead of a redirect', () => {
    const page = read('src/app/(public)/agent-factory/page.tsx');
    const config = read('next.config.mjs');
    assert.match(page, /\/api\/factory\/templates/);
    assert.match(page, /\/api\/factory\/agents\/from-template/);
    assert.match(page, /\/security/);
    assert.match(page, /\/benchmark/);
    assert.match(page, /\/versions/);
    assert.match(page, /\/status/);
    assert.doesNotMatch(page, /redirect\(/);
    assert.doesNotMatch(config, /['"]\/agent-factory['"][^\n]*destination/);
  });

  it('keeps the agent registry server-side searchable and paginated', () => {
    const page = read('src/app/_components/data-surfaces.tsx');
    assert.match(page, /q.*debouncedQuery|debouncedQuery.*q/s);
    assert.match(page, /category/);
    assert.match(page, /status/);
    assert.match(page, /offset/);
    assert.match(page, /limit/);
    assert.match(page, /Server-side search/);
  });

  it('covers redesigned public information routes and the honest mission boundary', () => {
    for (const route of ['about', 'contact', 'documentation', 'faq', 'features', 'feedback', 'privacy', 'security', 'terms']) {
      assert.match(read(`src/app/(public)/${route}/page.tsx`), /PublicInfoPage/);
    }
    assert.match(read('src/app/mission/page.tsx'), /separate owner mission service/);
  });
});
