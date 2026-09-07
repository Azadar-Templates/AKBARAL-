/**
 * Agent #001 — Web Research Agent.
 *
 * Real implementation, not a mock:
 *   - searchWeb(query)         HTTP request to a search endpoint (defaults to
 *                              DuckDuckGo HTML; can be overridden for a proxy
 *                              or a JSON search API via AKBARAL_SEARCH_ENDPOINT).
 *   - fetchPage(url)           HTTP GET the source URL (or a configured proxy).
 *   - extractText(html)        Transforms HTML into readable text.
 *   - createResearchReport()   Builds a structured research result with the
 *                              query, sources, facts, and verification notes.
 *
 * If the network is unavailable or a source refuses the request, the agent
 * records a real error instead of returning invented data; the orchestrator
 * then fails the task and refunds the credit.
 */

export interface SourceResult {
  title: string;
  url: string;
  description: string | null;
  fetchedAt: string;
}

export interface ResearchFact {
  text: string;
  sourceUrl: string | null;
}

export interface ResearchReport {
  query: string;
  summary: string;
  facts: ResearchFact[];
  sources: SourceResult[];
  verifiedSources: number;
  generatedAt: string;
  durationMs: number;
  provider: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

const DEFAULT_SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; AKBARALMasterAI/1.0; +https://akbaral.ai)';

function searchEndpoint(): string {
  return process.env.AKBARAL_SEARCH_ENDPOINT || DEFAULT_SEARCH_ENDPOINT;
}

function pageFetchBase(): string | undefined {
  return process.env.AKBARAL_PAGE_FETCH_ENDPOINT || undefined;
}

async function httpText(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

export function extractText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutStyles
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/div>/gi, ' ')
    .replace(/<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(withoutTags);
}

/**
 * Search DuckDuckGo HTML (or a JSON-returning search endpoint) for results.
 * The endpoint is configurable so production can use a private search API or a
 * compliant proxy without changing the agent code.
 */
export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  const endpoint = searchEndpoint();
  const url = new URL(endpoint);
  url.searchParams.set('q', query);

  const body = await httpText(url.toString());
  const contentType = body.trimStart().startsWith('{') ? 'json' : 'html';

  if (contentType === 'json') {
    return parseJsonResults(body, limit);
  }
  return parseHtmlResults(body, limit);
}

function parseHtmlResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const resultBlocks = html.split(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>/gi);
  // The first segment is the prelude and is not a result.
  for (const block of resultBlocks.slice(1)) {
    if (results.length >= limit) {
      break;
    }
    const match = block.match(
      /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const urlMatch = match ? match[1] : '';
    const titleMatch = match ? match[2] : '';
    if (!urlMatch || !titleMatch) {
      continue;
    }
    const descriptionMatch = block.match(
      /<a[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    results.push({
      title: extractText(titleMatch),
      url: normalizeSearchUrl(urlMatch),
      description: descriptionMatch ? extractText(descriptionMatch[1]) : '',
    });
  }
  return results;
}

function normalizeSearchUrl(raw: string): string {
  const value = decodeHtmlEntities(raw);
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  // DuckDuckGo redirect URLs look like /l/?uddg=encoded&rut=...
  const marker = 'uddg=';
  const index = value.indexOf(marker);
  if (index >= 0) {
    const after = value.slice(index + marker.length);
    const ampersand = after.indexOf('&');
    const encoded = ampersand >= 0 ? after.slice(0, ampersand) : after;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value;
}

function parseJsonResults(body: string, limit: number): WebSearchResult[] {
  const parsed = JSON.parse(body) as unknown;
  const items = Array.isArray(parsed) ? parsed : (parsed as { results?: unknown[] }).results ?? [];
  return items
    .slice(0, limit)
    .map((item) => {
      const record = item as { title?: string; url?: string; description?: string };
      const title = record.title ?? '';
      const url = record.url ?? '';
      const description = record.description ?? '';
      return {
        title: typeof title === 'string' ? title : String(title),
        url: typeof url === 'string' ? url : String(url),
        description: typeof description === 'string' ? description : String(description),
      };
    })
    .filter((item) => item.title.length > 0 && item.url.startsWith('http'));
}

/**
 * Fetch and extract the readable content of a source page.
 * Set AKBARAL_PAGE_FETCH_ENDPOINT to route through a compliant URL-fetch proxy.
 */
export async function fetchPage(sourceUrl: string): Promise<{ title: string; text: string }> {
  const base = pageFetchBase();
  const target = base
    ? new URL(base)
    : new URL(sourceUrl);
  if (base) {
    target.searchParams.set('url', sourceUrl);
  }

  const html = await httpText(target.toString(), 20_000);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: titleMatch ? extractText(titleMatch[1]) : '',
    text: extractText(html),
  };
}

export async function createResearchReport(
  query: string,
  maxSources = 5,
  maxFetches = 3,
): Promise<ResearchReport> {
  const startedAt = Date.now();

  const sourcesList = await searchWeb(query, maxSources);
  if (sourcesList.length === 0) {
    throw new Error(`no search results found for query "${query}"`);
  }

  const facts: ResearchFact[] = [];
  const fetchedSources: SourceResult[] = [];

  for (const source of sourcesList) {
    if (fetchedSources.length >= maxFetches) {
      break;
    }
    try {
      const page = await fetchPage(source.url);
      if (source.description) {
        facts.push({ text: source.description, sourceUrl: source.url });
      }
      const sentences = extractSentences(page.text).slice(0, 20);
      if (sentences.length > 0) {
        facts.push({ text: sentences.join(' '), sourceUrl: source.url });
      }
      fetchedSources.push({
        title: page.title || source.title,
        url: source.url,
        description: source.description || null,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Record attempted-but-unreachable sources as verification notes, not facts.
      fetchedSources.push({
        title: source.title,
        url: source.url,
        description: `source not reachable in this environment (${message})`,
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  if (fetchedSources.filter((source) => !source.description?.startsWith('source not reachable')).length === 0) {
    throw new Error(
      `could not fetch any source for "${query}"; network access to research providers may be unavailable`,
    );
  }

  const verifiedSources = fetchedSources.filter(
    (source) => !source.description?.startsWith('source not reachable'),
  ).length;

  const summary = summarize(query, facts, fetchedSources);

  return {
    query,
    summary,
    facts,
    sources: fetchedSources,
    verifiedSources,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    provider: searchEndpoint(),
  };
}

function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 600);
}

function summarize(query: string, facts: ResearchFact[], sources: SourceResult[]): string {
  const meaningful = facts
    .map((fact) => fact.text)
    .filter((text) => text.length > 0)
    .slice(0, 8);

  const sourceNames = sources
    .slice(0, 5)
    .map((source) => source.title)
    .filter(Boolean);

  const summaryFragments = [
    `Research summary for "${query}":`,
    '',
    ...(meaningful.length > 0 ? meaningful.map((fact) => `- ${fact}`) : ['- No extractable snippets were found.']),
    '',
    `Verified with ${sources.filter((source) => !source.description?.startsWith('source not reachable')).length} source(s) from ${sourceNames.length ? sourceNames.join(', ') : 'the search index'}.`,
  ];

  return summaryFragments.join('\n');
}
