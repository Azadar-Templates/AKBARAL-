import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * Task-result state separation contract (production incident regression).
 *
 * Incident: a completed MASTER workflow task showed the Workspace knowledge
 * panel's empty state ("Your knowledge base is empty…") in the position the
 * user expected the task result, while the actual model answer was not
 * rendered anywhere readable:
 *
 *   - the MASTER-form (workflow) path produces a finalResult DOCUMENT
 *     (executiveSummary + sections[].content) which the old renderer did
 *     not know -> generic "Completed" card, actual answer invisible;
 *   - Agent #001's real payload type is web_research_report; the renderer
 *     checked for a research_result type that does not exist;
 *   - the task detail screen showed raw JSON instead of the answer;
 *   - the knowledge panel — a TOOL — read as a "result area", so its
 *     empty state became the de-facto final result in the user's hunt.
 *
 * This suite locks the fix BEHAVIORALLY by executing the real renderer
 * functions extracted from public/app.js in a VM against a DOM stub, plus
 * static separation invariants:
 *
 *   1. Every completed payload shape renders its REAL content.
 *   2. No knowledge/tool state is ever rendered by the task-outcome
 *      renderer (the exact incident string, asserted).
 *   3. Non-terminal states never render as results or success.
 *   4. Failures render honest, actionable copy — never fake completion.
 *   5. The knowledge empty state exists ONLY inside the knowledge search
 *      tool and is explicitly scoped as informational-secondary.
 */

const appJs = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src', 'app', 'page.tsx'), 'utf8');

/** Extract a top-level `function name(…) {…}` from app.js by brace matching. */
function extractFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = appJs.indexOf(marker);
  assert.ok(start >= 0, `function ${name} must exist in app.js`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < appJs.length; i += 1) {
    const ch = appJs[i];
    if (ch === '{') {
      depth += 1;
      if (bodyStart < 0) bodyStart = i;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && bodyStart > 0) {
        return appJs.slice(start, i + 1);
      }
    }
  }
  throw new Error(`could not extract function ${name}`);
}

/** Build a DOM-stub context exposing the real renderer functions. */
function loadRenderers(): { renderTaskOutcome: (root: FakeRoot, input: unknown) => void; friendlyTaskError: (code?: string, message?: string) => { title: string } } {
  const source = [
    extractFunction('esc'),
    extractFunction('badge'),
    extractFunction('friendlyTaskError'),
    extractFunction('renderTaskOutcome'),
    'module.exports = { renderTaskOutcome, friendlyTaskError };',
  ].join('\n\n');
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, { module, console });
  return module.exports as unknown as {
    renderTaskOutcome: (root: FakeRoot, input: unknown) => void;
    friendlyTaskError: (code?: string, message?: string) => { title: string };
  };
}

class FakeRoot {
  innerHTML = '';
}

// The incident phrases — the knowledge tool's empty-state copy. Generic uses
// of the word "knowledge" (e.g. knowledge_search tool summaries) are NOT
// knowledge-state leaks and must stay allowed in result payloads.
const INCIDENT_STRING = 'knowledge base is empty';
const KNOWLEDGE_EMPTY_MARKERS = ['No documents indexed yet', 'knowledge base', 'indexed documents become searchable', 'Your knowledge base'];

function render(input: unknown): string {
  const { renderTaskOutcome } = loadRenderers();
  const root = new FakeRoot();
  renderTaskOutcome(root, input);
  return root.innerHTML;
}

function assertNoKnowledgeState(html: string, label: string): void {
  for (const marker of KNOWLEDGE_EMPTY_MARKERS) {
    assert.ok(!html.toLowerCase().includes(marker), `${label} must not contain knowledge state text ("${marker}")`);
  }
  assert.ok(!html.includes(INCIDENT_STRING), `${label} must never render the knowledge empty state`);
}

