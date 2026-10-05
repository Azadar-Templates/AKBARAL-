'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, apiJson, storedAccessToken } from '../app-shell';
import styles from './workbench-shell.module.css';

type Mode = 'chat' | 'work';
type ChatRole = 'user' | 'assistant';
type ChatMessage = { id: string; role: ChatRole; content: string };
type StageStatus = 'complete' | 'active' | 'pending' | 'failed';
type Stage = { label: string; status: StageStatus };
type ModelChoice = {
  key: string;
  name: string;
  provider: string;
  available: boolean;
  requiredEnvKey?: string | null;
  costInputPerMillionCents?: number | null;
  costOutputPerMillionCents?: number | null;
  latencyMs?: number | null;
};
type UploadRecord = { id: string; name: string };
type Conversation = { id: string; title: string; model: string; updatedAt: string };
type AttachmentSupport = { key: string; supportsAttachments: boolean; reason: string | null; detail: string };
type AttachmentDelivery = { id: string; name: string; mime: string; bytes: number; delivery: 'extracted_text' | 'metadata_only'; reason: string | null; characters: number };
type ToolEvent = { id: string; tool: string; status: string; code: string | null; requiredEnvKey: string | null; message: string; at: string };

type ChatEvent = { type?: string; token?: string; text?: string; conversationId?: string; message?: string; code?: string; reason?: string; count?: number; attachments?: AttachmentDelivery[] };
type MasterStart = { workflow?: { id?: string; status?: string } };
type MasterEvent = { stages?: Stage[]; workflowStatus?: string };
type MasterResult = { workflow?: unknown; finalResult?: unknown | null };

type ProjectsPayload = { projects?: Array<{ id?: string }> };
type ModelsPayload = { models?: ModelChoice[] };
type UploadPayload = { file?: { fileId?: string; originalName?: string } };
type ConversationsPayload = { conversations?: Conversation[] };
type ConversationPayload = { conversation?: { id?: string; model?: string }; messages?: Array<{ id?: string; role?: string; content?: string }> };
type AttachmentSupportPayload = { models?: AttachmentSupport[] };
type MasterActivity = { activity?: ToolEvent[] };
type ProjectDetailPayload = { files?: Array<{ id?: string; original_name?: string; originalName?: string; mime_type?: string; mimeType?: string; size_bytes?: number; created_at?: string }> };
type ArtifactsPayload = { artifacts?: Array<{ id?: string; original_name?: string; mime_type?: string; size_bytes?: number; created_at?: string }> };
type WebsiteArtifactPayload = { artifact?: { title?: string; content?: string; version?: number } | null; note?: string };
type PanelTab = 'files' | 'artifacts' | 'preview';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DISCLOSURE_KEY = 'ak_ai_disclosure_dismissed';
/** AKBARAL!-authored starter prompts. Chips only prefill the composer. */
const STARTER_PROMPTS = [
  'Write a landing page',
  'Explain my error',
  'Plan a side-project',
  'Summarize an article',
  'Draft a proposal',
];
const STAGES: Stage[] = ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete'].map((label) => ({ label, status: 'pending' }));

