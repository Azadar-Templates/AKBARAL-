'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, apiJson, storedAccessToken } from '../app-shell';
import styles from './workbench-shell.module.css';

type Mode = 'chat' | 'work';
type ChatRole = 'user' | 'assistant';
type ChatMessage = { id: string; role: ChatRole; content: string };
type StageStatus = 'complete' | 'active' | 'pending' | 'failed';
type Stage = { label: string; status: StageStatus };
type ModelChoice = { key: string; name: string; provider: string; available: boolean };
type UploadRecord = { id: string; name: string };

type ChatEvent = { type?: string; token?: string; text?: string; conversationId?: string; message?: string };
type MasterStart = { workflow?: { id?: string; status?: string } };
type MasterEvent = { stages?: Stage[]; workflowStatus?: string };
type MasterResult = { workflow?: unknown; finalResult?: unknown | null };

type ProjectsPayload = { projects?: Array<{ id?: string }> };
type ModelsPayload = { models?: ModelChoice[] };
type UploadPayload = { file?: { fileId?: string; originalName?: string } };

const DEFAULT_MODEL = 'gemini-3.8-flash';
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
  };
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

function Composer({ value, setValue, onSubmit, busy, onStop, placeholder, buttonLabel, onAttach, attachments }: {
  value: string;
  setValue: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onStop: () => void;
  placeholder: string;
  buttonLabel: string;
  onAttach?: (file: File) => void;
  attachments?: UploadRecord[];
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
        {onAttach ? <label className={styles.uploadButton}>Upload image<input type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onAttach(file); event.currentTarget.value = ''; }} /></label> : null}
        {busy ? <button className={styles.stopButton} type="button" onClick={onStop}>Stop</button> : <button className={styles.sendButton} type="button" onClick={onSubmit} disabled={!value.trim()}>{buttonLabel}</button>}
      </div>
    </div>
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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      apiJson<ProjectsPayload>('/api/projects').then((payload) => { if (live) setProjectId(payload.projects?.[0]?.id ?? null); }),
      apiJson<ModelsPayload>('/api/models').then((payload) => {
        if (!live) return;
        const choices = (payload.models ?? []).filter((item) => item.available && item.provider === 'google' && /gemini/i.test(`${item.key} ${item.name}`));
        setModels(choices);
        setModel(choices[0]?.key ?? DEFAULT_MODEL);
      }),
    ]).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const stop = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  const attachImage = async (file: File) => {
    if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) { setError('Choose an image smaller than 25 MB.'); return; }
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
      if (!response.ok) throw new Error('Image upload failed.');
      const fileId = payload.file?.fileId;
      const name = payload.file?.originalName;
      if (!fileId || !name) throw new Error('Image upload response was incomplete.');
      setAttachments((current) => [...current, { id: fileId, name }].slice(-5));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Image upload failed.'); }
    finally { setUploading(false); }
  };

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
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: authHeaders(true),
        body: JSON.stringify({ conversationId, content, model }),
      });
      await readSse(response, (raw) => {
        const event = eventAsChat(raw);
        if (event.conversationId) setConversationId(event.conversationId);
        if (event.type === 'token' && event.token) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.token } : item));
        if (event.type === 'done' && event.text) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: event.text ?? item.content } : item));
        if (event.type === 'error') { setMessages((current) => current.filter((item) => item.id !== assistantId)); setError(event.message ?? 'Chat is temporarily unavailable.'); }
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Chat stopped unexpectedly.');
    } finally { abortRef.current = null; setBusy(false); }
  };

  const runWork = async () => {
    const goal = workInput.trim();
    if (!goal || busy) return;
    setBusy(true); setError(''); setArtifact(null);
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
      });
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

  const title = mode === 'chat' ? 'New chat' : 'Task';

  return <AppShell title={title}>
    <div className={styles.page}>
      {mode === 'chat' ? <>
        <section className={styles.hero} aria-labelledby="chat-title">
          <span>AKBARAL! Chat</span>
          <h2 id="chat-title">How can I help?</h2>
          <p>Ask for writing, analysis, planning, code help, or a next step. Chat never deducts Work task credits.</p>
        </section>
        {/* Chat column: message thread renders BEFORE the composer in the DOM; the composer dock is the last child. */}
        <section className={styles.chatWrap}>
          <div className={styles.messages} aria-live="polite" aria-label="Conversation">
            {messages.length === 0 ? <div className={styles.empty}><h3>No conversation yet.</h3><p>Your real chat will appear here after you send a message.</p></div> : null}
            {messages.map((message) => <article key={message.id} className={styles.message} data-role={message.role}><header><b>{message.role === 'user' ? 'You' : 'AKBARAL!'}</b>{message.content ? <CopyButton value={message.content} /> : null}</header><Markdown content={message.content || '…'} /></article>)}
          </div>
          <div className={styles.composerDock}>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.composerMeta}>
              <label className={styles.modelLabel}>Model
                <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Chat model">
                  {models.length ? models.map((item) => <option key={item.key} value={item.key}>{item.name}</option>) : <option value={DEFAULT_MODEL}>Gemini Flash</option>}
                </select>
              </label>
              <button className={styles.smallButton} type="button" onClick={() => { stop(); setConversationId(null); setMessages([]); setChatInput(''); setError(''); }}>New chat</button>
            </div>
            <Composer value={chatInput} setValue={setChatInput} onSubmit={() => void sendChat()} busy={busy} onStop={stop} placeholder="Message AKBARAL!" buttonLabel="Send" onAttach={attachImage} attachments={attachments} />
            <p className={styles.hint}>Chat never deducts Work task credits.</p>
          </div>
        </section>
      </> : <>
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
          </div>
          <aside className={styles.previewRail} aria-label="Work preview rail">
            <div className={styles.previewHead}><h3>Preview</h3><button className={styles.downloadButton} type="button" onClick={() => void downloadArtifact()} disabled={!artifact}>Export ZIP</button></div>
            <div className={styles.previewBox}>
              {artifact ? (artifactIsHtml ? <iframe title="Sandboxed Work artifact" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${artifactText}`} /> : <pre>{artifactText}</pre>) : <div className={styles.previewEmpty}><div><b>No artifact yet.</b><span>Your completed Work output appears here. The frame is sandboxed for safety.</span></div></div>}
            </div>
          </aside>
        </section>
      </>}
    </div>
  </AppShell>;
}
