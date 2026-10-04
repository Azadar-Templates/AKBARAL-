'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, ChevronDown, ChevronLeft, Clipboard, Download, FileText, History, Menu, MessageSquare,
  Octagon, PanelRight, Play, Plus, RefreshCw, Send, Settings, ShieldCheck, Sparkles, Trash2, UserCircle, X, Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import styles from './workbench-shell.module.css';

type Mode = 'chat' | 'work';
type ChatRole = 'user' | 'assistant';
interface ChatMessage { id: string; role: ChatRole; content: string; }
interface Conversation { id: string; title: string; model: string; updatedAt: string; }
interface WorkItem { id: string; title: string; goal: string; status: string; updatedAt: string; }
interface Stage { label: string; status: 'complete' | 'active' | 'pending' | 'failed'; }

const DEFAULT_MODEL = 'gemini-3.8-flash';
const STAGES: Stage[] = ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete'].map((label) => ({ label, status: 'pending' }));
const EXAMPLES = [
  'Build me a landing page',
  'Analyze this trading chart',
  'Write a research report on a new market',
  'Create a short video script about a product launch',
];

const conversationListSchema = z.object({ conversations: z.array(z.object({
  id: z.string(), title: z.string(), model: z.string(), updatedAt: z.string(),
})) });
const conversationSchema = z.object({ messages: z.array(z.object({
  id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(),
})) });
const workflowListSchema = z.object({ workflows: z.array(z.record(z.string(), z.unknown())) });
const masterStartSchema = z.object({ workflow: z.object({ id: z.string(), status: z.string() }) });
const masterResultSchema = z.object({
  workflow: z.record(z.string(), z.unknown()),
  finalResult: z.unknown().nullable().optional(),
});
const modelsSchema = z.object({ models: z.array(z.object({
  key: z.string(), name: z.string(), provider: z.string(), available: z.boolean(),
})) });
const accountSchema = z.object({ user: z.object({ name: z.string().nullable(), email: z.string(), role: z.string() }) });
const projectsSchema = z.object({ projects: z.array(z.object({ id: z.string() }).passthrough()) });
const uploadSchema = z.object({ file: z.object({ fileId: z.string(), originalName: z.string(), kind: z.string(), sizeBytes: z.number() }) });
type Account = z.infer<typeof accountSchema>['user'];
const errorSchema = z.object({ error: z.object({ message: z.string().optional() }).optional(), message: z.string().optional() });

function token() {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem('ak_access') ?? '';
}

async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}`, ...init?.headers },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error?.message ?? parsed.data.message ?? 'Request failed.' : 'Request failed.');
  }
  return schema.parse(payload);
}

function parseSseBlock(block: string): unknown | null {
  const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
  if (!data) return null;
  try { return JSON.parse(data) as unknown; } catch { return null; }
}

async function readSse(response: Response, onEvent: (event: unknown) => void) {
  if (!response.ok || !response.body) throw new Error('Streaming connection was unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event !== null) onEvent(event);
    }
  }
}

function Markdown({ content }: { content: string }) {
  const blocks = content.split(/```/);
  return <div className={styles.markdown}>{blocks.map((block, index) => {
    if (index % 2 === 1) {
      const firstBreak = block.indexOf('\n');
      const language = firstBreak >= 0 ? block.slice(0, firstBreak).trim() : '';
      const code = firstBreak >= 0 ? block.slice(firstBreak + 1) : block;
      return <div className={styles.codeBlock} key={`${index}-${code.slice(0, 12)}`}>
        <div><span>{language || 'code'}</span><CopyButton value={code} /></div><pre><code>{code}</code></pre>
      </div>;
    }
    return <div key={`${index}-${block.slice(0, 12)}`}>{block.split('\n').map((line, lineIndex) => {
      if (line.startsWith('### ')) return <h3 key={lineIndex}>{line.slice(4)}</h3>;
      if (line.startsWith('## ')) return <h2 key={lineIndex}>{line.slice(3)}</h2>;
      if (line.startsWith('# ')) return <h1 key={lineIndex}>{line.slice(2)}</h1>;
      if (line.startsWith('- ')) return <p className={styles.listLine} key={lineIndex}>• {line.slice(2)}</p>;
      return line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex} />;
    })}</div>;
  })}</div>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className={styles.iconButton} type="button" aria-label="Copy to clipboard" onClick={() => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_500); });
  }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}</button>;
}