function authHeaders(json = true) {
  const headers = new Headers();
  if (json) headers.set('content-type', 'application/json');
  const token = storedAccessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function eventAsChat(value: unknown): ChatEvent {
  const row = asRecord(value);
  return {
    type: typeof row.type === 'string' ? row.type : undefined,
    token: typeof row.token === 'string' ? row.token : undefined,
    text: typeof row.text === 'string' ? row.text : undefined,
    conversationId: typeof row.conversationId === 'string' ? row.conversationId : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    code: typeof row.code === 'string' ? row.code : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    count: typeof row.count === 'number' ? row.count : undefined,
    attachments: Array.isArray(row.attachments) ? row.attachments as AttachmentDelivery[] : undefined,
  };
}

/** Tool rows are rendered ONLY from persisted server events — never invented. */
function eventAsTools(value: unknown): ToolEvent[] {
  const row = asRecord(value);
  if (!Array.isArray(row.tools)) return [];
  return row.tools.map((item) => {
    const entry = asRecord(item);
    return {
      id: String(entry.id ?? ''),
      tool: typeof entry.tool === 'string' ? entry.tool : 'tool',
      status: typeof entry.status === 'string' ? entry.status : 'ok',
      code: typeof entry.code === 'string' ? entry.code : null,
      requiredEnvKey: typeof entry.requiredEnvKey === 'string' ? entry.requiredEnvKey : null,
      message: typeof entry.message === 'string' ? entry.message : '',
      at: typeof entry.at === 'string' ? entry.at : '',
    };
  }).filter((entry) => entry.id !== '');
}

/** Catalog cost in cents per 1k tokens; `unknown` when the catalog omits it. */
function costPer1k(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  const cents = value / 1000;
  return cents === 0 ? 'free' : `${cents >= 1 ? cents.toFixed(2) : cents.toFixed(3)}¢/1k`;
}

function latencyLabel(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `~${value}ms` : 'unknown';
}

function modelOptionLabel(model: ModelChoice) {
  if (!model.available) return `${model.name} — requires ${model.requiredEnvKey ?? 'provider credential'}`;
  return `${model.name} · in ${costPer1k(model.costInputPerMillionCents)} · out ${costPer1k(model.costOutputPerMillionCents)} · ${latencyLabel(model.latencyMs)}`;
}

function eventAsMaster(value: unknown): MasterEvent {
  const row = asRecord(value);
  const stages = Array.isArray(row.stages)
    ? row.stages.map((item) => {
        const stage = asRecord(item);
        const label = typeof stage.label === 'string' ? stage.label : '';
        const status = typeof stage.status === 'string' && ['complete', 'active', 'pending', 'failed'].includes(stage.status) ? stage.status as StageStatus : 'pending';
        return label ? { label, status } : null;
      }).filter((item): item is Stage => Boolean(item))
    : undefined;
  return { stages, workflowStatus: typeof row.workflowStatus === 'string' ? row.workflowStatus : undefined };
}

/** Group real sessions by the day they were last updated. No synthetic rows. */
function groupSessions(rows: Conversation[]) {
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 86_400_000;
  const groups: Array<{ label: string; rows: Conversation[] }> = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'Older', rows: [] },
  ];
  for (const row of rows) {
    const stamp = Date.parse(row.updatedAt ?? '');
    const day = Number.isNaN(stamp) ? 0 : startOfDay(new Date(stamp));
    if (day >= today) groups[0]!.rows.push(row);
    else if (day >= yesterday) groups[1]!.rows.push(row);
    else groups[2]!.rows.push(row);
  }
  return groups.filter((group) => group.rows.length > 0);
}

function fileLabel(file: { original_name?: string; originalName?: string }) {
  return file.original_name || file.originalName || 'Untitled file';
}

function Markdown({ content }: { content: string }) {
  return <div className={styles.markdown}>{content.split('\n').map((line, index) => {
    if (line.startsWith('### ')) return <h3 key={index}>{line.slice(4)}</h3>;
    if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
    if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
    if (line.startsWith('- ')) return <p key={index}>• {line.slice(2)}</p>;
    return line ? <p key={index}>{line}</p> : <br key={index} />;
  })}</div>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className={styles.copy} type="button" onClick={() => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); });
  }}>{copied ? 'Copied' : 'Copy'}</button>;
}

