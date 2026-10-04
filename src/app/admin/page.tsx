'use client';

import { useEffect, useState } from 'react';
import { AppShell, apiJson, shellStyles as s } from '../_components/app-shell';

type AdminStats = { stats?: Record<string, unknown> };

export default function AdminPage() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void apiJson<AdminStats>('/api/admin/stats').then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Admin data unavailable.')); }, []);
  const entries = Object.entries(data?.stats ?? {}).filter(([, value]) => typeof value !== 'object').slice(0, 12);
  return <AppShell title="Admin"><div className={s.pageHead}><div><span className={s.eyebrow}>Role-gated</span><h2>Admin</h2><p>Admin API access is enforced by the server role middleware.</p></div></div>{error ? <div className={s.empty}><h3>Admin data unavailable</h3><p>{error}</p></div> : null}{data ? <section className={`${s.grid} ${s.grid4}`}>{entries.map(([key, value]) => <article className={s.metric} key={key}><small>{key}</small><strong>{String(value)}</strong></article>)}</section> : !error ? <div className={s.empty}><h3>Loading admin stats…</h3><p>Reading real admin stats.</p></div> : null}</AppShell>;
}
