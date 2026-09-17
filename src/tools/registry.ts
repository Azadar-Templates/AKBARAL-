import fs from 'node:fs';
import path from 'node:path';
import { searchKnowledge, db } from '../db';
import { assertPublicHttpUrl } from '../security/ssrf';
import { searchWeb, fetchPage } from '../agents';
import { extractTextFromFile, UPLOAD_DIR, resolveStoredFilePath } from '../services/files';
import { externalHttpRequest } from '../integrations/http';

/**
 * AKBARAL! Tool System.
 *
 * Every agent references tools by key. Tools are the only way an agent touches
 * the outside world: network, files, repository, knowledge store or a media
 * provider. Each implementation is real, guards its own privileges and fails
 * honestly when a credential is not configured.
 */

export type ToolContext = {
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  executionId?: string | null;
};

export type ToolResult = {
  ok: boolean;
  tool: string;
  content: string;
  data?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  code?: string;
  requiredCredential?: string;
};

export type ToolInput = Record<string, unknown>;

function ok(tool: string, content: string, data: Record<string, unknown>): ToolResult {
  return { ok: true, tool, content, data, durationMs: 0 };
}

function fail(tool: string, content: string, code: string, data: Record<string, unknown> = {}): ToolResult {
  return { ok: false, tool, content, error: content, code, durationMs: 0, ...data };
}

function requireStringInput(input: ToolInput, key: string, tool: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolInputError(tool, `${key} must be a non-empty string`);
  }
  return value.trim();
}

class ToolInputError extends Error {
  readonly code = 'tool_input_error';
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(message);
    this.tool = tool;
  }
}

function assertPublicUrl(raw: string): string {
  return assertPublicHttpUrl(raw);
}

function readRepoFile(repoRoot: string, requestedPath: string): string {
  const resolvedRoot = path.resolve(repoRoot);
  const target = path.resolve(repoRoot, requestedPath);
  if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) {
    throw new Error(`code_repository_read refused: path escapes repository root`);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`code_repository_read refused: file "${requestedPath}" not found`);
  }
  const ext = path.extname(target).toLowerCase();
  const binary = ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mov', '.mp3', '.wav', '.pdf', '.zip'].includes(ext);
  if (binary) {
    throw new Error(`code_repository_read refused: binary file "${requestedPath}" is not supported`);
  }
  return fs.readFileSync(target, 'utf8').slice(0, 200_000);
}