function Composer({ value, setValue, onSubmit, busy, onStop, placeholder, buttonLabel, onAttach, onAttachFile, attachments, attachDisabledReason }: {
  value: string;
  setValue: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onStop: () => void;
  placeholder: string;
  buttonLabel: string;
  onAttach?: (file: File) => void;
  onAttachFile?: (file: File) => void;
  attachments?: UploadRecord[];
  attachDisabledReason?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 112), Math.max(window.innerHeight * 0.3, 180))}px`;
  }, [value]);

  return <div className={styles.composerCard}>
    {attachments && attachments.length > 0 ? <div className={styles.attachments}>{attachments.map((file) => <span key={file.id}>{file.name}</span>)}</div> : null}
    <div className={styles.composer}>
      <textarea ref={ref} rows={4} value={value} maxLength={20_000} placeholder={placeholder} aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy) onSubmit(); }
        }} />
      <div className={styles.toolbar}>
        {onAttachFile ? (attachDisabledReason
          ? <button className={styles.uploadButton} type="button" disabled title={attachDisabledReason} aria-describedby="composer-attach-reason">Attach file</button>
          : <label className={styles.uploadButton}>Attach file<input type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onAttachFile(file); event.currentTarget.value = ''; }} /></label>) : null}
        {onAttach ? (attachDisabledReason
          ? <button className={styles.uploadButton} type="button" disabled title={attachDisabledReason} aria-describedby="composer-attach-reason">Upload image</button>
          : <label className={styles.uploadButton}>Upload image<input type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onAttach(file); event.currentTarget.value = ''; }} /></label>) : null}
        {busy ? <button className={styles.stopButton} type="button" onClick={onStop}>Stop</button> : <button className={styles.sendButton} type="button" onClick={onSubmit} disabled={!value.trim()}>{buttonLabel}</button>}
      </div>
    </div>
    {attachDisabledReason ? <p className={styles.attachReason} id="composer-attach-reason">{attachDisabledReason}</p> : null}
  </div>;
}

export function WorkbenchShell({ initialMode = 'chat' }: { initialMode?: Mode }) {
  const [mode] = useState<Mode>(initialMode);
  const [chatInput, setChatInput] = useState('');
  const [workInput, setWorkInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [artifact, setArtifact] = useState<unknown>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<UploadRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachmentSupport, setAttachmentSupport] = useState<AttachmentSupport[]>([]);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [disclosureOpen, setDisclosureOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('files');
  const [panelFiles, setPanelFiles] = useState<Array<{ id?: string; original_name?: string; originalName?: string; mime_type?: string; size_bytes?: number }>>([]);
  const [panelArtifacts, setPanelArtifacts] = useState<Array<{ id?: string; original_name?: string; mime_type?: string; size_bytes?: number }>>([]);
  const [websiteArtifact, setWebsiteArtifact] = useState<{ title?: string; content?: string; version?: number } | null>(null);
  const [panelError, setPanelError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const toolLogRef = useRef<HTMLOListElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  /** Conversations come only from the authenticated history endpoint. */
  const loadConversations = useCallback(async (query: string) => {
    setHistoryLoading(true);
    try {
      const payload = await apiJson<ConversationsPayload>(`/api/chat${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
      setConversations(payload.conversations ?? []);
      setHistoryError('');
    } catch (cause) {
      setConversations([]);
      setHistoryError(cause instanceof Error ? cause.message : 'Chat history could not be loaded.');
    } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    try { if (window.sessionStorage.getItem(DISCLOSURE_KEY) === '1') setDisclosureOpen(false); } catch {}
  }, []);

  // Session rail: expanded from 768px up, collapsed below it.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const apply = () => setRailOpen(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  /** Right panel content: real project files and artifacts only. */
  const loadPanel = useCallback(async (id: string) => {
    try {
      const [detail, artifacts, website] = await Promise.all([
        apiJson<ProjectDetailPayload>(`/api/projects/${encodeURIComponent(id)}`),
        apiJson<ArtifactsPayload>(`/api/projects/${encodeURIComponent(id)}/artifacts`).catch(() => ({ artifacts: [] } as ArtifactsPayload)),
        apiJson<WebsiteArtifactPayload>(`/api/projects/${encodeURIComponent(id)}/artifacts/website`).catch(() => ({ artifact: null } as WebsiteArtifactPayload)),
      ]);
      setPanelFiles(detail.files ?? []);
      setPanelArtifacts(artifacts.artifacts ?? []);
      setWebsiteArtifact(website.artifact ?? null);
      setPanelError('');
      // Opens by itself only on a wide screen AND only when real output exists.
      const hasOutput = (artifacts.artifacts ?? []).length > 0 || Boolean(website.artifact);
      if (hasOutput && window.matchMedia('(min-width: 1280px)').matches) setPanelOpen(true);
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : 'Project output is temporarily unavailable.');
    }
  }, []);

  useEffect(() => { if (projectId) void loadPanel(projectId); }, [projectId, loadPanel]);

  // Keep the newest content visible; the thread scrolls, never the page.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      apiJson<ProjectsPayload>('/api/projects').then((payload) => { if (live) setProjectId(payload.projects?.[0]?.id ?? null); }),
      // Catalog truth: every model the server returns, with its real
      // availability, required credential, cost and latency. No client filter.
      apiJson<ModelsPayload>('/api/models').then((payload) => {
        if (!live) return;
        const choices = (payload.models ?? []).filter((item) => item.key && item.name);
        setModels(choices);
        const firstAvailable = choices.find((item) => item.available);
        if (firstAvailable) setModel(firstAvailable.key);
      }),
      apiJson<AttachmentSupportPayload>('/api/chat/attachment-support').then((payload) => { if (live) setAttachmentSupport(payload.models ?? []); }),
      loadConversations('').then(() => undefined),
    ]).catch(() => undefined);
    return () => { live = false; };
  }, [loadConversations]);

  const activeSupport = useMemo(() => attachmentSupport.find((item) => item.key === model) ?? null, [attachmentSupport, model]);
  const attachDisabledReason = activeSupport && !activeSupport.supportsAttachments ? activeSupport.detail : undefined;

  const resumeConversation = async (id: string) => {
    try {
      const payload = await apiJson<ConversationPayload>(`/api/chat/${encodeURIComponent(id)}`);
      setMessages((payload.messages ?? []).map((message) => ({
        id: String(message.id ?? crypto.randomUUID()),
        role: message.role === 'user' ? 'user' : 'assistant',
        content: String(message.content ?? ''),
      })));
      setConversationId(payload.conversation?.id ?? id);
      if (payload.conversation?.model) setModel(payload.conversation.model);
      setError('');
    } catch (cause) { setHistoryError(cause instanceof Error ? cause.message : 'That conversation could not be opened.'); }
  };

  const deleteConversation = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this conversation? This cannot be undone.')) return;
    const previous = conversations;
    setConversations((current) => current.filter((item) => item.id !== id));
    try {
      await apiJson(`/api/chat/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (conversationId === id) { setConversationId(null); setMessages([]); }
    } catch (cause) {
      setConversations(previous);
      setHistoryError(cause instanceof Error ? cause.message : 'That conversation could not be deleted.');
    }
  };

  const stop = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  const attachFile = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) { setError('Choose a file smaller than 25 MB.'); return; }
    await uploadAttachment(file);
  };

  const attachImage = async (file: File) => {
    if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) { setError('Choose an image smaller than 25 MB.'); return; }
    await uploadAttachment(file);
  };

  const uploadAttachment = async (file: File) => {
    setUploading(true); setError('');
    try {
      let id = projectId;
      if (!id) {
        const created = await apiJson<{ project?: { id?: string } }>('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'My AKBARAL! files', description: 'Private uploads from Chat and Task.' }) });
        id = created.project?.id ?? null;
        setProjectId(id);
      }
      if (!id) throw new Error('Project could not be created for the upload.');
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/files`, { method: 'POST', credentials: 'same-origin', headers: authHeaders(false), body: form });
      const payload = await response.json().catch(() => ({})) as UploadPayload;
      if (!response.ok) throw new Error('Upload failed.');
      const fileId = payload.file?.fileId;
      const name = payload.file?.originalName;
      if (!fileId || !name) throw new Error('Upload response was incomplete.');
      setAttachments((current) => [...current, { id: fileId, name }].slice(-5));
      void loadPanel(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { setUploading(false); }
  };

  const sendChat = async (contentOverride?: string) => {
    const content = (contentOverride ?? chatInput).trim();
    if (!content || busy) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setChatInput(''); setError(''); setAttachmentNote(''); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    const sentAttachmentIds = attachments.map((file) => file.id);
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: authHeaders(true),
        body: JSON.stringify({ conversationId, content, model, ...(sentAttachmentIds.length ? { attachment_file_ids: sentAttachmentIds } : {}) }),
      });
      await readSse(response, (raw) => {
        const event = eventAsChat(raw);
        if (event.conversationId) setConversationId(event.conversationId);
        if (event.type === 'attachment') {
          // Verbatim server account of what was actually included.
          const detail = (event.attachments ?? []).map((file) => `${file.name} (${file.delivery}${file.reason ? `: ${file.reason}` : ''})`).join(', ');
          setAttachmentNote(`${event.message ?? `attachment count: ${event.count ?? 0}`}${detail ? ` — ${detail}` : ''}`);
          setAttachments([]);
        }
        if (event.type === 'token' && event.token) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.token } : item));
        if (event.type === 'done' && event.text) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: event.text ?? item.content } : item));
        if (event.type === 'error') {
          setMessages((current) => current.filter((item) => item.id !== assistantId));
          setError(event.reason ? `${event.code ?? 'error'} (${event.reason}): ${event.message ?? ''}`.trim() : (event.message ?? 'Chat is temporarily unavailable.'));
        }
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Chat stopped unexpectedly.');
    } finally {
      abortRef.current = null; setBusy(false);
      void loadConversations(historyQuery);
    }
  };

  const runWork = async () => {
    const goal = workInput.trim();
    if (!goal || busy) return;
    setBusy(true); setError(''); setArtifact(null); setTools([]);
    setStages(STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'active' : 'pending' })));
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const started = await apiJson<MasterStart>('/api/master', { method: 'POST', body: JSON.stringify({ goal, auto_run: true, ...(projectId ? { project_id: projectId } : {}), attachment_file_ids: attachments.map((file) => file.id) }) });
      const id = started.workflow?.id;
      if (!id) throw new Error('Work did not return a workflow id.');
      setWorkflowId(id);
      setStages(STAGES.map((stage, index) => ({ ...stage, status: index <= 2 ? 'complete' : index === 3 ? 'active' : 'pending' })));
      const response = await fetch(`/api/master/${encodeURIComponent(id)}/events`, { credentials: 'same-origin', signal: controller.signal, headers: authHeaders(false) });
      await readSse(response, (raw) => {
        const event = eventAsMaster(raw);
        if (event.stages?.length) setStages(event.stages);
        // Append-only: the server sends the full persisted tool list, so the
        // UI only ever grows it — no placeholder rows are created locally.
        const toolEvents = eventAsTools(raw);
        if (toolEvents.length) setTools(toolEvents);
      });
      // Final drain so a tool that logged in the last tick is never lost.
      try {
        const activity = await apiJson<MasterActivity>(`/api/master/${encodeURIComponent(id)}/activity`);
        if (activity.activity?.length) setTools(activity.activity);
      } catch { /* activity is advisory; the task result is authoritative */ }
      const result = await apiJson<MasterResult>(`/api/master/${encodeURIComponent(id)}`);
      setArtifact(result.finalResult ?? result.workflow ?? null);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Work could not be completed. Credits are consumed only on success — failures refund automatically.');
    } finally { abortRef.current = null; setBusy(false); }
  };

  const cancelWork = async () => {
    stop();
    if (!workflowId) return;
    try {
      await apiJson<{ workflow?: { status?: string } }>(`/api/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: 'POST', body: '{}' });
      setStages((current) => current.map((stage) => stage.status === 'active' ? { ...stage, status: 'failed' } : stage));
      setError('Work cancelled. Any reserved task credit was refunded.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation could not be confirmed.'); }
  };

  // Autoscroll the append-only tool log to the newest real event.
  useEffect(() => {
    const list = toolLogRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [tools]);

  const artifactText = useMemo(() => artifact === null ? '' : typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2), [artifact]);
  const artifactIsHtml = /^\s*<(?:!doctype html|html[\s>])/i.test(artifactText);

  const downloadArtifact = async () => {
    if (!workflowId) { setError('Run a Work task before exporting.'); return; }
    const response = await fetch(`/api/master/${encodeURIComponent(workflowId)}/export`, { credentials: 'same-origin', headers: authHeaders(false) });
    if (!response.ok) { setError('The authenticated export could not be downloaded.'); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = `akbaral-work-${workflowId}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const title = mode === 'chat' ? 'Session' : 'Task';
  const sessionStatus = error ? 'error' : busy ? 'streaming' : 'idle';
  const sessionTitle = conversations.find((item) => item.id === conversationId)?.title || 'New session';
  const sessionGroups = groupSessions(conversations);

  const startNewSession = () => {
    stop();
    setConversationId(null); setMessages([]); setChatInput(''); setError(''); setAttachmentNote(''); setAttachments([]);
  };

  if (mode === 'chat') return <AppShell title={title} chrome="focus">
    <div className={styles.session}>
      {/* 1 — LEFT: real sessions for this account */}
      <aside className={styles.sessionRail} id="session-rail" aria-label="Sessions" hidden={!railOpen}>
        <div className={styles.railBrand}>
          <span className={styles.railMark} aria-hidden="true">A!</span>
          <b>AKBARAL!</b>
          <button className={styles.railCollapse} type="button" aria-expanded={railOpen} aria-controls="session-rail" aria-label="Collapse sessions" onClick={() => setRailOpen(false)}>‹</button>
        </div>
        <button className={styles.newSessionButton} type="button" onClick={startNewSession}>+ New session</button>
        <form className={styles.historySearch} role="search" onSubmit={(event) => { event.preventDefault(); void loadConversations(historyQuery); }}>
          <input type="search" value={historyQuery} aria-label="Search your sessions" placeholder="Search sessions"
            onChange={(event) => setHistoryQuery(event.target.value)} />
          <button className={styles.smallButton} type="submit">Search</button>
        </form>
        <div className={styles.railList}>
          {historyError ? <p className={styles.error} role="alert">{historyError}</p> : null}
          {historyLoading ? <p className={styles.hint}>Loading your sessions…</p> : null}
          {!historyLoading && conversations.length === 0 ? <p className={styles.hint}>{historyQuery.trim() ? 'No sessions match that search.' : 'No sessions yet.'}</p> : null}
          {sessionGroups.map((group) => <section key={group.label} className={styles.railGroup}>
            <h3>{group.label}</h3>
            <ul>
              {group.rows.map((conversation) => <li key={conversation.id}>
                <button className={styles.historyOpenButton} type="button" aria-current={conversationId === conversation.id ? 'true' : undefined} onClick={() => void resumeConversation(conversation.id)}>
                  <b>{conversation.title || 'Untitled session'}</b><small>{conversation.updatedAt?.slice(0, 10) || ''}</small>
                </button>
                <button className={styles.historyDeleteButton} type="button" aria-label={`Delete session ${conversation.title || 'Untitled session'}`} onClick={() => void deleteConversation(conversation.id)}>Delete</button>
              </li>)}
            </ul>
          </section>)}
        </div>
        <nav className={styles.railFooter} aria-label="Workspace links">
          <a href="/work">Task</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </aside>

      {/* 2 — CENTER: top bar, thread, docked composer */}
      <div className={styles.sessionMain}>
        <header className={styles.sessionBar}>
          <a className={styles.backLink} href="/" aria-label="Back to home">‹</a>
          {railOpen ? null : <button className={styles.railOpenButton} type="button" aria-expanded={railOpen} aria-controls="session-rail" onClick={() => setRailOpen(true)}>Sessions</button>}
          <h2 className={styles.sessionTitle}>{sessionTitle}</h2>
          <span className={styles.statusDot} data-state={sessionStatus} aria-hidden="true" />
          <span className={styles.statusText} role="status">{sessionStatus}</span>
          <button className={styles.panelToggle} type="button" aria-expanded={panelOpen} aria-controls="session-panel" onClick={() => setPanelOpen((open) => !open)}>Files</button>
        </header>
        {/* Thread renders BEFORE the composer; the composer dock is the last child. */}
        <section className={styles.chatWrap}>
          <div className={styles.messages} ref={threadRef} aria-live="polite" aria-label="Conversation">
            {messages.length === 0 ? <div className={styles.empty}><h3>How can I help?</h3><p>No conversation yet. Your real chat will appear here after you send a message.</p></div> : null}
            {messages.map((message) => <article key={message.id} className={styles.message} data-role={message.role}><header><b>{message.role === 'user' ? 'You' : 'AKBARAL!'}</b>{message.content ? <CopyButton value={message.content} /> : null}</header><Markdown content={message.content || '…'} />{busy && message.role === 'assistant' && !message.content ? <span className={styles.streamCursor} aria-hidden="true" /> : null}</article>)}
            {tools.length > 0 ? <ol className={styles.inlineTools} aria-label="Tool activity">
              {tools.map((event) => <li key={event.id} data-status={event.status}><b>{event.tool}</b><span>{event.message}</span>{event.code ? <code>{event.code}</code> : null}{event.requiredEnvKey ? <small>set {event.requiredEnvKey}</small> : null}</li>)}
            </ol> : null}
          </div>
          <div className={styles.composerDock}>
            {messages.length === 0 ? <div className={styles.starters}>
              {STARTER_PROMPTS.map((prompt) => <button key={prompt} className={styles.starterChip} type="button" onClick={() => setChatInput(prompt)}>{prompt}</button>)}
            </div> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {attachmentNote ? <p className={styles.attachNote}>{attachmentNote}</p> : null}
            <div className={styles.composerMeta}>
              <label className={styles.modelLabel}>Model
                <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Chat model">
                  {models.length ? models.map((item) => <option key={item.key} value={item.key} disabled={!item.available}>{modelOptionLabel(item)}</option>) : <option value={DEFAULT_MODEL}>Loading catalog…</option>}
                </select>
              </label>
              <button className={styles.smallButton} type="button" onClick={startNewSession}>New chat</button>
            </div>
            <Composer value={chatInput} setValue={setChatInput} onSubmit={() => void sendChat()} busy={busy} onStop={stop} placeholder="Message AKBARAL!" buttonLabel={uploading ? 'Uploading…' : 'Send'} onAttach={attachImage} onAttachFile={attachFile} attachments={attachments} attachDisabledReason={attachDisabledReason} />
            <p className={styles.hint}>AI can make mistakes. Verify important information. Chat never deducts Work task credits.</p>
            {disclosureOpen ? <div className={styles.disclosure} role="note">
              <span>AI can make mistakes. Verify important information. <a href="/privacy">Privacy</a></span>
              <button type="button" aria-label="Dismiss AI notice" onClick={() => { setDisclosureOpen(false); try { window.sessionStorage.setItem(DISCLOSURE_KEY, '1'); } catch {} }}>Dismiss</button>
            </div> : null}
          </div>
        </section>
      </div>

      {/* 3 — RIGHT: real files, artifacts and sandboxed preview */}
      <aside className={styles.sessionPanel} id="session-panel" aria-label="Session output" hidden={!panelOpen}>
        <div className={styles.panelTabs} role="tablist" aria-label="Session output tabs">
          {(['files', 'artifacts', 'preview'] as PanelTab[]).map((tab) => <button key={tab} role="tab" type="button" id={`panel-tab-${tab}`} aria-selected={panelTab === tab} aria-controls={`panel-pane-${tab}`} className={styles.panelTab} onClick={() => setPanelTab(tab)}>{tab === 'files' ? 'Files' : tab === 'artifacts' ? 'Artifacts' : 'Preview'}</button>)}
          <button className={styles.panelClose} type="button" aria-label="Close output panel" onClick={() => setPanelOpen(false)}>×</button>
        </div>
        {panelError ? <p className={styles.error} role="alert">{panelError}</p> : null}
        <div className={styles.panelBody} role="tabpanel" id={`panel-pane-${panelTab}`} aria-labelledby={`panel-tab-${panelTab}`}>
          {panelTab === 'files' ? (panelFiles.length === 0
            ? <p className={styles.hint}>No files yet. Files you attach in this workspace appear here.</p>
            : <ul className={styles.panelList}>{panelFiles.map((file) => <li key={file.id ?? fileLabel(file)}><span><b>{fileLabel(file)}</b><small>{file.mime_type ?? 'unknown type'}</small></span>{file.id ? <a className={styles.smallButton} href={`/api/files/${encodeURIComponent(file.id)}`}>Download</a> : null}</li>)}</ul>) : null}
          {panelTab === 'artifacts' ? (panelArtifacts.length === 0 && !websiteArtifact
            ? <p className={styles.hint}>No artifacts yet. Completed Work output is stored here.</p>
            : <ul className={styles.panelList}>
                {websiteArtifact && projectId ? <li key="website"><span><b>{websiteArtifact.title || 'Website artifact'}</b><small>version {websiteArtifact.version ?? 1}</small></span><a className={styles.smallButton} href={`/api/projects/${encodeURIComponent(projectId)}/artifacts/website/download`}>Download</a></li> : null}
                {panelArtifacts.map((file) => <li key={file.id ?? fileLabel(file)}><span><b>{fileLabel(file)}</b><small>{file.mime_type ?? 'unknown type'}</small></span>{file.id ? <a className={styles.smallButton} href={`/api/files/${encodeURIComponent(file.id)}`}>Download</a> : null}</li>)}
              </ul>) : null}
          {panelTab === 'preview' ? (websiteArtifact?.content
            ? <iframe className={styles.panelPreview} title="Sandboxed session artifact" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${websiteArtifact.content}`} />
            : <p className={styles.hint}>No preview yet. A completed website artifact renders here in a sandboxed frame.</p>) : null}
        </div>
      </aside>
    </div>
  </AppShell>;

  return <AppShell title={title}>
    <div className={styles.page}>
      <>
        <section className={styles.hero} aria-labelledby="work-title">
          <span>AKBARAL! Task</span>
          <h2 id="work-title">Describe the goal.</h2>
          <p>Run a tracked Work task with visible stages, a sandboxed preview, image upload, and authenticated ZIP export.</p>
        </section>
        <section className={styles.workGrid}>
          <div className={styles.workMain}>
            <Composer value={workInput} setValue={setWorkInput} onSubmit={() => void runWork()} busy={busy} onStop={() => void cancelWork()} placeholder="Describe what you want built, researched, written, analyzed, or prepared…" buttonLabel={uploading ? 'Uploading…' : 'Start task'} onAttach={attachImage} attachments={attachments} />
            <p className={styles.hint}>Credits are consumed only on success — failures refund automatically.</p>
            <ol className={styles.stages} aria-label="Work progress">
              {stages.map((stage, index) => <li key={stage.label} data-status={stage.status}><span className={styles.stageNum}>{stage.status === 'complete' ? '✓' : index + 1}</span><b>{stage.label}</b><small>{stage.status}</small></li>)}
            </ol>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <section className={styles.toolLog} aria-label="Tool activity">
              <h3>Tool activity</h3>
              {tools.length === 0
                ? <p className={styles.hint}>No tool has run yet. Rows appear only when a tool genuinely runs.</p>
                : <ol className={styles.toolList} ref={toolLogRef}>
                    {tools.map((event) => <li key={event.id} data-status={event.status}>
                      <b>{event.tool}</b>
                      <span className={styles.toolMessage}>{event.message}</span>
                      {event.code ? <code>{event.code}</code> : null}
                      {event.requiredEnvKey ? <small>set {event.requiredEnvKey}</small> : null}
                      <time dateTime={event.at}>{event.at.slice(11, 19)}</time>
                    </li>)}
                  </ol>}
            </section>
          </div>
          <aside className={styles.previewRail} aria-label="Work preview rail">
            <div className={styles.previewHead}><h3>Preview</h3><button className={styles.downloadButton} type="button" onClick={() => void downloadArtifact()} disabled={!artifact}>Export ZIP</button></div>
            <div className={styles.previewBox}>
              {artifact ? (artifactIsHtml ? <iframe title="Sandboxed Work artifact" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${artifactText}`} /> : <pre>{artifactText}</pre>) : <div className={styles.previewEmpty}><div><b>No artifact yet.</b><span>Your completed Work output appears here. The frame is sandboxed for safety.</span></div></div>}
            </div>
          </aside>
        </section>
      </>
    </div>
  </AppShell>;
}