describe('task-result state separation (incident regression)', () => {
  it('MASTER workflow finalResult renders the executive summary and real section content', () => {
    const html = render({
      status: 'completed',
      payload: {
        title: 'MASTER AI result: analyse the market',
        goal: 'analyse the market',
        status: 'completed',
        mode: 'deterministic',
        executiveSummary: 'The bakery subscription market shows strong retention fundamentals.',
        sections: [
          {
            stepOrder: 1,
            agentSlug: 'research-researcher-002',
            specialization: 'Research / Research Analyst',
            status: 'completed',
            verified: true,
            verificationScore: 1,
            content: '## Market analysis\n\nRetention across artisan subscription pilots averaged 68%.',
          },
        ],
        nextSteps: ['Review findings'],
        credits: { consumed: 1, refunded: 0 },
      },
    });
    assert.ok(html.includes('Retention across artisan subscription pilots'), 'executive summary visible');
    assert.ok(html.includes('averaged 68%'), 'actual section content visible');
    assert.ok(html.includes('Research / Research Analyst'), 'specialist attribution visible');
    assertNoKnowledgeState(html, 'workflow finalResult rendering');
  });

  it('agent_result renders the model answer with verification meta', () => {
    const html = render({
      status: 'completed',
      payload: {
        type: 'agent_result',
        content: '## Specialist deliverable\n\nThe actual Gemini-generated answer.',
        model: 'gemini-3.8-flash',
        provider: 'google',
        latencyMs: 1234,
        verification: { passed: true, score: 1 },
      },
    });
    assert.ok(html.includes('The actual Gemini-generated answer.'), 'model answer visible');
    assert.ok(html.includes('gemini-3.8-flash'), 'model chip visible');
    assert.ok(html.includes('verification 100%'), 'verification chip visible');
    assertNoKnowledgeState(html, 'agent_result rendering');
  });

  it('web_research_report (Agent #001) renders the report summary and sources', () => {
    const html = render({
      status: 'completed',
      payload: {
        type: 'web_research_report',
        report: {
          query: 'market',
          summary: 'Verified research summary across 5 sources.',
          facts: [{ statement: 'Fact one', source: 'https://example.com/one' }],
          sources: [{ title: 'Example', url: 'https://example.com/one' }],
          verifiedSources: 3,
          durationMs: 900,
          provider: 'configurable-search-provider',
        },
      },
    });
    assert.ok(html.includes('Verified research summary'), 'report summary visible');
    assert.ok(html.includes('Fact one'), 'verified fact visible');
    assert.ok(html.includes('3 verified sources'), 'source count visible');
    assertNoKnowledgeState(html, 'web_research_report rendering');
  });

  it('a completed task with no content payload is stated honestly — never a knowledge state', () => {
    const html = render({ status: 'completed', payload: null });
    assert.ok(html.includes('Completed'), 'completion stated');
    assert.ok(html.includes('no result content was attached'), 'honest no-content statement');
    assertNoKnowledgeState(html, 'no-content completion rendering');
  });

  it('non-terminal execution states never render as results or success', () => {
    for (const status of ['running', 'queued', 'pending']) {
      const html = render({ status, payload: null });
      assert.ok(html.includes('still running'), `${status} renders as still-running`);
      assert.ok(!html.includes('Completed'), `${status} must not claim completion`);
      assertNoKnowledgeState(html, `${status} rendering`);
    }
  });

  it('failures render honest, actionable copy — never fake completion, never knowledge states', () => {
    const cases: Array<{ code?: string; message: string; expect: string }> = [
      { code: 'provider_not_configured', message: 'no provider available', expect: 'No AI provider configured' },
      { message: 'openai rejected the request credentials (HTTP 401)', expect: 'rejected the credentials' },
      { code: 'verification_failed', message: 'verification_failed: substance', expect: 'rejected by verification' },
    ];
    for (const item of cases) {
      const html = render({ status: 'failed', code: item.code, message: item.message });
      assert.ok(html.includes(item.expect), `honest title for ${item.code ?? item.message}: ${html.slice(0, 120)}`);
      assert.ok(!html.includes('Completed'), 'failure must not claim completion');
      assertNoKnowledgeState(html, 'failure rendering');
    }
  });

  it('the dead research_result branch is gone (Agent #001 uses web_research_report)', () => {
    assert.ok(!appJs.includes("payload.type === 'research_result'"), 'dead branch must not exist');
    assert.ok(appJs.includes("payload.type === 'web_research_report'"), 'real #001 type handled');
  });

  it('knowledge empty state exists ONLY in the knowledge search tool, scoped as secondary', () => {
    // Exactly one occurrence, inside the knowledge search panel renderer.
    const occurrences = appJs.split('No documents indexed yet').length - 1;
    assert.equal(occurrences, 1, 'knowledge empty state appears exactly once');
    const searchKnowledge = extractFunction('searchKnowledge');
    assert.ok(searchKnowledge.includes('No documents indexed yet'), 'it lives inside searchKnowledge only');

    // The task-outcome renderer region contains no knowledge state markers.
    const outcome = extractFunction('renderTaskOutcome');
    assertNoKnowledgeState(outcome, 'renderTaskOutcome source');

    // The knowledge panel is explicitly scoped as a tool in the markup.
    assert.ok(page.includes('Tool · searches documents you have indexed'), 'panel carries a tool-scope note');
    assert.ok(page.includes('Task results appear on the MASTER screen'), 'note points to the real result location');
    assert.ok(appJs.includes('Task results are shown on the MASTER screen'), 'empty state redirects to real results');
  });

  it('task detail renders through the shared outcome renderer and keeps raw JSON secondary', () => {
    const detailStart = appJs.indexOf('async function loadTaskDetail');
    const detailEnd = appJs.indexOf('function ', detailStart + 10);
    const detail = appJs.slice(detailStart, detailEnd > 0 ? detailEnd : undefined);
    assert.ok(detail.includes('renderTaskOutcome(outcomeRoot'), 'task detail uses the shared outcome renderer');
    assert.ok(detail.includes('Raw result data'), 'raw JSON remains available, collapsed');
    // In the rendered markup the outcome mount precedes the raw-JSON
    // disclosure, so the friendly answer is the primary view.
    assert.ok(detail.indexOf('id="task-outcome"') < detail.indexOf('Raw result data'), 'friendly view is primary, raw JSON secondary');
    assertNoKnowledgeState(detail, 'task detail rendering');
  });

  it('MASTER completion paths forward the real payloads to the outcome renderer', () => {
    // Workflow path forwards finalResult (the document with sections).
    const wf = appJs.slice(
      appJs.indexOf('async function loadWorkflowProgress'),
      appJs.indexOf('function renderPlan'),
    );
    assert.ok(wf.includes('renderMasterResult(true, parsedResult?.finalResult ?? parsedResult)'), 'workflow forwards finalResult');
    assert.ok(wf.includes('renderMasterResult(false'), 'workflow failure path renders honest failure');
    // Specialist path forwards the parsed execution output.
    const me = appJs.slice(
      appJs.indexOf('async function loadMasterExecution'),
      appJs.indexOf('async function showWorkflow'),
    );
    assert.ok(me.includes('renderMasterResult(true, parsedOutput)'), 'execution path forwards parsed output');
  });
});