function findUploadedFile(fileIdOrKey: string, userId: string): string {
  const row = db.get<{ storage_key: string }>(
    `SELECT storage_key FROM files
     WHERE user_id = ? AND (id = ? OR storage_key = ? OR original_name = ?)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, fileIdOrKey, fileIdOrKey, fileIdOrKey],
  );
  if (row?.storage_key) {
    try {
      const fsPath = resolveStoredFilePath(row.storage_key);
      if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
        return fsPath;
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'file_parse_text refused: invalid storage key');
    }
  }
  throw new Error(`file_parse_text refused: file "${fileIdOrKey}" not found or not owned by the current user`);
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return lines.join('\n');
}

function requireCredential(envKey: string, tool: string): void {
  if (!process.env[envKey]) {
    const error = new Error(`${tool} requires credential environment variable ${envKey}`) as Error & { code?: string; requiredCredential?: string };
    error.code = 'provider_not_configured';
    error.requiredCredential = envKey;
    throw error;
  }
}

async function externalJsonRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }): Promise<string> {
  // External HTTP errors are redacted by the shared helper; provider body text
  // is never echoed back to clients or logs.
  const result = await externalHttpRequest('external', url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
    timeoutMs: 45_000,
  });
  return result.text;
}

function requireTwoCredentials(envKeys: string[], tool: string): void {
  for (const envKey of envKeys) {
    if (!process.env[envKey]) {
      const error = new Error(`${tool} requires credential environment variable ${envKey}`) as Error & { code?: string; requiredCredential?: string };
      error.code = 'provider_not_configured';
      error.requiredCredential = envKey;
      throw error;
    }
  }
}

export const TOOL_HANDLERS: Record<string, (input: ToolInput, ctx: ToolContext) => Promise<ToolResult>> = {
  async web_search(input) {
    try {
      const query = requireStringInput(input, 'query', 'web_search');
      const limit = Math.min(typeof input.limit === 'number' ? Math.floor(input.limit) : 5, 10);
      const results = await searchWeb(query, limit);
      return ok('web_search', JSON.stringify(results, null, 2), { results, provider: 'configurable-search-provider' });
    } catch (error) {
      return fail('web_search', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async page_fetch(input) {
    try {
      const rawUrl = requireStringInput(input, 'url', 'page_fetch');
      const url = assertPublicUrl(rawUrl);
      const page = await fetchPage(url);
      return ok('page_fetch', page.text, { title: page.title, url, contentPreview: page.text.slice(0, 4000) });
    } catch (error) {
      return fail('page_fetch', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async code_repository_read(input) {
    try {
      const requestedPath = requireStringInput(input, 'path', 'code_repository_read');
      const repoRoot = path.resolve(process.cwd());
      const content = readRepoFile(repoRoot, requestedPath);
      return ok('code_repository_read', content, { path: requestedPath, bytes: content.length });
    } catch (error) {
      return fail('code_repository_read', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async file_parse_text(input, ctx) {
    try {
      const fileKey = requireStringInput(input, 'file', 'file_parse_text');
      const filePath = findUploadedFile(fileKey, ctx.userId);
      const mime = typeof input.mime_type === 'string' ? input.mime_type : 'text/plain';
      const text = extractTextFromFile(filePath, mime);
      return ok('file_parse_text', text, { bytes: text.length, parsed: true });
    } catch (error) {
      return fail('file_parse_text', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async knowledge_search(input, ctx) {
    try {
      if (!ctx.userId) {
        return fail('knowledge_search', 'user context missing', 'tool_failed');
      }
      const query = requireStringInput(input, 'query', 'knowledge_search');
      const limit = Math.min(typeof input.limit === 'number' ? Math.floor(input.limit) : 20, 50);
      const rows = searchKnowledge(ctx.userId, query, limit);
      return ok('knowledge_search', JSON.stringify(rows, null, 2), { results: rows });
    } catch (error) {
      return fail('knowledge_search', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async excel_build(input) {
    try {
      const rows = Array.isArray(input.rows) ? (input.rows as Array<Record<string, unknown>>) : [];
      if (rows.length === 0) {
        return fail('excel_build', 'rows must be a non-empty array', 'tool_input_error');
      }
      const csv = toCsv(rows);
      const filename = `akbaral-export-${Date.now()}.csv`;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), csv, 'utf8');
      return ok('excel_build', csv, { rows: rows.length, filename, format: 'csv', message: 'CSV export written to uploads directory' });
    } catch (error) {
      return fail('excel_build', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async image_render(input) {
    try {
      requireCredential('OPENAI_API_KEY', 'image_render');
      const prompt = requireStringInput(input, 'prompt', 'image_render');
      const text = await externalJsonRequest('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024' }),
      });
      const json = JSON.parse(text) as { data?: Array<{ url?: string; b64_json?: string }> };
      const item = json.data?.[0];
      if (!item) {
        return fail('image_render', 'image provider returned no result', 'tool_failed');
      }
      if (item.b64_json) {
        return ok('image_render', 'image rendered', { format: 'b64_json', bytes: item.b64_json.length, model: 'dall-e-3' });
      }
      return ok('image_render', item.url ?? '', { format: 'url', url: item.url, model: 'dall-e-3' });
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'provider_not_configured') {
        return fail('image_render', error instanceof Error ? error.message : String(error), 'provider_not_configured', {
          requiredCredential: (error as Error & { requiredCredential?: string }).requiredCredential,
        });
      }
      return fail('image_render', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async youtube_publish(input) {
    try {
      requireCredential('YOUTUBE_ACCESS_TOKEN', 'youtube_publish');
      const title = requireStringInput(input, 'title', 'youtube_publish');
      const text = await externalJsonRequest('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=media&part=snippet', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { title, categoryId: '22' } }),
      });
      return ok('youtube_publish', text, { provider: 'youtube-data-v3' });
    } catch (error) {
      return failExternal('youtube_publish', error);
    }
  },

  async instagram_publish(input) {
    try {
      requireCredential('INSTAGRAM_ACCESS_TOKEN', 'instagram_publish');
      const imageUrl = requireStringInput(input, 'image_url', 'instagram_publish');
      const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
      const urn = new URL('https://graph.facebook.com/v21.0/me/media');
      urn.searchParams.set('image_url', imageUrl);
      urn.searchParams.set('access_token', accessToken ?? '');
      const text = await externalJsonRequest(urn.toString(), { method: 'POST' });
      return ok('instagram_publish', text, { provider: 'instagram-graph-api' });
    } catch (error) {
      return failExternal('instagram_publish', error);
    }
  },

  async x_post(input) {
    try {
      requireCredential('X_BEARER_TOKEN', 'x_post');
      const text = requireStringInput(input, 'text', 'x_post');
      const body = await externalJsonRequest('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return ok('x_post', body, { provider: 'x-api-v2' });
    } catch (error) {
      return failExternal('x_post', error);
    }
  },

  async shopify_product(input) {
    try {
      requireTwoCredentials(['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'], 'shopify_product');
      const title = requireStringInput(input, 'title', 'shopify_product');
      const domain = process.env.SHOPIFY_STORE_DOMAIN ?? '';
      const body = await externalJsonRequest(`https://${domain}/admin/api/2024-01/products.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: { title, status: 'draft' } }),
      });
      return ok('shopify_product', body, { provider: 'shopify-admin-api' });
    } catch (error) {
      return failExternal('shopify_product', error);
    }
  },

  async twilio_message(input) {
    try {
      requireTwoCredentials(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], 'twilio_message');
      const to = requireStringInput(input, 'to', 'twilio_message');
      const from = requireStringInput(input, 'from', 'twilio_message');
      const bodyText = requireStringInput(input, 'body', 'twilio_message');
      const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const body = new URLSearchParams({ To: to, From: from, Body: bodyText });
      const text = await externalJsonRequest(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      return ok('twilio_message', text, { provider: 'twilio-api' });
    } catch (error) {
      return failExternal('twilio_message', error);
    }
  },

  async stripe_payment(input) {
    try {
      requireCredential('STRIPE_SECRET_KEY', 'stripe_payment');
      const amount = requireStringInput(input, 'amount', 'stripe_payment');
      const currency = typeof input.currency === 'string' ? input.currency : 'usd';
      const body = new URLSearchParams({ amount, currency });
      const text = await externalJsonRequest('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      return ok('stripe_payment', text, { provider: 'stripe-api' });
    } catch (error) {
      return failExternal('stripe_payment', error);
    }
  },

  async http_request(input) {
    try {
      const rawUrl = requireStringInput(input, 'url', 'http_request');
      const url = assertPublicUrl(rawUrl);
      const method = input.method === 'POST' ? 'POST' : 'GET';
      if (method === 'GET' && input.body !== undefined) {
        return fail('http_request', 'GET requests must not include a body', 'tool_input_error');
      }
      const headers: Record<string, string> = { Accept: 'application/json' };
      let body: string | undefined;
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(input.body ?? {});
      }
      const result = await externalHttpRequest('tool:http_request', url, {
        method,
        headers,
        body,
        timeoutMs: 20_000,
      });
      const text = result.text.slice(0, 100_000);
      return ok('http_request', text, {
        status: result.status,
        bytes: result.text.length,
        truncated: result.text.length > 100_000,
        json: result.json,
      });
    } catch (error) {
      if (error instanceof ToolInputError) {
        return fail('http_request', error.message, 'tool_input_error');
      }
      return fail('http_request', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async json_transform(input) {
    try {
      const data = input.data;
      if (data === undefined || data === null) {
        return fail('json_transform', 'data is required', 'tool_input_error');
      }
      let working: unknown = data;
      if (typeof input.pick === 'string' && input.pick.trim().length > 0) {
        for (const segment of input.pick.split('.').map((part) => part.trim()).filter(Boolean)) {
          if (working && typeof working === 'object' && segment in (working as Record<string, unknown>)) {
            working = (working as Record<string, unknown>)[segment];
          } else {
            return fail('json_transform', `pick path segment "${segment}" not found`, 'tool_input_error');
          }
        }
      }
      if (Array.isArray(working)) {
        const offset = Math.max(0, typeof input.offset === 'number' ? Math.floor(input.offset) : 0);
        const limit = Math.min(Math.max(0, typeof input.limit === 'number' ? Math.floor(input.limit) : working.length), 500);
        const sliced = working.slice(offset, offset + limit);
        return ok('json_transform', JSON.stringify(sliced, null, 2), {
          total: working.length,
          offset,
          returned: sliced.length,
          data: sliced,
        });
      }
      return ok('json_transform', JSON.stringify(working, null, 2), { total: 1, returned: 1, data: working });
    } catch (error) {
      if (error instanceof ToolInputError) {
        return fail('json_transform', error.message, 'tool_input_error');
      }
      return fail('json_transform', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async text_analyze(input) {
    try {
      const text = requireStringInput(input, 'text', 'text_analyze');
      const words = text.split(/\s+/).filter(Boolean);
      const sentences = text.split(/[.!?]+\s*/).filter((sentence) => sentence.trim().length > 0);
      const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
        'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that',
        'as', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very', 'can', 'will', 'just',
      ]);
      const frequencies = new Map<string, number>();
      for (const raw of words) {
        const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (word.length < 3 || stopWords.has(word) || /^\d+$/.test(word)) {
          continue;
        }
        frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
      }
      const topKeywords = [...frequencies.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 15)
        .map(([word, count]) => ({ word, count }));
      return ok('text_analyze', JSON.stringify(topKeywords, null, 2), {
        characters: text.length,
        words: words.length,
        sentences: sentences.length,
        uniqueWords: frequencies.size,
        readingTimeMinutes: Math.max(1, Math.round(words.length / 200)),
        topKeywords,
      });
    } catch (error) {
      if (error instanceof ToolInputError) {
        return fail('text_analyze', error.message, 'tool_input_error');
      }
      return fail('text_analyze', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async csv_parse(input) {
    try {
      const csv = requireStringInput(input, 'csv', 'csv_parse');
      const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        return fail('csv_parse', 'csv is empty', 'tool_input_error');
      }
      const parseCsvLine = (line: string): string[] => {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let index = 0; index < line.length; index += 1) {
          const char = line[index];
          if (inQuotes) {
            if (char === '"' && line[index + 1] === '"') {
              current += '"';
              index += 1;
            } else if (char === '"') {
              inQuotes = false;
            } else {
              current += char;
            }
          } else if (char === '"') {
            inQuotes = true;
          } else if (char === ',') {
            values.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current);
        return values;
      };
      const headers = parseCsvLine(lines[0]).map((header, index) => header.trim() || `column_${index + 1}`);
      const limit = Math.min(Math.max(0, typeof input.limit === 'number' ? Math.floor(input.limit) : lines.length - 1), 1000);
      const rows = lines.slice(1, 1 + limit).map((line) => {
        const values = parseCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = (values[index] ?? '').trim();
        });
        return row;
      });
      return ok('csv_parse', JSON.stringify(rows, null, 2), {
        headers,
        totalRows: lines.length - 1,
        returnedRows: rows.length,
        rows,
      });
    } catch (error) {
      if (error instanceof ToolInputError) {
        return fail('csv_parse', error.message, 'tool_input_error');
      }
      return fail('csv_parse', error instanceof Error ? error.message : String(error), 'tool_failed');
    }
  },

  async maps_place(input) {
    try {
      requireCredential('GOOGLE_API_KEY', 'maps_place');
      const query = requireStringInput(input, 'query', 'maps_place');
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      url.searchParams.set('query', query);
      url.searchParams.set('key', process.env.GOOGLE_API_KEY ?? '');
      const text = await externalJsonRequest(url.toString(), {});
      return ok('maps_place', text, { provider: 'google-places-api' });
    } catch (error) {
      return failExternal('maps_place', error);
    }
  },
};

function failExternal(tool: string, error: unknown): ToolResult {
  const typer = error as Error & { code?: string; requiredCredential?: string };
  if (typer.code === 'provider_not_configured') {
    return fail(tool, typer.message, 'provider_not_configured', { requiredCredential: typer.requiredCredential });
  }
  return fail(tool, error instanceof Error ? error.message : String(error), 'tool_failed');
}

export async function runTool(key: string, input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[key];
  if (!handler) {
    return fail(key, `tool "${key}" is not registered or not implemented`, 'tool_not_found');
  }
  const started = Date.now();
  try {
    const result = await handler(input, ctx);
    return { ...result, durationMs: Date.now() - started };
  } catch (error) {
    if (error instanceof ToolInputError) {
      return fail(key, error.message, 'tool_input_error', { durationMs: Date.now() - started });
    }
    return fail(key, error instanceof Error ? error.message : String(error), 'tool_failed', { durationMs: Date.now() - started });
  }
}

export function listImplementedTools(): string[] {
  return Object.keys(TOOL_HANDLERS);
}