function Composer({ value, setValue, onSubmit, busy, onStop, placeholder, minRows = 1, buttonLabel = 'Send', onAttach, attachments = [] }: {
  value: string; setValue: (value: string) => void; onSubmit: () => void; busy: boolean; onStop: () => void; placeholder: string; minRows?: number; buttonLabel?: string; onAttach?: (file: File) => void; attachments?: string[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${Math.min(Math.max(ref.current.scrollHeight, minRows * 24), 240)}px`;
  }, [minRows, value]);
  return <div className={`${styles.composer} ${minRows > 1 ? styles.tallComposer : ''}`}>
    {onAttach && <label className={styles.attachButton} title="Attach an image"><span>＋</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAttach(file); event.currentTarget.value = ''; }} /> </label>}
    {attachments.length > 0 && <div className={styles.attachmentList} aria-label="Attached files">{attachments.map((name) => <span key={name}>{name}</span>)}</div>}
    <textarea ref={ref} value={value} rows={minRows} maxLength={20_000} placeholder={placeholder} aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy) onSubmit(); }
      }} />
    {busy
      ? <button type="button" className={styles.stopButton} onClick={onStop}><Octagon size={17} /> Stop</button>
      : <button type="button" className={styles.sendButton} onClick={onSubmit} disabled={!value.trim()}><Send size={17} /> {buttonLabel}</button>}
  </div>;
}

function groupByDate<T extends { updatedAt: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = historyGroup(item.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups.entries()];
}

function historyGroup(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const distance = Math.round((current - day) / 86_400_000);
  if (distance <= 0) return 'Today';
  if (distance === 1) return 'Yesterday';
  if (distance < 7) return 'Previous 7 days';
  return 'Earlier';
}

export function WorkbenchShell({ initialMode = 'chat' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [workInput, setWorkInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ key: string; name: string; available: boolean }>>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [artifact, setArtifact] = useState<unknown>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshHistory = useCallback(async () => {
    if (!token()) return;
    const [chats, work] = await Promise.all([
      api('/api/chat', conversationListSchema),
      api('/api/workflows', workflowListSchema),
    ]);
    setConversations(chats.conversations);
    setWorkItems(work.workflows.map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.name ?? row.goal ?? 'Work task'),
      goal: String(row.goal ?? row.name ?? ''),
      status: String(row.status ?? 'unknown'),
      updatedAt: String(row.updated_at ?? row.created_at ?? ''),
    })).filter((item) => item.id));
  }, []);

  useEffect(() => {
    const hasToken = Boolean(token());
    setAuthenticated(hasToken);
    if (!hasToken) return;
    void Promise.all([
      refreshHistory(),
      api('/api/me', accountSchema).then((data) => setAccount(data.user)),
      api('/api/projects', projectsSchema).then((data) => setProjectId(data.projects[0]?.id ?? null)),
      api('/api/models', modelsSchema).then((data) => {
        const choices = data.models.filter((item) => item.provider === 'google');
        setModels(choices.length ? choices : data.models);
        if (!data.models.some((item) => item.key === DEFAULT_MODEL)) setModel(data.models[0]?.key ?? DEFAULT_MODEL);
      }),
    ]).catch(() => setError('Some account data could not be loaded. You can retry without losing work.'));
  }, [refreshHistory]);

  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); };

  const sendChat = async (contentOverride?: string) => {
    const content = (contentOverride ?? chatInput).trim();
    if (!content || busy) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setChatInput(''); setError(''); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
        body: JSON.stringify({ conversationId, content, model }),
      });
      await readSse(response, (raw) => {
        const event = z.object({ type: z.string(), token: z.string().optional(), text: z.string().optional(), conversationId: z.string().optional(), message: z.string().optional() }).safeParse(raw);
        if (!event.success) return;
        if (event.data.conversationId) setConversationId(event.data.conversationId);
        if (event.data.type === 'token' && event.data.token) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.data.token } : item));
        if (event.data.type === 'done' && event.data.text) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: event.data.text ?? item.content } : item));
        if (event.data.type === 'error') { setMessages((current) => current.filter((item) => item.id !== assistantId)); setError(event.data.message ?? 'Chat is temporarily unavailable.'); }
      });
      await refreshHistory();
    } catch (streamError) {
      if (!(streamError instanceof DOMException && streamError.name === 'AbortError')) setError(streamError instanceof Error ? streamError.message : 'Chat stopped unexpectedly.');
    } finally { abortRef.current = null; setBusy(false); }
  };

  const attachImage = async (file: File) => {
    if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) { setError('Choose an image smaller than 25 MB.'); return; }
    setUploading(true); setError('');
    try {
      let id = projectId;
      if (!id) {
        const created = await api('/api/projects', z.object({ project: z.object({ id: z.string() }) }), { method: 'POST', body: JSON.stringify({ name: 'My Workbench files', description: 'Private attachments from Chat and Work.' }) });
        id = created.project.id; setProjectId(id);
      }
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/files`, { method: 'POST', body: form, headers: { authorization: `Bearer ${token()}` } });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Image upload failed.');
      const parsed = uploadSchema.parse(payload);
      setAttachments((current) => [...current, { id: parsed.file.fileId, name: parsed.file.originalName }].slice(-5));
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Image upload failed.'); }
    finally { setUploading(false); }
  };

  const runWork = async (goalOverride?: string) => {
    const goal = (goalOverride ?? workInput).trim();
    if (!goal || busy) return;
    setBusy(true); setError(''); setArtifact(null);
    setStages(STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'active' : 'pending' })));
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await api('/api/master', masterStartSchema, { method: 'POST', body: JSON.stringify({ goal, auto_run: true, ...(projectId ? { project_id: projectId } : {}), attachment_file_ids: attachments.map((file) => file.id) }) });
      const id = started.workflow.id; setWorkflowId(id);
      setStages(STAGES.map((stage, index) => ({ ...stage, status: index <= 2 ? 'complete' : index === 3 ? 'active' : 'pending' })));
      const response = await fetch(`/api/master/${encodeURIComponent(id)}/events`, { signal: controller.signal, headers: { authorization: `Bearer ${token()}` } });
      await readSse(response, (raw) => {
        const parsed = z.object({ stages: z.array(z.object({ label: z.string(), status: z.enum(['complete', 'active', 'pending', 'failed']) })), workflowStatus: z.string() }).safeParse(raw);
        if (parsed.success) setStages(parsed.data.stages);
      });
      const result = await api(`/api/master/${encodeURIComponent(id)}`, masterResultSchema);
      setArtifact(result.finalResult ?? result.workflow);
      setArtifactOpen(true);
      await refreshHistory();
    } catch (workError) {
      if (!(workError instanceof DOMException && workError.name === 'AbortError')) setError(workError instanceof Error ? workError.message : 'Work could not be completed. Your credit is not consumed on failure.');
    } finally { abortRef.current = null; setBusy(false); }
  };

  const openWork = async (item: WorkItem) => {
    try {
      const result = await api(`/api/master/${encodeURIComponent(item.id)}`, masterResultSchema);
      setWorkflowId(item.id);
      setWorkInput(item.goal);
      setArtifact(result.finalResult ?? result.workflow);
      setStages(STAGES.map((stage) => ({ ...stage, status: item.status === 'completed' ? 'complete' : 'pending' })));
      setMode('work'); setSidebarOpen(false); setError(''); setArtifactOpen(true);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Work history could not be loaded.'); }
  };

  const retryWork = (item: WorkItem) => {
    stop(); setMode('work'); setSidebarOpen(false); setWorkflowId(null); setArtifact(null); setWorkInput(item.goal); setError('');
    window.setTimeout(() => { void runWork(item.goal); }, 0);
  };

  const cancelWork = async () => {
    stop();
    if (!workflowId) return;
    try {
      await api(`/api/workflows/${encodeURIComponent(workflowId)}/cancel`, z.object({ workflow: z.object({ status: z.string() }) }), { method: 'POST', body: '{}' });
      setStages((current) => current.map((stage) => stage.status === 'active' ? { ...stage, status: 'failed' } : stage));
      setError('Work cancelled. Any reserved free task credit was refunded.');
      await refreshHistory();
    } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : 'Cancellation could not be confirmed.'); }
  };

  const openConversation = async (id: string) => {
    try {
      const data = await api(`/api/chat/${encodeURIComponent(id)}`, conversationSchema);
      setConversationId(id); setMessages(data.messages); setMode('chat'); setSidebarOpen(false); setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Conversation could not be loaded.'); }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/api/chat/${encodeURIComponent(id)}`, z.object({ deleted: z.boolean() }), { method: 'DELETE' });
      if (conversationId === id) { setConversationId(null); setMessages([]); }
      await refreshHistory();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Conversation could not be deleted.'); }
  };

  const chatGroups = useMemo(() => groupByDate(conversations), [conversations]);
  const workGroups = useMemo(() => groupByDate(workItems), [workItems]);
  const artifactText = useMemo(() => artifact === null ? '' : typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2), [artifact]);
  const downloadArtifact = async () => {
    if (!workflowId) return;
    const response = await fetch(`/api/master/${encodeURIComponent(workflowId)}/export`, { headers: { authorization: `Bearer ${token()}` } });
    if (!response.ok) { setError('The authenticated export could not be downloaded.'); return; }
    const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = `akbaral-work-${workflowId}.zip`; link.click(); URL.revokeObjectURL(link.href);
  };

  if (authenticated === null) return <main className={styles.authState}><span className={styles.logo}>A!</span><p>Opening AKBARAL!</p></main>;
  if (!authenticated) return <main className={styles.authState}><span className={styles.logo}>A!</span><h1>Sign in to your workspace</h1><p>Chat history and Work artifacts are private to your account.</p><a href="/signin">Sign in</a></main>;

  return <main className={styles.shell} data-mode={mode} data-artifact={Boolean(artifact)}>
    <header className={styles.topbar}>
      <button type="button" className={styles.iconButton} aria-label="Open history" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
      <a className={styles.brand} href="/#/"><span>A!</span><b>AKBARAL!</b></a>
      <div className={styles.modeTabs} role="tablist" aria-label="Workspace mode">
        {(['chat', 'work'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => setMode(item)}>
          {mode === item && <motion.span layoutId="active-mode" className={styles.activeTab} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span>{item === 'chat' ? <MessageSquare size={17} /> : <Zap size={17} />}{item === 'chat' ? 'Chat' : 'Work'}</span>
        </button>)}
      </div>
      <div className={styles.topActions}>
        <span className={styles.planBadge}>Free · 5 Work tasks</span>
        <div className={styles.accountMenu}>
          <button type="button" className={styles.accountButton} aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
            <UserCircle size={20} /><span>{account?.name || 'Account'}</span><ChevronDown size={14} />
          </button>
          {accountOpen && <nav className={styles.accountPopover} aria-label="Account menu">
            <div><b>{account?.name || 'AKBARAL! account'}</b><small>{account?.email}</small></div>
            <a href="/dashboard">Account &amp; plan</a>
            <a href="/dashboard">Settings</a>
            {['owner', 'super_admin'].includes(account?.role ?? '') && <a href="/owner"><ShieldCheck size={16} /> Owner console</a>}
            {['admin', 'super_admin'].includes(account?.role ?? '') && <a href="/admin"><ShieldCheck size={16} /> Admin console</a>}
            <button type="button" onClick={() => { localStorage.removeItem('ak_access'); localStorage.removeItem('ak_refresh'); window.location.href = '/signin'; }}>Sign out</button>
          </nav>}
        </div>
        {Boolean(artifact) && <button type="button" className={styles.iconButton} aria-label="Open artifact" onClick={() => setArtifactOpen(true)}><PanelRight size={20} /></button>}
      </div>
    </header>

    <div className={styles.body}>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sideHead}><b><History size={17} /> History</b><button type="button" className={styles.iconButton} aria-label="Close history" onClick={() => setSidebarOpen(false)}><ChevronLeft size={20} /></button></div>
        <div className={styles.newActions}>
          <button className={styles.newButton} type="button" onClick={() => { stop(); setMode('chat'); setConversationId(null); setMessages([]); setError(''); }}><Plus size={17} /> New Chat</button>
          <button className={styles.newButton} type="button" onClick={() => { stop(); setMode('work'); setWorkflowId(null); setArtifact(null); setStages(STAGES); setError(''); }}><Zap size={17} /> New Work Task</button>
        </div>
        <div className={styles.historyList}>
          {(mode === 'chat' ? chatGroups : workGroups).map(([label, items]) => <section className={styles.historyGroup} key={label} aria-label={label}>
            <h2>{label}</h2>
            {mode === 'chat' ? (items as Conversation[]).map((item) => <div className={styles.historyItem} key={item.id}>
              <button type="button" onClick={() => void openConversation(item.id)}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString()}</small></button>
              <button type="button" aria-label={`Delete ${item.title}`} onClick={() => void deleteConversation(item.id)}><Trash2 size={15} /></button>
            </div>) : (items as WorkItem[]).map((item) => <div className={styles.workHistoryRow} key={item.id}>
              <button className={styles.workHistoryItem} type="button" onClick={() => void openWork(item)}><span>{item.title}</span><small>{item.status}</small></button>
              <button className={styles.retryWork} type="button" aria-label={`Retry ${item.title}`} onClick={() => retryWork(item)}><RefreshCw size={15} /></button>
            </div>)}
          </section>)}
        </div>
        <a className={styles.settingsLink} href="/dashboard"><Settings size={17} /> Settings</a>
        <div className={styles.sideFooter}><Sparkles size={16} /><p><b>Fair-use Chat</b><br />Chat uses available model-provider quotas and never deducts task credits.</p></div>
      </aside>
      {sidebarOpen && <button type="button" className={styles.scrim} aria-label="Close history" onClick={() => setSidebarOpen(false)} />}

      <section className={styles.center}>
        <AnimatePresence mode="wait">
          {mode === 'chat' ? <motion.div key="chat" className={styles.modePanel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className={styles.panelHead}><div><span>CHAT</span><h1>Ask. Think. Build.</h1><p>No chat credits. Availability follows real provider fair-use quotas.</p></div>
              <label>Model<select aria-label="Chat model" value={model} onChange={(event) => setModel(event.target.value)}>{models.length ? models.map((item) => <option key={item.key} value={item.key}>{item.name}{item.available ? '' : ' · unavailable'}</option>) : <option value={DEFAULT_MODEL}>Gemini 3.8 Flash</option>}</select></label>
            </div>
            <div className={styles.messages} aria-live="polite">
              {messages.length === 0 && <div className={styles.empty}><MessageSquare size={28} /><h2>One conversation, clear answers.</h2><p>Ask for analysis, writing, planning, or code. Chat does not consume Work task credits.</p></div>}
              {messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}><header><b>{message.role === 'user' ? 'You' : 'AKBARAL!'}</b>{message.content && <CopyButton value={message.content} />}</header><Markdown content={message.content || '…'} /></article>)}
            </div>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.composerDock}><Composer value={chatInput} setValue={setChatInput} onSubmit={() => void sendChat()} busy={busy} onStop={stop} placeholder="Message AKBARAL!" onAttach={attachImage} attachments={attachments.map((file) => file.name)} />
              <p className={styles.fairUse}>Fair use applies. <a href="/terms">See terms.</a> Chat never deducts Work task credits.</p>
              {messages.some((item) => item.role === 'assistant' && item.content) && !busy && <button className={styles.regenerate} type="button" onClick={() => { const last = [...messages].reverse().find((item) => item.role === 'user'); if (last) void sendChat(last.content); }}><RefreshCw size={15} /> Regenerate</button>}
            </div>
          </motion.div> : <motion.div key="work" className={styles.modePanel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className={styles.panelHead}><div><span>WORK · MASTER ROUTING</span><h1>From goal to verified artifact.</h1><p>5 successful tasks during the 30-day Free trial. Failed or cancelled work is refunded.</p></div></div>
            <div className={styles.examples}>{EXAMPLES.map((example) => <button type="button" key={example} onClick={() => setWorkInput(example)}>{example}</button>)}</div>
            <div className={styles.workComposer}><Composer value={workInput} setValue={setWorkInput} onSubmit={() => void runWork()} busy={busy} onStop={() => void cancelWork()} placeholder="Describe what you want built or done..." minRows={4} buttonLabel={uploading ? 'Uploading…' : 'Start Task'} onAttach={attachImage} attachments={attachments.map((file) => file.name)} /></div>
            <ol className={styles.stages} aria-label="Work progress">{stages.map((stage, index) => <li key={stage.label} data-status={stage.status}><span>{stage.status === 'complete' ? <Check size={16} /> : index + 1}</span><div><b>{stage.label}</b><small>{stage.status}</small></div></li>)}</ol>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {Boolean(artifact) && <button type="button" className={styles.artifactCard} onClick={() => setArtifactOpen(true)}><FileText size={22} /><span><b>Final artifact</b><small>Preview and download verified output</small></span><Play size={17} /></button>}
          </motion.div>}
        </AnimatePresence>
      </section>

      <aside className={`${styles.artifactPanel} ${artifactOpen ? styles.artifactOpen : ''}`} aria-label="Artifact preview">
        <header><div><span>ARTIFACT</span><b>{workflowId ? `Work ${workflowId.slice(-8)}` : 'Preview'}</b></div><div><button type="button" className={styles.iconButton} onClick={downloadArtifact} disabled={!artifact} aria-label="Download artifact"><Download size={18} /></button><button type="button" className={styles.iconButton} onClick={() => setArtifactOpen(false)} aria-label="Close artifact"><X size={18} /></button></div></header>
        <div className={styles.preview}>{artifact ? /^\s*<(?:!doctype html|html[\s>])/i.test(artifactText) ? <iframe title="Sandboxed website artifact" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${artifactText}`} /> : <pre>{artifactText}</pre> : <div className={styles.empty}><FileText size={30} /><p>Your completed Work artifact will appear here.</p></div>}</div>
        <footer><span data-ready={Boolean(artifact)}>{artifact ? 'Ready' : busy ? 'Working' : 'Waiting'}</span><small>{artifactText.length ? `${artifactText.length.toLocaleString()} characters` : 'No artifact yet'}</small></footer>
      </aside>
    </div>
  </main>;
}
