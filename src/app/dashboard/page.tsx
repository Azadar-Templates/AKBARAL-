'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import styles from './dashboard.module.css';

const dashboardSchema = z.object({
  user: z.object({ email: z.string(), name: z.string().nullable(), role: z.string(), status: z.string() }),
  credits: z.object({ available: z.number(), unlimited: z.boolean().optional() }),
  cycleResetAt: z.string(),
  chats: z.array(z.object({ id: z.string(), title: z.string(), model: z.string(), updatedAt: z.string() })),
  plan: z.object({ name: z.string(), priceCents: z.number(), currency: z.string() }).nullable(),
  tasks: z.object({
    recent: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), createdAt: z.string(), creditsConsumed: z.number() })),
    counts: z.record(z.string(), z.number()),
  }),
  billing: z.object({
    invoices: z.array(z.object({ id: z.string(), number: z.string(), amountCents: z.number(), currency: z.string(), status: z.string() })),
    payments: z.array(z.object({ id: z.string(), amountCents: z.number(), provider: z.string(), status: z.string() })),
  }),
  sessions: z.array(z.object({ id: z.string(), lastSeenAt: z.string().nullable().optional(), ipAddress: z.string().nullable().optional() })),
});
type DashboardData = z.infer<typeof dashboardSchema>;

export default function UserDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const accessToken = localStorage.getItem('ak_access');
    if (!accessToken) { setError('Sign in to view your dashboard.'); setLoading(false); return; }
    try {
      const response = await fetch('/api/dashboard', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : 'Dashboard data is temporarily unavailable.');
      setData(dashboardSchema.parse(await response.json()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dashboard data is temporarily unavailable.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  if (loading) return <main className={styles.state}><span>A!</span><p>Loading your dashboard…</p></main>;
  if (error || !data) return <main className={styles.state}><span>A!</span><h1>Dashboard unavailable</h1><p>{error}</p><a href="/signin">Sign in</a></main>;

  return <main className={styles.page}>
    <header><a href="/#/"><span>A!</span><b>AKBARAL!</b></a><nav><a href="/workspace">Chat & Work</a><a href="/billing">Billing</a></nav></header>
    <div className={styles.wrap}>
      <div className={styles.title}><div><small>USER DASHBOARD</small><h1>Welcome{data.user.name ? `, ${data.user.name}` : ''}.</h1><p>{data.user.email} · {data.user.status}</p></div><button type="button" onClick={() => void load()}>Refresh</button></div>
      <section className={styles.metrics} aria-label="Account overview">
        <Metric label="Work credits" value={data.credits.unlimited ? 'Owner unlimited' : String(data.credits.available)} />
        <Metric label="Plan" value={data.plan?.name ?? 'Free'} />
        <Metric label="Completed" value={String(data.tasks.counts.completed ?? 0)} />
        <Metric label="Cycle resets" value={data.cycleResetAt ? new Date(data.cycleResetAt).toLocaleDateString() : 'Not scheduled'} />
      </section>
      <div className={styles.columns}>
        <section className={styles.card}><h2>Recent Work</h2>{data.tasks.recent.length ? <ul>{data.tasks.recent.slice(0, 8).map((task) => <li key={task.id}><div><b>{task.title || 'Untitled task'}</b><small>{new Date(task.createdAt).toLocaleDateString()} · {task.creditsConsumed} credit</small></div><span data-status={task.status}>{task.status}</span></li>)}</ul> : <p>No Work tasks yet. Start in the Chat & Work shell.</p>}</section>
        <section className={styles.card}><h2>Recent Chats</h2>{data.chats.length ? <ul>{data.chats.slice(0, 5).map((chat) => <li key={chat.id}><div><b>{chat.title}</b><small>{chat.model} · {new Date(chat.updatedAt).toLocaleDateString()}</small></div><a href="/chat">Open</a></li>)}</ul> : <p>No conversations yet.</p>}<dl><div><dt>Role</dt><dd>{data.user.role}</dd></div><div><dt>Active sessions</dt><dd>{data.sessions.length}</dd></div></dl>{data.plan?.name === 'Free Trial' || data.plan?.name === 'Free' ? <a className={styles.upgrade} href="/pricing">Compare plans</a> : null}<p className={styles.note}>Chat never deducts task credits. Free Work includes 5 successful tasks during 30 days; failed or cancelled work is refunded.</p></section>
      </div>
    </div>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article><small>{label}</small><strong>{value}</strong></article>;
}
