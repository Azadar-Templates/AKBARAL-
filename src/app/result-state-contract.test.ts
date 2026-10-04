import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workbench = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const workCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const dataSurfaces = readFileSync(join(root, 'src/app/_components/data-surfaces.tsx'), 'utf8');
const masterRoute = readFileSync(join(root, 'src/routes/master.ts'), 'utf8');
const chatRoute = readFileSync(join(root, 'src/routes/chat.ts'), 'utf8');

describe('typed result-state separation contract', () => {
  it('Task renders only real artifact state in the preview rail', () => {
    assert.match(workbench, /artifact \? \(artifactIsHtml/);
    assert.match(workbench, /<pre>\{artifactText\}<\/pre>/);
    assert.match(workbench, /No artifact yet\./);
    assert.match(workbench, /Your completed Work output appears here/);
    assert.doesNotMatch(workbench, /knowledge base is empty|No knowledge results|Your knowledge base/i);
  });

  it('HTML artifacts are sandboxed and text artifacts wrap safely', () => {
    assert.match(workbench, /<iframe title="Sandboxed Work artifact" sandbox=""/);
    assert.match(workbench, /Content-Security-Policy/);
    assert.match(workCss, /previewBox pre\{margin:0;white-space:pre-wrap;word-break:break-word/);
    assert.match(workCss, /overflow:auto/);
  });

  it('export is authenticated and server-owned, never a fake client artifact', () => {
    assert.match(workbench, /\/api\/master\/\$\{encodeURIComponent\(workflowId\)\}\/export/);
    assert.match(workbench, /credentials: 'same-origin'/);
    assert.match(masterRoute, /content-type', 'application\/zip'/);
    assert.match(masterRoute, /workflow\.result_json/);
  });

  it('Chat and Task failures remain honest and credit-safe', () => {
    assert.match(workbench, /Chat never deducts Work task credits/);
    assert.match(workbench, /Credits are consumed only on success — failures refund automatically/);
    assert.match(chatRoute, /No task credit was deducted/);
    assert.match(workbench, /refund/i);
    assert.doesNotMatch(workbench, /fake completion|demo result/i);
  });

  it('non-result pages use honest empty states for real data lists', () => {
    for (const text of ['No files yet.', 'No images yet.', 'No projects yet.', 'No automations yet.', 'No invoices yet.', 'No payments yet.']) {
      assert.ok(dataSurfaces.includes(text), `${text} exists`);
    }
    assert.doesNotMatch(dataSurfaces, /mock row|placeholder row|fake preview/i);
  });

  it('result UI source contains no private identifiers or forbidden reference strings', () => {
    const source = [workbench, workCss, dataSurfaces].join('\n');
    assert.doesNotMatch(source, /ZA141251SA/);
    assert.doesNotMatch(source, /Atlas|WorkOS|Slack|use\.ai|ChatGPT/i);
  });
});
