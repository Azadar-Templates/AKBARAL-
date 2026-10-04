'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AKBARAL_PLANS, PRICING_NOTE } from '../_lib/pricing';
import { AppShell, apiJson, clearStoredTokens, shellStyles as s, storedRefreshToken } from './app-shell';

type DashboardData = {
  user?: { email?: string; name?: string | null; role?: string; status?: string };
  credits?: { available?: number; unlimited?: boolean };
  cycleResetAt?: string;
  chats?: Array<{ id?: string; title?: string; model?: string; updatedAt?: string }>;
  plan?: { name?: string; priceCents?: number; currency?: string } | null;
  tasks?: { recent?: Array<{ id?: string; title?: string; status?: string; createdAt?: string; creditsConsumed?: number }>; counts?: Record<string, number> };
  billing?: { invoices?: Array<{ id?: string; number?: string; amountCents?: number; currency?: string; status?: string }>; payments?: Array<{ id?: string; amountCents?: number; provider?: string; status?: string }> };
  sessions?: Array<{ id?: string; lastSeenAt?: string | null; ipAddress?: string | null; userAgent?: string | null }>;
};

type Project = { id?: string; name?: string; slug?: string; description?: string | null; status?: string | null; updated_at?: string; created_at?: string };
type ProjectDetail = { project?: Project; files?: AssetFile[]; tasks?: Array<Record<string, unknown>>; workflows?: Array<Record<string, unknown>> };
type AssetFile = { id?: string; original_name?: string; originalName?: string; name?: string; mime_type?: string; mimeType?: string; kind?: string; size_bytes?: number; sizeBytes?: number; created_at?: string; createdAt?: string; project_id?: string };
type ProjectsPayload = { projects?: Project[] };
type AgentsPayload = { agents?: Agent[]; total?: number; results?: Agent[] };
type CategoriesPayload = { total?: number; categories?: Array<{ slug?: string; name?: string; count?: number }> };
type Agent = { id?: string; slug?: string; name?: string; description?: string; category?: string; categorySlug?: string; status?: string };
type AutomationsPayload = { automations?: Automation[] };
type Automation = { id?: string; name?: string; description?: string | null; status?: string; nextRunAt?: string | null; updatedAt?: string };
type BillingAccount = { subscription?: Record<string, unknown> | null; entitlements?: Record<string, unknown> | null; trial?: Record<string, unknown> | null; invoices?: Array<Record<string, unknown>>; payments?: Array<Record<string, unknown>>; unlimited?: boolean };

