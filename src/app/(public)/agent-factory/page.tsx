'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, apiJson, shellStyles as s } from '../../_components/app-shell';

type Template = {
  slug?: string;
  name?: string;
  specialization?: string;
  description?: string;
  category_id?: string | null;
  system_instructions?: string;
  capabilities?: string[];
  tool_permissions?: string[];
  verification_rules?: string[];
};
type FactoryResult = { agentId?: string; slug?: string; version?: string; status?: string; marketplaceStatus?: string };
type ReviewFinding = { severity?: string; title?: string; detail?: string; recommendation?: string };
type Version = { version?: string; changelog?: string; createdAt?: string; status?: string };

type LoadState<T> = { data: T | null; loading: boolean; error: string };

function readError(error: unknown) { return error instanceof Error ? error.message : 'Factory data is temporarily unavailable.'; }

export default function AgentFactoryPage() {
  const [query, setQuery] = useState('');
  const [templatesState, setTemplatesState] = useState<LoadState<Template[]>>({ data: null, loading: true, error: '' });
  const [selected, setSelected] = useState<Template | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<FactoryResult | null>(null);
  const [review, setReview] = useState<ReviewFinding[] | null>(null);
  const [benchmark, setBenchmark] = useState<Record<string, unknown> | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const loadTemplates = async (term = query) => {
    setTemplatesState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (term.trim()) params.set('q', term.trim());
      const payload = await apiJson<{ templates?: Template[] }>(`/api/factory/templates?${params.toString()}`);
      setTemplatesState({ data: payload.templates ?? [], loading: false, error: '' });
    } catch (error) {
      setTemplatesState({ data: null, loading: false, error: readError(error) });
    }
  };

  useEffect(() => { void loadTemplates(''); }, []);

  const selectTemplate = async (template: Template) => {
    if (!template.slug) return;
    setSelected(template); setResult(null); setReview(null); setBenchmark(null); setVersions(null); setActionMessage(''); setActionError('');
    setForm({ name: template.name ? `${template.name} (custom)` : '', description: template.description ?? '' });
    setDetailLoading(true);
    try {
      const payload = await apiJson<{ template?: Template }>(`/api/factory/templates/${encodeURIComponent(template.slug)}`);
      const detail = payload.template ?? template;
      setSelected(detail);
      setForm({ name: detail.name ?? '', description: detail.description ?? '' });
    } catch (error) { setActionError(readError(error)); }
    finally { setDetailLoading(false); }
  };

  const createFromTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected?.slug) return;
    setCreating(true); setActionMessage(''); setActionError('');
    try {
      const payload = await apiJson<{ agent?: FactoryResult }>('/api/factory/agents/from-template', { method: 'POST', body: JSON.stringify({ template_slug: selected.slug, name: form.name.trim() || undefined, description: form.description.trim() || undefined }) });
      setResult(payload.agent ?? null);
      setActionMessage('Agent created through the authenticated factory contract. Review its state below.');
    } catch (error) { setActionError(readError(error)); }
    finally { setCreating(false); }
  };

  const loadReview = async (kind: 'security' | 'benchmark' | 'versions') => {
    if (!result?.slug) return;
    setActionError(''); setActionMessage('');
    try {
      if (kind === 'security') { const data = await apiJson<{ findings?: ReviewFinding[] }>(`/api/factory/agents/${encodeURIComponent(result.slug)}/security`); setReview(data.findings ?? []); }
      if (kind === 'benchmark') { const data = await apiJson<{ benchmark?: Record<string, unknown> }>(`/api/factory/agents/${encodeURIComponent(result.slug)}/benchmark`); setBenchmark(data.benchmark ?? null); }
      if (kind === 'versions') { const data = await apiJson<{ versions?: Version[] }>(`/api/factory/agents/${encodeURIComponent(result.slug)}/versions`); setVersions(data.versions ?? []); }
    } catch (error) { setActionError(readError(error)); }
  };

  const setStatus = async (status: string) => {
    if (!result?.slug) return;
    setActionError(''); setActionMessage('');
    try { const data = await apiJson<{ agent?: FactoryResult }>(`/api/factory/agents/${encodeURIComponent(result.slug)}/status`, { method: 'POST', body: JSON.stringify({ status }) }); setResult(data.agent ?? result); setActionMessage(`Factory status updated to ${status}.`); }
    catch (error) { setActionError(readError(error)); }
  };

  const categoryLabel = useMemo(() => selected?.category_id ? `Category ${selected.category_id}` : 'Registry template', [selected]);

  return <AppShell title="Agent Factory">
    <div className={s.factoryPage}>
      <div className={s.pageHead}><div><span className={s.eyebrow}>Agent Factory</span><h2>Build the specialist the work calls for.</h2><p>Start from a registered template, customize only what you own, then inspect security, benchmark, versions, and lifecycle state through the real factory APIs.</p></div><button className={s.secondaryButton} type="button" onClick={() => void loadTemplates()}>Refresh templates</button></div>
      <div className={s.factoryLayout}>
        <section className={s.factoryCatalog} aria-labelledby="factory-catalog-title"><div className={s.factorySectionHead}><div><h3 id="factory-catalog-title">Template catalog</h3><p>Platform registry agents available as starting points.</p></div><form className={s.factorySearch} onSubmit={(event) => { event.preventDefault(); void loadTemplates(); }}><input type="search" aria-label="Search factory templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} /><button className={s.ghostButton} type="submit">Search</button></form></div>{templatesState.loading ? <div className={s.empty}><h3>Loading templates…</h3><p>Reading the authenticated factory catalog.</p></div> : templatesState.error ? <div className={s.empty}><h3>Templates unavailable</h3><p>{templatesState.error}</p><button className={s.secondaryButton} type="button" onClick={() => void loadTemplates()}>Retry</button></div> : <div className={s.templateGrid}>{templatesState.data?.map((template) => <button className={`${s.templateCard} ${selected?.slug === template.slug ? s.templateSelected : ''}`} type="button" key={template.slug} onClick={() => void selectTemplate(template)}><span className={s.templateIcon}>{(template.name || 'A').slice(0, 1)}</span><span><b>{template.name || template.slug}</b><small>{template.specialization || 'Registered specialization'}</small></span><span className={s.templateArrow}>→</span></button>)}</div>}</section>
        <aside className={s.factoryBuilder} aria-labelledby="factory-builder-title"><span className={s.eyebrow}>Configure</span><h3 id="factory-builder-title">{selected?.name || 'Choose a template'}</h3>{selected ? <><p className={s.factoryDescription}>{selected.description || 'This template has no description.'}</p><span className={s.badge}>{categoryLabel}</span><form className={s.factoryForm} onSubmit={createFromTemplate}><label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} required /></label><div className={s.factoryTruth}><b>Inherited from the selected template</b><span>Capabilities: {selected.capabilities?.length ?? 'configured by template'}</span><span>Tool permissions: {selected.tool_permissions?.length ?? 'configured by template'}</span><span>Verification rules: {selected.verification_rules?.length ?? 'configured by template'}</span></div><button className={s.primaryButton} type="submit" disabled={creating || detailLoading}>{creating ? 'Creating…' : 'Create from template'}</button></form></> : <div className={s.empty}><h3>Choose a starting point.</h3><p>The factory will load the complete template before allowing creation. No agent is created by browsing.</p></div>}{actionError ? <p className={s.factoryError} role="alert">{actionError}</p> : null}{actionMessage ? <p className={s.factorySuccess} role="status">{actionMessage}</p> : null}</aside>
      </div>
      {result?.slug ? <section className={s.factoryResult} aria-labelledby="factory-result-title"><div className={s.factoryResultHead}><div><span className={s.eyebrow}>Created agent</span><h3 id="factory-result-title">{result.slug}</h3><p>Version {result.version || 'returned by factory'} · status {result.status || 'returned by factory'}</p></div><label className={s.statusControl}>Lifecycle status<select value={result.status || ''} onChange={(event) => void setStatus(event.target.value)}><option value="draft">draft</option><option value="active">active</option><option value="paused">paused</option></select></label></div><div className={s.factoryActions}><button className={s.ghostButton} type="button" onClick={() => void loadReview('security')}>Security review</button><button className={s.ghostButton} type="button" onClick={() => void loadReview('benchmark')}>Load benchmark</button><button className={s.ghostButton} type="button" onClick={() => void loadReview('versions')}>View versions</button></div>{review ? <div className={s.factorySubpanel}><h4>Security findings</h4>{review.length ? review.map((finding, index) => <article key={`${finding.title}-${index}`} className={s.finding} data-severity={finding.severity}><b>{finding.severity || 'finding'} · {finding.title}</b><p>{finding.detail}</p><small>{finding.recommendation}</small></article>) : <p className={s.muted}>No findings returned.</p>}</div> : null}{benchmark ? <div className={s.factorySubpanel}><h4>Benchmark response</h4><pre>{JSON.stringify(benchmark, null, 2)}</pre></div> : null}{versions ? <div className={s.factorySubpanel}><h4>Versions</h4>{versions.length ? versions.map((version) => <div className={s.versionRow} key={version.version}><b>{version.version}</b><span>{version.status || 'returned'}</span><small>{version.changelog || 'No changelog returned.'}</small></div>) : <p className={s.muted}>No versions returned.</p>}</div> : null}</section> : null}
    </div>
  </AppShell>;
}
