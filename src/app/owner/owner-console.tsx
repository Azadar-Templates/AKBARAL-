'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * AKBARAL! Owner Console — the real business dashboard for the platform owner.
 *
 * Data comes exclusively from /api/owner/*, which is owner/super_admin only and
 * query-driven (no cached or synthetic numbers). The session token is read from
 * the same browser storage the workspace SPA uses (`ak_access`), so there is no
 * second authentication system and no token is ever rendered into the DOM.
 *
 * Honesty rules baked into this view:
 *   · a value the platform cannot know (external provider invoices) is shown as
 *     "not connected" instead of a number;
 *   · Private mission-system revenue is never merged into these totals — the
 *     separation is stated on the surface itself.
 */

interface Dashboard {
  generatedAt: string;
  source: string;
  ledgerSeparation: { platformRevenue: string; missionRevenue: string };
  users: {
    total: number; active: number; suspended: number; verified: number;
    byRole: Array<{ role: string; count: number }>;
    signups: { today: number; last7Days: number; last30Days: number; byDay: Array<{ day: string; count: number }> };
    retention: { activeLast7Days: number; activeLast30Days: number; neverLoggedIn: number };
  };
  plans: {
    catalog: Array<{ key: string; name: string; priceCents: number; monthlyCredits: number }>;
    subscriptions: Array<{ planKey: string; planName: string; status: string; count: number; priceCents: number }>;
    activeSubscriptions: number; trialingSubscriptions: number; paidSubscriptions: number;
    planMix: Array<{ planKey: string; planName: string; count: number; sharePct: number }>;
  };
  revenue: {
    paidCents: number; refundedCents: number; outstandingCents: number; currency: string;
    payingCustomers: number; arpuCents: number | null; mrrCents: number; mrrNote: string;
    byDay: Array<{ day: string; cents: number; count: number }>;
    payments: { succeeded: number; failed: number; pending: number; refunded: number };
  };
  credits: {
    granted: number; consumed: number; refunded: number; outstanding: number;
    accounts: { total: number; exhausted: number; active: number };
    pools: { freeCredits: number; paidCredits: number; bonusCredits: number };
    refundPolicy: { refundedTransactions: number; refundedCredits: number; note: string };
  };
  tasks: {
    total: number; byStatus: Array<{ status: string; count: number }>;
    completionRatePct: number | null; failureRatePct: number | null;
    avgDurationSeconds: number | null; last7Days: number; executions: number;
  };
  agents: {
    registryTotal: number; registryActive: number; customAgents: number; categories: number;
    factoryVersions: number; topDispatched: Array<{ agentSlug: string | null; executions: number }>;
  };
  costs: {
    api: { modelCostCents: number; runs: number; byModel: Array<{ modelKey: string; costCents: number; runs: number }> };
    storage: { files: number; mb: number; artifacts: number; uploadsDir: string };
    compute: { workflowJobs: number; agentJobs: number; completedJobs: number; failedJobs: number };
    tokens: { inputTokens: number; outputTokens: number; avgLatencyMs: number | null };
    externalProviderCosts: { known: boolean; requiresProviderBillingApi: boolean; note: string };
    grossMargin: { revenueCents: number; knownCostCents: number; grossMarginCents: number; grossMarginPct: number | null; note: string };
  };
  systemHealth: {
    status: string; uptimeSeconds: number;
    checks: Array<{ name: string; ok: boolean }>;
    registryIntegrity: { ok: boolean; detail: string } | null;
    nodeVersion: string; memoryMb: number;
    database: { engine: string; fileSizeBytes: number | null };
  };
  promotion: { contentAccounts: number; contentItems: number; publishJobs: number; publishedItems: number; engagementSnapshots: number; honesty: string };
  owner: { unlimitedExecution: boolean; note: string };
  honesty: { realDataOnly: boolean; noFabrication: string; excludedFromTotals: string[] };
}

function token(): string | null {
  try {
    return window.localStorage.getItem('ak_access');
  } catch {
    return null;
  }
}

