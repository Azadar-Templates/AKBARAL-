'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Public agent directory — a real client for the public catalog API
 * (/api/public/agents, /api/public/agent-categories). Search, category
 * filter, pagination, and a detail panel; honest loading/error/empty
 * states throughout. Only platform registry agents are ever listed.
 */

interface PublicAgent {
  slug: string;
  name: string;
  specialization: string;
  description: string;
  category: string;
  categorySlug: string;
  version: string;
  status: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  tools: string[];
  workflow: string[];
  modelRequirements: string[];
  costEstimateCents: number;
}

interface Category {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  count: number;
}

const PAGE_SIZE = 24;

export function AgentsExplorer() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicAgent | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebounced(query);
      setOffset(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/agent-categories')
      .then((r) => (r.ok ? (r.json() as Promise<{ categories: Category[] }>) : Promise.reject(new Error('catalog unavailable'))))
      .then((data) => {
        if (!cancelled) setCategories(data.categories ?? []);
      })
      .catch(() => {
        /* category chips are progressive enhancement; list still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (debounced) params.set('q', debounced);
      if (category) params.set('category', category);
      const response = await fetch(`/api/public/agents?${params.toString()}`);
      if (!response.ok) throw new Error(`catalog request failed (${response.status})`);
      const data = (await response.json()) as { agents: PublicAgent[]; total: number };
      if (cancelledRef.current) return;
      setAgents(data.agents ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      if (!cancelledRef.current) {
        setError(e instanceof Error ? e.message : 'unexpected error');
        setAgents([]);
        setTotal(null);
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [debounced, category, offset]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = useMemo(() => (total === null ? 0 : Math.max(1, Math.ceil(total / PAGE_SIZE))), [total]);

  return (
    <div className="pk-page">
      <section className="pk-section" aria-label="Agent search">
        <div className="agx-controls">
          <input
            type="search"
            className="agx-search"
            placeholder="Search 4,001 specialists — e.g. seo, react, market research, contracts…"
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            aria-label="Search agents"
          />
          {categories.length > 0 && (
            <div className="agx-cats" role="group" aria-label="Filter by category">
              <button
                type="button"
                className={`agx-chip${category === '' ? ' agx-chip-on' : ''}`}
                onClick={() => { setCategory(''); setOffset(0); }}
              >
                All ({categories.reduce((n, c) => n + (c.count ?? 0), 0)})
              </button>
              {categories.slice(0, 14).map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className={`agx-chip${category === c.slug ? ' agx-chip-on' : ''}`}
                  onClick={() => { setCategory(category === c.slug ? '' : c.slug); setOffset(0); }}
                >
                  {c.icon ? `${c.icon} ` : ''}{c.name} ({c.count})
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {loading && <p className="agx-state" role="status">Loading agents…</p>}
      {!loading && error && (
        <p className="agx-state agx-error" role="alert">
          {error} — the catalog service may be restarting. Try again in a moment.
        </p>
      )}
      {!loading && !error && agents.length === 0 && (
        <p className="agx-state">
          No agents match {debounced ? `“${debounced}”` : 'this filter'}. Try a broader term —
          or ask MASTER directly: it selects specialists for you.
        </p>
      )}

      {!loading && !error && agents.length > 0 && (
        <>
          <p className="agx-count">{total} agent{total === 1 ? '' : 's'} · page {page} of {pages}</p>
          <div className="pk-grid pk-grid-3">
            {agents.map((a) => (
              <article key={a.slug} className="pk-card agx-card">
                <h3>
                  <button type="button" className="agx-name" onClick={() => setSelected(a)}>
                    {a.name}
                  </button>
                </h3>
                <p className="agx-cat">{a.category} · {a.specialization}</p>
                <p className="agx-desc">{a.description}</p>
                <p className="agx-meta">
                  {a.capabilities.slice(0, 3).map((c) => (
                    <span key={c} className="agx-tag">{c}</span>
                  ))}
                </p>
              </article>
            ))}
          </div>
          <div className="agx-pager">
            <button type="button" className="pk-btn pk-btn-ghost" disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              ← Previous
            </button>
            <span aria-live="polite">Page {page} / {pages}</span>
            <button type="button" className="pk-btn pk-btn-ghost" disabled={offset + PAGE_SIZE >= (total ?? 0)}
              onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next →
            </button>
          </div>
        </>
      )}

      {selected && (
        <div className="agx-modal" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="agx-modal-card">
            <div className="agx-modal-head">
              <div>
                <h3>{selected.name}</h3>
                <p className="agx-cat">{selected.category} · {selected.specialization} · v{selected.version}</p>
              </div>
              <button type="button" className="pk-btn pk-btn-ghost" onClick={() => setSelected(null)} aria-label="Close details">✕</button>
            </div>
            <p className="agx-desc">{selected.description}</p>
            <dl className="agx-facts">
              <div><dt>Capabilities</dt><dd>{selected.capabilities.join(', ') || '—'}</dd></div>
              <div><dt>Inputs</dt><dd>{selected.inputs.join(', ') || '—'}</dd></div>
              <div><dt>Outputs</dt><dd>{selected.outputs.join(', ') || '—'}</dd></div>
              <div><dt>Tools</dt><dd>{selected.tools.join(', ') || '—'}</dd></div>
              <div><dt>Models</dt><dd>{selected.modelRequirements.join(', ') || 'any available'}</dd></div>
              <div><dt>Workflow</dt><dd><ol className="agx-flow">{selected.workflow.map((s, i) => <li key={i}>{s}</li>)}</ol></dd></div>
            </dl>
            <a className="pk-btn pk-btn-primary" href="/#/register">Create an account to run this agent</a>
            <p className="agx-note">Execution requires an account — it runs with real tools, credits and verification.</p>
          </div>
        </div>
      )}
    </div>
  );
}