function useData<T>(path: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError('');
    try { setData(await apiJson<T>(path)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Data is temporarily unavailable.'); }
    finally { setLoading(false); }
  }, [enabled, path]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}

function StateBlock({ loading, error, onRetry }: { loading: boolean; error: string; onRetry?: () => void }) {
  if (loading) return <div className={s.empty}><h3>Loading real data…</h3><p>AKBARAL! is asking the authenticated API for this page.</p></div>;
  if (error) return <div className={s.empty}><h3>Data unavailable</h3><p>{error}</p>{onRetry ? <button className={s.secondaryButton} type="button" onClick={onRetry}>Retry</button> : null}</div>;
  return null;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not scheduled' : date.toLocaleDateString();
}

function formatMoney(cents?: number, currency = 'USD') {
  return `${currency} ${(Number(cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fileName(file: AssetFile) {
  return file.original_name || file.originalName || file.name || 'Untitled file';
}

function fileMime(file: AssetFile) {
  return file.mime_type || file.mimeType || 'unknown';
}

function fileSize(file: AssetFile) {
  const bytes = Number(file.size_bytes ?? file.sizeBytes ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DashboardSurface() {
  const { data, loading, error, reload } = useData<DashboardData>('/api/dashboard');
  const completed = data?.tasks?.counts?.completed ?? 0;
  return <AppShell title="Dashboard">
    <div className={s.pageHead}><div><span className={s.eyebrow}>Overview</span><h2>Welcome{data?.user?.name ? `, ${data.user.name}` : ''}.</h2><p>Your plan, Work credits, recent Work, recent chats, role, and active sessions.</p></div><button className={s.secondaryButton} type="button" onClick={() => void reload()}>Refresh</button></div>
    <StateBlock loading={loading} error={error} onRetry={() => void reload()} />
    {data ? <div className={s.grid}>
      <section className={`${s.grid} ${s.grid4}`} aria-label="Dashboard metrics">
        <Metric label="Plan" value={data.plan?.name ?? 'Free'} />
        <Metric label="Work credits" value={data.credits?.unlimited ? 'Unlimited' : String(data.credits?.available ?? 0)} />
        <Metric label="Completed" value={String(completed)} />
        <Metric label="Cycle reset" value={formatDate(data.cycleResetAt)} />
      </section>
      <section className={`${s.grid} ${s.grid2}`}>
        <div className={s.panel}><h3>Recent work</h3><div className={s.list}>{data.tasks?.recent?.length ? data.tasks.recent.slice(0, 8).map((task) => <div className={s.row} key={task.id ?? task.title}><span className={s.rowText}><b>{task.title || 'Untitled task'}</b><small>{formatDate(task.createdAt)} · {task.creditsConsumed ?? 0} credit</small></span><span className={s.badge}>{task.status || 'unknown'}</span></div>) : <div className={s.empty}><h3>No Work tasks yet.</h3><p>Start a Task when you are ready to create a tracked artifact.</p></div>}</div></div>
        <div className={s.panel}><h3>Recent chats</h3><div className={s.list}>{data.chats?.length ? data.chats.slice(0, 6).map((chat) => <div className={s.row} key={chat.id ?? chat.title}><span className={s.rowText}><b>{chat.title || 'Untitled chat'}</b><small>{chat.model || 'model'} · {formatDate(chat.updatedAt)}</small></span><Link className={s.ghostButton} href="/chat">Open</Link></div>) : <div className={s.empty}><h3>No chats yet.</h3><p>Open New chat to start a real conversation.</p></div>}</div><div className={s.divider} /><dl className={s.grid}><div className={s.row}><dt>Role</dt><dd>{data.user?.role ?? 'user'}</dd></div><div className={s.row}><dt>Active sessions</dt><dd>{data.sessions?.length ?? 0}</dd></div></dl><Link className={s.secondaryButton} href="/pricing">Compare plans</Link></div>
      </section>
    </div> : null}
  </AppShell>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className={s.metric}><small>{label}</small><strong>{value}</strong></article>;
}

export function SettingsSurface() {
  const { data, loading, error, reload } = useData<DashboardData>('/api/dashboard');
  const signOut = async () => {
    const refreshToken = storedRefreshToken();
    try { if (refreshToken) await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }); } catch {}
    clearStoredTokens();
    window.location.href = '/signin';
  };
  return <AppShell title="Settings">
    <div className={s.pageHead}><div><span className={s.eyebrow}>Options</span><h2>Settings</h2><p>Account, appearance, plan, privacy, and help options. This page is not the dashboard.</p></div></div>
    <StateBlock loading={loading} error={error} onRetry={() => void reload()} />
    <div className={s.grid}>
      <section className={s.panel}><h3>Account</h3><div className={s.list}><div className={s.row}><span className={s.rowText}><b>Email</b><small>{data?.user?.email ?? 'Not loaded'}</small></span></div><div className={s.row}><span className={s.rowText}><b>Role</b><small>{data?.user?.role ?? 'Not loaded'}</small></span></div><div className={s.row}><span className={s.rowText}><b>Active sessions</b><small>{data?.sessions?.length ?? 0}</small></span></div><div className={s.row}><span className={s.rowText}><b>Sign out all sessions</b><small>Not supported by the current public API. Sign out this browser instead.</small></span><button className={s.secondaryButton} type="button" onClick={() => void signOut()}>Log out</button></div><div className={s.row}><span className={s.rowText}><b>Delete account</b><small>Disabled until a verified account-deletion endpoint exists.</small></span><button className={s.ghostButton} type="button" disabled>Unavailable</button></div></div></section>
      <section className={s.panel}><h3>Appearance</h3><div className={s.list}><div className={s.row}><span className={s.rowText}><b>Dark</b><small>Current committed AKBARAL! theme.</small></span><span className={s.badge}>Active</span></div><div className={s.row}><span className={s.rowText}><b>Light</b><small>Coming soon. No broken toggle is exposed.</small></span><button className={s.ghostButton} type="button" disabled>Coming soon</button></div></div></section>
      <section className={s.panel}><h3>Plan &amp; billing</h3><div className={s.list}><div className={s.row}><span className={s.rowText}><b>Current plan</b><small>{data?.plan?.name ?? 'Free'}</small></span></div><div className={s.row}><span className={s.rowText}><b>Work credits</b><small>{data?.credits?.unlimited ? 'Unlimited' : `${data?.credits?.available ?? 0} available`}</small></span><Link className={s.secondaryButton} href="/pricing">Compare plans</Link></div></div></section>
      <section className={s.panel}><h3>Privacy &amp; security</h3><div className={s.list}><div className={s.row}><span className={s.rowText}><b>Scoped records</b><small>Dashboard, project, file, chat, and Work APIs require authentication and return account-owned records.</small></span></div><div className={s.row}><span className={s.rowText}><b>Sessions</b><small>Active session count is read from the dashboard API.</small></span></div></div></section>
      <section className={s.panel}><h3>Help &amp; feedback</h3><p className={s.muted}>Use Help for workflow questions and contact guidance. Feedback routes are available from the product support flow when configured.</p><div className={s.buttonRow}><Link className={s.secondaryButton} href="/help">Open Help</Link><Link className={s.ghostButton} href="/">Landing</Link></div></section>
    </div>
  </AppShell>;
}

async function loadProjectDetails() {
  const projectsPayload = await apiJson<ProjectsPayload>('/api/projects');
  const projects = projectsPayload.projects ?? [];
  const details = await Promise.all(projects.map((project) => project.id ? apiJson<ProjectDetail>(`/api/projects/${encodeURIComponent(project.id)}`).catch(() => ({ project, files: [] } satisfies ProjectDetail)) : Promise.resolve({ project, files: [] } satisfies ProjectDetail)));
  return { projects, details };
}

function useProjectAssets() {
  const [data, setData] = useState<{ projects: Project[]; details: ProjectDetail[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await loadProjectDetails()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project assets are temporarily unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function FilesSurface() {
  const { data, loading, error, reload } = useProjectAssets();
  const files = useMemo(() => data?.details.flatMap((detail) => detail.files ?? []) ?? [], [data]);
  return <AppShell title="Files & documents"><AssetPage title="Files & documents" subtitle="Real files uploaded to your projects. No rows are invented." files={files} loading={loading} error={error} onRetry={reload} emptyTitle="No files yet." emptyText="Upload an image from Chat or Task, or add files to a project when that workflow is available." /></AppShell>;
}

export function ImagesSurface() {
  const { data, loading, error, reload } = useProjectAssets();
  const images = useMemo(() => (data?.details.flatMap((detail) => detail.files ?? []) ?? []).filter((file) => fileMime(file).toLowerCase().startsWith('image/')), [data]);
  return <AppShell title="Images"><AssetPage title="Images" subtitle="Real image files from your project uploads and task attachments." files={images} loading={loading} error={error} onRetry={reload} emptyTitle="No images yet." emptyText="Upload an image in Chat or Task; it will appear here after the authenticated upload succeeds." /></AppShell>;
}

function AssetPage({ title, subtitle, files, loading, error, onRetry, emptyTitle, emptyText }: { title: string; subtitle: string; files: AssetFile[]; loading: boolean; error: string; onRetry: () => void; emptyTitle: string; emptyText: string }) {
  return <div className={s.grid}><div className={s.pageHead}><div><span className={s.eyebrow}>Assets</span><h2>{title}</h2><p>{subtitle}</p></div><button className={s.secondaryButton} type="button" onClick={() => void onRetry()}>Refresh</button></div><StateBlock loading={loading} error={error} onRetry={onRetry} />{!loading && !error ? <div className={s.panel}><div className={s.list}>{files.length ? files.map((file) => <div className={s.row} key={file.id ?? fileName(file)}><span className={s.rowText}><b>{fileName(file)}</b><small>{fileMime(file)} · {fileSize(file)} · {formatDate(file.created_at || file.createdAt)}</small></span>{file.id ? <a className={s.ghostButton} href={`/api/files/${encodeURIComponent(file.id)}`}>Download</a> : null}</div>) : <div className={s.empty}><h3>{emptyTitle}</h3><p>{emptyText}</p></div>}</div></div> : null}</div>;
}

export function ProjectsSurface() {
  const { data, loading, error, reload } = useProjectAssets();
  const projects = data?.projects ?? [];
  return <AppShell title="Projects"><div className={s.pageHead}><div><span className={s.eyebrow}>Projects</span><h2>Projects</h2><p>Real project workspaces owned by your account.</p></div><button className={s.secondaryButton} type="button" onClick={() => void reload()}>Refresh</button></div><StateBlock loading={loading} error={error} onRetry={reload} />{!loading && !error ? <div className={s.panel}><div className={s.list}>{projects.length ? projects.map((project) => <div className={s.row} key={project.id ?? project.name}><span className={s.rowText}><b>{project.name || 'Untitled project'}</b><small>{project.description || 'No description'} · {project.status || 'active'}</small></span><span className={s.badge}>{project.slug || 'project'}</span></div>) : <div className={s.empty}><h3>No projects yet.</h3><p>Create a project when you need shared context for files, tasks, and artifacts.</p></div>}</div></div> : null}</AppShell>;
}

export function AgentsSurface() {
  const { data: categories, loading: catLoading, error: catError, reload: reloadCats } = useData<CategoriesPayload>('/api/agents/categories');
  const { data: agents, loading, error, reload } = useData<AgentsPayload>('/api/agents?limit=6');
  const rows = agents?.agents ?? agents?.results ?? [];
  const total = categories?.total ?? agents?.total ?? 4001;
  return <AppShell title="Agents"><div className={s.pageHead}><div><span className={s.eyebrow}>Registry</span><h2>{total.toLocaleString()} registered agent contracts</h2><p>Concise view of the real registry. Contracts are not described as active or earning unless execution proves it.</p></div><button className={s.secondaryButton} type="button" onClick={() => { void reload(); void reloadCats(); }}>Refresh</button></div><StateBlock loading={loading || catLoading} error={error || catError} onRetry={() => { void reload(); void reloadCats(); }} />{!loading && !error ? <div className={`${s.grid} ${s.grid2}`}><section className={s.panel}><h3>Sample contracts</h3><div className={s.list}>{rows.length ? rows.map((agent) => <div className={s.row} key={agent.id ?? agent.slug ?? agent.name}><span className={s.rowText}><b>{agent.name || agent.slug || 'Agent contract'}</b><small>{agent.description || 'No description provided.'}</small></span><span className={s.badge}>{agent.category || agent.categorySlug || agent.status || 'registered'}</span></div>) : <div className={s.empty}><h3>No agent contracts returned.</h3><p>The registry endpoint returned no rows for this account.</p></div>}</div></section><section className={s.panel}><h3>Categories</h3><div className={s.list}>{categories?.categories?.slice(0, 10).map((category) => <div className={s.row} key={category.slug ?? category.name}><span className={s.rowText}><b>{category.name || category.slug || 'Category'}</b><small>{category.slug}</small></span><span className={s.badge}>{category.count ?? 0}</span></div>) ?? <div className={s.empty}><h3>No category data.</h3><p>Category totals are unavailable right now.</p></div>}</div></section></div> : null}</AppShell>;
}

export function AutomationsSurface() {
  const { data, loading, error, reload } = useData<AutomationsPayload>('/api/automations');
  const rows = data?.automations ?? [];
  return <AppShell title="Automations"><div className={s.pageHead}><div><span className={s.eyebrow}>Automations</span><h2>Automations</h2><p>Real automations configured on your account.</p></div><button className={s.secondaryButton} type="button" onClick={() => void reload()}>Refresh</button></div><StateBlock loading={loading} error={error} onRetry={reload} />{!loading && !error ? <div className={s.panel}><div className={s.list}>{rows.length ? rows.map((automation) => <div className={s.row} key={automation.id ?? automation.name}><span className={s.rowText}><b>{automation.name || 'Untitled automation'}</b><small>{automation.description || 'No description'} · next run: {formatDate(automation.nextRunAt)}</small></span><span className={s.badge}>{automation.status || 'unknown'}</span></div>) : <div className={s.empty}><h3>No automations yet.</h3><p>Create automations only when a real schedule and action are ready.</p></div>}</div></div> : null}</AppShell>;
}

export function BillingSurface() {
  const { data, loading, error, reload } = useData<BillingAccount>('/api/billing/account');
  const invoiceRows = data?.invoices ?? [];
  const paymentRows = data?.payments ?? [];
  return <AppShell title="Billing & credits"><div className={s.pageHead}><div><span className={s.eyebrow}>Billing</span><h2>Billing &amp; credits</h2><p>Current subscription, invoices, payments, and the exact public plan table.</p></div><button className={s.secondaryButton} type="button" onClick={() => void reload()}>Refresh</button></div><StateBlock loading={loading} error={error} onRetry={reload} />{data ? <div className={s.grid}><section className={`${s.grid} ${s.grid3}`}><Metric label="Unlimited" value={data.unlimited ? 'Yes' : 'No'} /><Metric label="Invoices" value={String(invoiceRows.length)} /><Metric label="Payments" value={String(paymentRows.length)} /></section><PricingCards ctaHref="/pricing" ctaLabel="Plan details" /><section className={`${s.grid} ${s.grid2}`}><div className={s.panel}><h3>Invoices</h3><div className={s.list}>{invoiceRows.length ? invoiceRows.slice(0, 6).map((invoice) => <div className={s.row} key={String(invoice.id ?? invoice.number)}><span className={s.rowText}><b>{String(invoice.number ?? invoice.id ?? 'Invoice')}</b><small>{formatMoney(Number(invoice.totalCents ?? invoice.amountCents ?? 0), String(invoice.currency ?? 'USD'))}</small></span><span className={s.badge}>{String(invoice.status ?? 'unknown')}</span></div>) : <div className={s.empty}><h3>No invoices yet.</h3><p>Invoices appear only after real billing events.</p></div>}</div></div><div className={s.panel}><h3>Payments</h3><div className={s.list}>{paymentRows.length ? paymentRows.slice(0, 6).map((payment) => <div className={s.row} key={String(payment.id ?? payment.createdAt)}><span className={s.rowText}><b>{formatMoney(Number(payment.amountCents ?? payment.amount_cents ?? 0), String(payment.currency ?? 'USD'))}</b><small>{String(payment.provider ?? 'provider')}</small></span><span className={s.badge}>{String(payment.status ?? 'unknown')}</span></div>) : <div className={s.empty}><h3>No payments yet.</h3><p>Payment rows are shown only when they exist.</p></div>}</div></div></section></div> : null}</AppShell>;
}

export function PricingSurface() {
  return <AppShell title="See plans and pricing" allowAnonymous><div className={s.pageHead}><div><span className={s.eyebrow}>Pricing</span><h2>Plans in USD</h2><p>{PRICING_NOTE}</p></div></div><PricingCards ctaHref="/signup" ctaLabel="Start" /></AppShell>;
}

function PricingCards({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  return <section className={`${s.grid} ${s.grid3}`} aria-label="AKBARAL! pricing plans">{AKBARAL_PLANS.map((plan) => <article className={s.panelSoft} key={plan.key}><span className={s.eyebrow}>{plan.name}</span><h3>{plan.price}</h3><p className={s.muted}>{plan.tasks} · {plan.note} · USD only</p><Link className={s.secondaryButton} href={ctaHref}>{ctaLabel}</Link></article>)}</section>;
}

export function HelpSurface() {
  return <AppShell title="Help" allowAnonymous><div className={s.pageHead}><div><span className={s.eyebrow}>Help</span><h2>Help</h2><p>Short, factual answers about AKBARAL! surfaces.</p></div></div><div className={`${s.grid} ${s.grid2}`}><section className={s.panel}><h3>FAQ</h3><div className={s.list}><div className={s.row}><span className={s.rowText}><b>Does Chat spend Work credits?</b><small>No. Chat never deducts Work task credits.</small></span></div><div className={s.row}><span className={s.rowText}><b>When does a Work credit count?</b><small>Credits are consumed only on success. Failures refund automatically.</small></span></div><div className={s.row}><span className={s.rowText}><b>Where are files shown?</b><small>Files and images render from project-owned assets returned by authenticated APIs.</small></span></div><div className={s.row}><span className={s.rowText}><b>Why is light theme disabled?</b><small>Only the committed dark theme is currently real. Light is coming soon.</small></span></div></div></section><section className={s.panel}><h3>Contact</h3><p className={s.muted}>For account help, include your account email, the route you were using, and the time of the issue. Do not send passwords, tokens, or secrets.</p><div className={s.buttonRow}><Link className={s.secondaryButton} href="/settings">Settings</Link><Link className={s.ghostButton} href="/pricing">Plans</Link></div></section></div></AppShell>;
}