function money(cents: number, currency = 'USD'): string {
  const value = Number(cents || 0) / 100;
  return `${currency === 'USD' ? '$' : `${currency} `}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(value: number): string {
  return Number(value || 0).toLocaleString();
}

const card: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px 18px',
  backdropFilter: 'blur(12px)',
};

const label: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
};

const metric: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: 600,
  color: 'var(--text)',
  marginTop: '6px',
  fontVariantNumeric: 'tabular-nums',
};

export default function OwnerConsole() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'forbidden' | 'unauthenticated' | 'ready'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'business' | 'costs' | 'health'>('business');

  const load = useCallback(async () => {
    const access = token();
    if (!access) {
      setState('unauthenticated');
      return;
    }
    setState('loading');
    try {
      const response = await fetch('/api/owner/dashboard', {
        headers: { authorization: `Bearer ${access}` },
      });
      if (response.status === 401) {
        setState('unauthenticated');
        return;
      }
      if (response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) {
        const text = await response.text();
        setError(`HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
        setState('error');
        return;
      }
      const payload = (await response.json()) as { dashboard?: Dashboard };
      if (!payload.dashboard) {
        setError('the API returned no dashboard payload');
        setState('error');
        return;
      }
      setDashboard(payload.dashboard);
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'request failed');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signupSeries = useMemo(() => dashboard?.users.signups.byDay ?? [], [dashboard]);
  const revenueSeries = useMemo(() => dashboard?.revenue.byDay ?? [], [dashboard]);

  if (state === 'unauthenticated') {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Owner sign-in required</h2>
          <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
            Sign in to AKBARAL! with the owner account, then reload this page. The console accepts the owner and
            super_admin roles only — ordinary accounts and staff admins are refused by the API itself.
          </p>
          <a href="/#/login" style={{ color: 'var(--accent)', fontSize: '14px' }}>Go to sign-in →</a>
        </div>
      </Shell>
    );
  }

  if (state === 'forbidden') {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Not authorised</h2>
          <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
            This console is restricted to the platform owner and super_admins. Your account does not hold that role.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Dashboard unavailable</h2>
          <p style={{ color: 'var(--red)', fontSize: '14px' }}>{error ?? 'unknown error'}</p>
          <button onClick={() => void load()} style={buttonStyle}>Retry</button>
        </div>
      </Shell>
    );
  }

  if (state === 'loading' || state === 'idle' || !dashboard) {
    return (
      <Shell>
        <div style={card}><p style={{ color: 'var(--text-2)', margin: 0 }}>Loading live platform data…</p></div>
      </Shell>
    );
  }

  const d = dashboard;
  const maxSignup = Math.max(1, ...signupSeries.map((row) => row.count));
  const maxRevenue = Math.max(1, ...revenueSeries.map((row) => row.cents));

  return (
    <Shell>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {([['business', 'Business'], ['costs', 'Costs & margin'], ['health', 'System health']] as const).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              ...buttonStyle,
              background: tab === key ? 'var(--accent-soft)' : 'transparent',
              borderColor: tab === key ? 'var(--line-accent)' : 'var(--line)',
            }}
          >
            {text}
          </button>
        ))}
        <button onClick={() => void load()} style={{ ...buttonStyle, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {tab === 'business' && (
        <>
          <Section title="Customers">
            <Grid>
              <Metric label="Total users" value={compact(d.users.total)} />
              <Metric label="Active" value={compact(d.users.active)} />
              <Metric label="Signups · 7d" value={compact(d.users.signups.last7Days)} />
              <Metric label="Signups · 30d" value={compact(d.users.signups.last30Days)} />
              <Metric label="Active · 7d" value={compact(d.users.retention.activeLast7Days)} />
              <Metric label="Never signed in" value={compact(d.users.retention.neverLoggedIn)} />
            </Grid>
            <Sparkline title="Signups · last 30 days" rows={signupSeries.map((r) => ({ label: r.day, value: r.count }))} max={maxSignup} />
            <Table
              head={['Role', 'Accounts']}
              rows={d.users.byRole.map((row) => [row.role, compact(row.count)])}
            />
          </Section>

          <Section title="Plans & subscriptions">
            <Grid>
              <Metric label="Active subscriptions" value={compact(d.plans.activeSubscriptions)} />
              <Metric label="Paid subscriptions" value={compact(d.plans.paidSubscriptions)} />
              <Metric label="Trialing" value={compact(d.plans.trialingSubscriptions)} />
              <Metric label="MRR (real prices)" value={money(d.revenue.mrrCents, d.revenue.currency)} />
            </Grid>
            <Table
              head={['Plan', 'Price', 'Status', 'Count']}
              rows={d.plans.subscriptions.map((row) => [row.planName, money(row.priceCents, d.revenue.currency), row.status, compact(row.count)])}
            />
            <Note text={d.revenue.mrrNote} />
          </Section>

          <Section title="Revenue (AKBARAL! customer ledger)">
            <Grid>
              <Metric label="Paid" value={money(d.revenue.paidCents, d.revenue.currency)} />
              <Metric label="Refunded" value={money(d.revenue.refundedCents, d.revenue.currency)} />
              <Metric label="Outstanding" value={money(d.revenue.outstandingCents, d.revenue.currency)} />
              <Metric label="Paying customers" value={compact(d.revenue.payingCustomers)} />
              <Metric label="ARPU" value={d.revenue.arpuCents == null ? '—' : money(d.revenue.arpuCents, d.revenue.currency)} />
              <Metric label="Payments ok / failed" value={`${compact(d.revenue.payments.succeeded)} / ${compact(d.revenue.payments.failed)}`} />
            </Grid>
            <Sparkline title="Paid revenue · last 30 days" rows={revenueSeries.map((r) => ({ label: r.day, value: r.cents }))} max={maxRevenue} format={(v) => money(v, d.revenue.currency)} />
          </Section>

          <Section title="Tasks, credits & agents">
            <Grid>
              <Metric label="Tasks" value={compact(d.tasks.total)} />
              <Metric label="Completion rate" value={d.tasks.completionRatePct == null ? '—' : `${d.tasks.completionRatePct}%`} />
              <Metric label="Failure rate" value={d.tasks.failureRatePct == null ? '—' : `${d.tasks.failureRatePct}%`} />
              <Metric label="Agent executions" value={compact(d.tasks.executions)} />
              <Metric label="Credits granted" value={compact(d.credits.granted)} />
              <Metric label="Credits consumed" value={compact(d.credits.consumed)} />
              <Metric label="Credits refunded" value={compact(d.credits.refunded)} />
              <Metric label="Credits outstanding" value={compact(d.credits.outstanding)} />
              <Metric label="Registry agents" value={compact(d.agents.registryTotal)} />
              <Metric label="Custom agents" value={compact(d.agents.customAgents)} />
              <Metric label="Categories" value={compact(d.agents.categories)} />
              <Metric label="Factory versions" value={compact(d.agents.factoryVersions)} />
            </Grid>
            <Table
              head={['Task status', 'Count']}
              rows={d.tasks.byStatus.map((row) => [row.status, compact(row.count)])}
            />
            <Note text={d.credits.refundPolicy.note} />
            {d.agents.topDispatched.length > 0 && (
              <Table
                head={['Most dispatched agent', 'Executions']}
                rows={d.agents.topDispatched.map((row) => [row.agentSlug ?? '—', compact(row.executions)])}
              />
            )}
          </Section>
        </>
      )}

      {tab === 'costs' && (
        <>
          <Section title="API cost (recorded model runs)">
            <Grid>
              <Metric label="Model cost" value={money(d.costs.api.modelCostCents, d.revenue.currency)} />
              <Metric label="Model runs" value={compact(d.costs.api.runs)} />
              <Metric label="Avg latency" value={d.costs.tokens.avgLatencyMs == null ? '—' : `${compact(d.costs.tokens.avgLatencyMs)} ms`} />
              <Metric label="Tokens in / out" value={`${compact(d.costs.tokens.inputTokens)} / ${compact(d.costs.tokens.outputTokens)}`} />
            </Grid>
            <Table
              head={['Model', 'Runs', 'Cost']}
              rows={d.costs.api.byModel.map((row) => [row.modelKey, compact(row.runs), money(row.costCents, d.revenue.currency)])}
            />
          </Section>

          <Section title="Storage & compute">
            <Grid>
              <Metric label="Files" value={compact(d.costs.storage.files)} />
              <Metric label="Storage" value={`${d.costs.storage.mb.toLocaleString()} MB`} />
              <Metric label="Artifacts" value={compact(d.costs.storage.artifacts)} />
              <Metric label="Uploads dir" value={<span style={{ fontSize: '14px' }}>{d.costs.storage.uploadsDir}</span>} />
              <Metric label="Workflow jobs" value={compact(d.costs.compute.workflowJobs)} />
              <Metric label="Agent jobs" value={compact(d.costs.compute.agentJobs)} />
              <Metric label="Jobs completed" value={compact(d.costs.compute.completedJobs)} />
              <Metric label="Jobs failed" value={compact(d.costs.compute.failedJobs)} />
            </Grid>
          </Section>

          <Section title="Gross margin & external costs">
            <Grid>
              <Metric label="Revenue" value={money(d.costs.grossMargin.revenueCents, d.revenue.currency)} />
              <Metric label="Recorded cost" value={money(d.costs.grossMargin.knownCostCents, d.revenue.currency)} />
              <Metric label="Gross margin" value={money(d.costs.grossMargin.grossMarginCents, d.revenue.currency)} />
              <Metric label="Margin %" value={d.costs.grossMargin.grossMarginPct == null ? '—' : `${d.costs.grossMargin.grossMarginPct}%`} />
            </Grid>
            <Note text={d.costs.grossMargin.note} />
            <div style={{ ...card, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
              <div style={label}>External provider invoices</div>
              <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-2)' }}>
                {d.costs.externalProviderCosts.requiresProviderBillingApi ? 'Not connected' : 'Connected'} — {d.costs.externalProviderCosts.note}
              </p>
            </div>
          </Section>

          <Section title="Promotion / content operations">
            <Grid>
              <Metric label="Connected accounts" value={compact(d.promotion.contentAccounts)} />
              <Metric label="Content items" value={compact(d.promotion.contentItems)} />
              <Metric label="Publish jobs" value={compact(d.promotion.publishJobs)} />
              <Metric label="Published" value={compact(d.promotion.publishedItems)} />
              <Metric label="Engagement snapshots" value={compact(d.promotion.engagementSnapshots)} />
            </Grid>
            <Note text={d.promotion.honesty} />
          </Section>
        </>
      )}

      {tab === 'health' && (
        <>
          <Section title="System health">
            <Grid>
              <Metric label="Status" value={d.systemHealth.status} />
              <Metric label="Uptime" value={`${Math.floor(d.systemHealth.uptimeSeconds / 60)} min`} />
              <Metric label="Node" value={<span style={{ fontSize: '16px' }}>{d.systemHealth.nodeVersion}</span>} />
              <Metric label="Memory (RSS)" value={`${d.systemHealth.memoryMb} MB`} />
              <Metric label="Database" value={d.systemHealth.database.engine} />
              <Metric
                label="DB size"
                value={d.systemHealth.database.fileSizeBytes == null ? '—' : `${(d.systemHealth.database.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`}
              />
            </Grid>
            <Table
              head={['Check', 'Result']}
              rows={d.systemHealth.checks.map((check) => [check.name, check.ok ? 'ok' : 'failing'])}
            />
            {d.systemHealth.registryIntegrity && (
              <Note text={`Registry integrity: ${d.systemHealth.registryIntegrity.ok ? 'ok' : 'FAILING'} — ${d.systemHealth.registryIntegrity.detail}`} />
            )}
          </Section>

          <Section title="Owner entitlements & ledger separation">
            <div style={card}>
              <div style={label}>Unlimited execution</div>
              <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-2)' }}>
                {d.owner.unlimitedExecution ? 'active' : 'not configured'} — {d.owner.note}
              </p>
              <div style={{ ...label, marginTop: '14px' }}>Ledgers</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '14px', color: 'var(--text-2)' }}>
                <li>Platform: {d.ledgerSeparation.platformRevenue}</li>
                <li>Mission: {d.ledgerSeparation.missionRevenue}</li>
              </ul>
              <div style={{ ...label, marginTop: '14px' }}>Excluded from these totals</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '14px', color: 'var(--text-2)' }}>
                {d.honesty.excludedFromTotals.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
              <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--text-dim)' }}>{d.honesty.noFabrication}</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-faint)' }}>
                Generated {d.generatedAt} · source: {d.source}
              </p>
            </div>
          </Section>
        </>
      )}
    </Shell>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  color: 'var(--text-2)',
  padding: '8px 14px',
  fontSize: '13px',
  cursor: 'pointer',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        color: 'var(--text)',
        padding: '32px 20px 80px',
      }}
    >
      <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
        <header style={{ marginBottom: '22px' }}>
          <div style={label}>AKBARAL!</div>
          <h1 style={{ margin: '6px 0 0', fontSize: '28px', fontWeight: 600 }}>Owner Console</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', fontSize: '14px', maxWidth: '70ch' }}>
            Live business analytics for the platform owner. Every figure is read from the production database; nothing
            is estimated. Access is enforced server-side (owner / super_admin only).
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '26px' }}>
      <h2 style={{ fontSize: '15px', letterSpacing: '0.02em', margin: '0 0 12px', color: 'var(--text)' }}>{title}</h2>
      <div style={{ display: 'grid', gap: '12px' }}>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {children}
    </div>
  );
}

function Metric({ label: text, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={label}>{text}</div>
      <div style={metric}>{value}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (rows.length === 0) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-dim)' }}>No rows recorded yet.</p>
      </div>
    );
  }
  return (
    <div style={{ ...card, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-dim)', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-faint)', fontVariantNumeric: 'tabular-nums' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sparkline({ title, rows, max, format }: { title: string; rows: Array<{ label: string; value: number }>; max: number; format?: (value: number) => string }) {
  if (rows.length === 0) {
    return (
      <div style={card}>
        <div style={label}>{title}</div>
        <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-dim)' }}>No activity recorded in this window.</p>
      </div>
    );
  }
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '70px', marginTop: '12px' }}>
        {rows.map((row) => (
          <div
            key={row.label}
            title={`${row.label}: ${format ? format(row.value) : compact(row.value)}`}
            style={{
              flex: 1,
              minWidth: '3px',
              height: `${Math.max(3, Math.round((row.value / max) * 100))}%`,
              background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-2) 100%)',
              borderRadius: '2px 2px 0 0',
              opacity: row.value === 0 ? 0.22 : 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-faint)', lineHeight: 1.5 }}>{text}</p>;
}
