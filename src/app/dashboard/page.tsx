'use client';

import { useEffect, useState, useCallback } from 'react';

interface DashboardData {
  user: { id: string; email: string; name: string | null; role: string; status: string; country: string | null; createdAt: string };
  credits: { available: number; account: { freeCredits: number; freeCreditsUsed: number; paidCredits: number; bonusCredits: number } | null };
  plan: { key: string; name: string; priceCents: number; currency: string; billingInterval: string } | null;
  subscription: { id: string; status: string; currentPeriodStart: string; currentPeriodEnd: string } | null;
  tasks: { recent: Array<{ id: string; title: string; status: string; agentCategory: string; createdAt: string; creditsConsumed: number }>; counts: Record<string, number> };
  billing: { invoices: Array<{ id: string; number: string; amountCents: number; currency: string; status: string; createdAt: string }>; payments: Array<{ id: string; amountCents: number; provider: string; status: string; createdAt: string }> };
  sessions: Array<{ id: string; createdAt: string; lastSeenAt: string; ipAddress: string }>;
}

type Tab = 'overview' | 'tasks' | 'billing' | 'security' | 'profile';

export default function UserDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const fetchData = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('akbaral_token') : null;
      if (!token) {
        setError('Not authenticated. Please sign in.');
        setLoading(false);
        return;
      }
      const res = await fetch('/api/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setError('Session expired. Please sign in again.');
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p>Loading dashboard...</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center"><p className="text-red-600">{error}</p></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center"><p>No data</p></div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'billing', label: 'Billing' },
    { key: 'security', label: 'Security' },
    { key: 'profile', label: 'Profile' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">AKBARAL! Dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{data.user.email}</span>
          <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800 capitalize">{data.user.role}</span>
        </div>
      </header>

      <nav className="bg-white border-b px-4 flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto p-4">
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'tasks' && <TasksTab data={data} />}
        {tab === 'billing' && <BillingTab data={data} />}
        {tab === 'security' && <SecurityTab data={data} />}
        {tab === 'profile' && <ProfileTab data={data} />}
      </main>
    </div>
  );
}

function OverviewTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Available Credits" value={String(data.credits.available)} subtitle="Remaining tasks" />
        <Card title="Current Plan" value={data.plan?.name ?? 'Free'} subtitle={data.subscription?.status === 'trialing' ? 'Trial' : data.subscription?.status ?? 'Free'} />
        <Card title="Tasks Completed" value={String(data.tasks.counts?.completed ?? 0)} subtitle={`of ${Object.values(data.tasks.counts || {}).reduce((a: number, b: number) => a + b, 0)} total`} />
      </div>
      <div className="bg-white rounded-lg border p-4">
        <h2 className="text-lg font-semibold mb-3">Recent Tasks</h2>
        {data.tasks.recent.length === 0 ? (
          <p className="text-gray-500 text-sm">No tasks yet. Create your first task from the workspace.</p>
        ) : (
          <div className="space-y-2">
            {data.tasks.recent.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between p-2 rounded bg-gray-50">
                <div>
                  <p className="text-sm font-medium">{t.title || 'Untitled task'}</p>
                  <p className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`px-2 py-1 text-xs rounded ${statusColor(t.status)}`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab({ data }: { data: DashboardData }) {
  const statuses = ['all', 'pending', 'running', 'completed', 'failed', 'cancelled'];
  const [filter, setFilter] = useState('all');
  const tasks = filter === 'all' ? data.tasks.recent : data.tasks.recent.filter(t => t.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 text-sm rounded-full ${filter === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
            {s} {s !== 'all' ? `(${data.tasks.counts?.[s] ?? 0})` : ''}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-lg border">
        {tasks.length === 0 ? (
          <p className="p-4 text-gray-500 text-sm">No tasks found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr><th className="text-left p-3">Task</th><th className="text-left p-3">Status</th><th className="text-left p-3">Created</th><th className="text-right p-3">Credits</th></tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3">{t.title || 'Untitled'}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 text-xs rounded ${statusColor(t.status)}`}>{t.status}</span></td>
                  <td className="p-3 text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right">{t.creditsConsumed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BillingTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-3">Subscription</h2>
          {data.subscription ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Plan:</span> {data.plan?.name}</p>
              <p><span className="text-gray-500">Status:</span> <span className="capitalize">{data.subscription.status}</span></p>
              <p><span className="text-gray-500">Price:</span> ${(data.plan?.priceCents ?? 0) / 100} {data.plan?.currency} / {data.plan?.billingInterval}</p>
              {data.subscription.currentPeriodEnd && <p><span className="text-gray-500">Renews:</span> {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Free plan — no active subscription</p>
          )}
        </div>
        <div className="bg-white rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-3">Credits</h2>
          <div className="space-y-2 text-sm">
            <p><span className="text-gray-500">Available:</span> <strong>{data.credits.available}</strong></p>
            <p><span className="text-gray-500">Free credits:</span> {data.credits.account?.freeCredits ?? 0}</p>
            <p><span className="text-gray-500">Paid credits:</span> {data.credits.account?.paidCredits ?? 0}</p>
            <p><span className="text-gray-500">Bonus credits:</span> {data.credits.account?.bonusCredits ?? 0}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg border p-4">
        <h2 className="text-lg font-semibold mb-3">Invoices</h2>
        {data.billing.invoices.length === 0 ? (
          <p className="text-sm text-gray-500">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50"><tr><th className="text-left p-2">Invoice</th><th className="text-left p-2">Amount</th><th className="text-left p-2">Status</th><th className="text-left p-2">Date</th></tr></thead>
            <tbody>
              {data.billing.invoices.map(i => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="p-2">{i.number}</td>
                  <td className="p-2">${i.amountCents / 100} {i.currency}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 text-xs rounded ${i.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{i.status}</span></td>
                  <td className="p-2 text-gray-500">{new Date(i.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SecurityTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border p-4">
        <h2 className="text-lg font-semibold mb-3">Active Sessions</h2>
        {data.sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No active sessions.</p>
        ) : (
          <div className="space-y-2">
            {data.sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between p-2 rounded bg-gray-50">
                <div>
                  <p className="text-sm">{s.ipAddress || 'Unknown IP'}</p>
                  <p className="text-xs text-gray-500">Last seen: {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'N/A'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileTab({ data }: { data: DashboardData }) {
  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Profile</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <Field label="Name" value={data.user.name ?? '—'} />
        <Field label="Email" value={data.user.email} />
        <Field label="Role" value={data.user.role} />
        <Field label="Status" value={data.user.status} />
        <Field label="Country" value={data.user.country ?? '—'} />
        <Field label="Member Since" value={new Date(data.user.createdAt).toLocaleDateString()} />
      </div>
    </div>
  );
}

function Card({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-500">{label}</p>
      <p className="font-medium capitalize">{value}</p>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800';
    case 'running': return 'bg-blue-100 text-blue-800';
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    case 'failed': return 'bg-red-100 text-red-800';
    case 'cancelled': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}
