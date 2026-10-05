import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contract suite for the five arena-parity features.
 *
 * These assert the SHIPPED wiring: the history rail reads the real history
 * endpoint, attachments are gated on catalog capability, the Work tool log is
 * fed from persisted execution logs only, the model picker is catalog-driven,
 * and the starter chips only prefill.
 */
const root = process.cwd();
const ui = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const css = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const chatRoute = readFileSync(join(root, 'src/routes/chat.ts'), 'utf8');
const masterRoute = readFileSync(join(root, 'src/routes/master.ts'), 'utf8');

describe('feature 1 — chat history rail', () => {
  it('reads rows only from the authenticated history endpoint', () => {
    assert.match(ui, /apiJson<ConversationsPayload>\(`\/api\/chat\$\{query\.trim\(\) \? `\?q=\$\{encodeURIComponent\(query\.trim\(\)\)\}` : ''\}`\)/);
    assert.ok(!/const SAMPLE_CONVERSATIONS|placeholderConversations|demoChats/.test(ui), 'no seeded or sample conversations');
  });

  it('resumes a conversation into the existing thread', () => {
    assert.match(ui, /apiJson<ConversationPayload>\(`\/api\/chat\/\$\{encodeURIComponent\(id\)\}`\)/);
    assert.match(ui, /setConversationId\(payload\.conversation\?\.id \?\? id\)/);
  });

  it('deletes through the real endpoint behind a confirm, and restores on failure', () => {
    assert.match(ui, /window\.confirm\('Delete this conversation\? This cannot be undone\.'\)/);
    assert.match(ui, /apiJson\(`\/api\/chat\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'DELETE' \}\)/);
    assert.match(ui, /setConversations\(previous\)/);
  });

  it('is collapsed by default and keyboard operable', () => {
    assert.match(ui, /const \[historyOpen, setHistoryOpen\] = useState\(false\)/);
    assert.match(ui, /aria-expanded=\{historyOpen\}/);
    assert.match(ui, /aria-controls="chat-history-panel"/);
    assert.match(css, /\.historyToggle\{[^}]*min-height:44px/);
  });

  it('shows an honest empty state and refreshes after a chat completes', () => {
    assert.match(ui, /No chats yet\./);
    assert.match(ui, /No chats match that search\./);
    assert.match(ui, /void loadConversations\(historyQuery\);/);
  });

  it('server supports parameterised ?q= search over the caller rows only', () => {
    assert.match(chatRoute, /const query = typeof req\.query\.q === 'string'/);
    assert.match(chatRoute, /WHERE user_id = \?\s*\n\s*AND \(title LIKE \? ESCAPE/);
    assert.match(chatRoute, /function escapeLike/);
  });
});

describe('feature 2 — honest chat attachments', () => {
  it('accepts owner-verified attachment ids on the stream', () => {
    assert.match(chatRoute, /body\.attachment_file_ids/);
    assert.match(chatRoute, /SELECT id, original_name, mime_type, size_bytes FROM files\s*\n\s*WHERE user_id = \?/);
    assert.match(chatRoute, /throw new HttpError\(404, 'attachment files not found', 'not_found'\)/);
  });

  it('refuses silently-dropped files: verbatim provider code plus machine reason', () => {
    assert.match(chatRoute, /code: 'provider_not_configured'/);
    assert.match(chatRoute, /reason: 'model_does_not_support_attachments'/);
  });

  it('derives capability from the catalog, never a hardcoded list', () => {
    assert.match(chatRoute, /spec\.capabilities\.includes\('vision'\) \|\| spec\.modality === 'multimodal' \|\| spec\.modality === 'image'/);
    assert.match(chatRoute, /router\.get\('\/attachment-support'/);
    const supportIndex = chatRoute.indexOf("router.get('/attachment-support'");
    const paramIndex = chatRoute.indexOf("router.get('/:id'");
    assert.ok(supportIndex > -1 && paramIndex > -1 && supportIndex < paramIndex, 'literal route precedes /:id');
  });

  it('names what was actually included on the stream', () => {
    assert.match(chatRoute, /type: 'attachment'/);
    assert.match(chatRoute, /message: `attachment count: \$\{attachments\.resolved\.length\}`/);
    assert.match(chatRoute, /delivery: 'extracted_text'/);
    assert.match(chatRoute, /delivery: 'metadata_only'/);
  });

  it('disables the composer upload with the real reason when unsupported', () => {
    assert.match(ui, /const attachDisabledReason = activeSupport && !activeSupport\.supportsAttachments \? activeSupport\.detail : undefined/);
    assert.match(ui, /<button className=\{styles\.uploadButton\} type="button" disabled title=\{attachDisabledReason\}/);
    assert.match(ui, /id="composer-attach-reason"/);
  });

  it('keeps the existing upload endpoint and 25 MB cap', () => {
    assert.match(ui, /file\.size > 25 \* 1024 \* 1024/);
    assert.match(ui, /\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/files/);
  });
});

describe('feature 3 — real tool activity log', () => {
  it('reads persisted tool logs for the workflow, owner-scoped', () => {
    assert.match(masterRoute, /FROM agent_execution_logs l/);
    assert.match(masterRoute, /WHERE l\.type = 'tool'/);
    assert.match(masterRoute, /workflow not found/);
  });

  it('keeps provider_not_configured verbatim with the exact env key', () => {
    assert.match(masterRoute, /requiredEnvKey: typeof data\.requiredCredential === 'string'/);
    assert.match(masterRoute, /const code = typeof data\.code === 'string' \? data\.code : null/);
    assert.match(ui, /\{event\.code \? <code>\{event\.code\}<\/code> : null\}/);
    assert.match(ui, /set \{event\.requiredEnvKey\}/);
  });

  it('renders nothing when no tool ran and never fabricates rows', () => {
    assert.match(ui, /No tool has run yet\. Rows appear only when a tool genuinely runs\./);
    assert.ok(!/Running bash|Searching the web/.test(ui), 'no synthetic activity strings');
    assert.match(ui, /function eventAsTools/);
  });

  it('autoscrolls the append-only log', () => {
    assert.match(ui, /list\.scrollTop = list\.scrollHeight/);
    assert.match(css, /\.toolList\{[^}]*overflow:auto/);
  });
});

describe('feature 4 — truthful model picker', () => {
  it('has no Gemini-only client filter', () => {
    assert.ok(!/provider === 'google'/.test(ui));
    assert.ok(!/\/gemini\/i\.test/.test(ui));
  });

  it('disables unavailable models and names the required credential', () => {
    assert.match(ui, /disabled=\{!item\.available\}/);
    assert.match(ui, /requires \$\{model\.requiredEnvKey \?\? 'provider credential'\}/);
  });

  it('prints catalog cost and latency, or unknown — never an estimate', () => {
    assert.match(ui, /function costPer1k/);
    assert.match(ui, /return 'unknown'/);
    assert.match(ui, /function latencyLabel/);
    assert.ok(!/estimated|approx\. cost/i.test(ui));
  });
});

describe('feature 5 — starter prompts and AI disclosure', () => {
  it('ships AKBARAL-authored chips that only prefill the composer', () => {
    for (const prompt of ['Write a landing page', 'Explain my error', 'Plan a side-project', 'Summarize an article', 'Draft a proposal']) {
      assert.ok(ui.includes(`'${prompt}'`), `${prompt} chip exists`);
    }
    assert.match(ui, /onClick=\{\(\) => setChatInput\(prompt\)\}/);
    const chip = ui.slice(ui.indexOf('STARTER_PROMPTS.map'), ui.indexOf('STARTER_PROMPTS.map') + 220);
    assert.ok(!/sendChat|onSubmit/.test(chip), 'chips never send');
  });

  it('renders the disclosure with original copy linking /privacy, dismissible per session', () => {
    assert.match(ui, /AI can make mistakes\. Verify important information\./);
    assert.match(ui, /<a href="\/privacy">Privacy<\/a>/);
    assert.match(ui, /window\.sessionStorage\.setItem\(DISCLOSURE_KEY, '1'\)/);
  });

  it('keeps every new control at 44px and inside 320px', () => {
    for (const rule of [/\.starterChip\{[^}]*min-height:44px/, /\.disclosure button\{[^}]*min-height:44px/, /\.historyDeleteButton\{[^}]*min-height:44px/, /\.historyOpenButton\{[^}]*min-height:44px/]) {
      assert.match(css, rule);
    }
    assert.match(css, /\.historySearch input\{[^}]*min-width:0/);
  });
});
