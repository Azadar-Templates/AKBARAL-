import http from 'node:http';

/**
 * Local OpenAI-compatible chat-completions fixture used only by tests.
 *
 * Speaks the same `/v1/chat/completions` protocol as the real OpenAI adapter
 * (the provider under test points at it via OPENAI_BASE_URL). Responses are
 * routed by the system prompt so the full MASTER AI pipeline — goal analysis,
 * agent execution, verification rubric, synthesis — can be exercised
 * end-to-end without external credentials:
 *
 *  - goal analyzer prompt      -> valid analysis JSON
 *  - verifier prompt           -> pass verdict JSON
 *  - synthesizer prompt        -> summary JSON
 *  - anything else (agents)    -> substantive specialist markdown
 *
 * `mode` switches behavior for negative tests.
 */

export interface ModelFixtureServer {
  baseUrl: string;
  port: number;
  requests: Array<{ path: string; body: Record<string, unknown> }>;
  setMode(mode: ModelFixtureMode): void;
  close(): Promise<void>;
}

export type ModelFixtureMode =
  | 'ok' // everything succeeds
  | 'invalid_json' // analysis returns unparseable text
  | 'thin_output' // agents return too-thin output (must fail verification)
  | 'refusal' // agents return a bare refusal (must fail verification)
  | 'fabricate' // agents return invented citations (must fail verification)
  | 'down'; // 500 for every request

export async function startModelFixture(mode: ModelFixtureMode = 'ok'): Promise<ModelFixtureServer> {
  let currentMode: ModelFixtureMode = mode;
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];

  const substantiveAnswer = `## Specialist deliverable

This specialist analysis addresses the requested goal directly and completely.

### Findings
- The request has been analyzed against the declared specialist contract.
- Key considerations, tradeoffs and risks are documented below.
- Every claim in this section is derived from the agent instructions.

### Recommendation
Proceed with the structured plan above. The deliverable includes the analysis,
the recommended approach and concrete next steps for the operator.

### Next steps
1. Review the findings section.
2. Approve or adjust the recommended approach.
3. Schedule the follow-up work.`;

  const thinAnswer = 'Short answer: yes.';
  const refusalAnswer = "I cannot help with that request.";
  const fabricateAnswer = `## Research findings

According to a 2025 study by Acme Research Institute, 87% of teams adopt this.

- [Source: https://example.com/fake-report-2025]
- More invented statistics from https://stats.example.net/ totally-made-up

### Conclusion
This content invents citations that no source tool produced.`;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      requests.push({ path: url.pathname, body });

      const respond = (payload: Record<string, unknown>): void => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl-fixture',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: payload.content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 200 },
          }),
        );
      };

      if (currentMode === 'down') {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'fixture provider down' } }));
        return;
      }

      const messages = Array.isArray(body.messages) ? (body.messages as Array<{ role: string; content: string }>) : [];
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      const user = messages.find((message) => message.role === 'user')?.content ?? '';

      if (system.includes('goal analyzer')) {
        if (currentMode === 'invalid_json') {
          respond({ content: 'Sure! Here is my analysis: the goal looks like a website project.' });
          return;
        }
        respond({
          content: JSON.stringify({
            intents: [
              {
                key: 'website-llm',
                label: 'Build a marketing website',
                categorySlug: 'web-development',
                roleKeys: ['strategist', 'builder', 'validator'],
                confidence: 0.92,
              },
              {
                key: 'invalid-intent',
                label: 'Invented category',
                categorySlug: 'not-a-real-category',
                roleKeys: ['wizard'],
                confidence: 0.99,
              },
            ],
            deliverables: ['website', 'content plan'],
            constraints: ['responsive'],
            complexity: 'standard',
            clarifyingQuestions: [],
          }),
        });
        return;
      }

      if (system.includes('output verifier')) {
        respond({ content: JSON.stringify({ verdict: 'pass', issues: [] }) });
        return;
      }

      if (system.includes('synthesizer')) {
        respond({
          content: JSON.stringify({
            executiveSummary: 'The specialist team produced a verified website strategy, implementation plan and validation report.',
            nextSteps: ['Approve the strategy', 'Start the build phase'],
          }),
        });
        return;
      }

      // Specialist agent execution.
      if (currentMode === 'thin_output') {
        respond({ content: thinAnswer });
        return;
      }
      if (currentMode === 'refusal') {
        respond({ content: refusalAnswer });
        return;
      }
      if (currentMode === 'fabricate') {
        respond({ content: fabricateAnswer });
        return;
      }
      // Make the substantive answer visibly address the goal terms.
      const goalSnippet = user.includes('USER GOAL') ? ` for the stated goal` : '';
      respond({ content: `${substantiveAnswer}${goalSnippet}` });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    requests,
    setMode(next: ModelFixtureMode) {
      currentMode = next;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
        server.on('error', reject);
      });
    },
  };
}
