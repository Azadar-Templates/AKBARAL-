import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { glass, palette, radius, shadow, spacing, statusColor, type as typeScale } from '../theme';
import { Button, EmptyState, Field, ScreenShell, Skeleton, StatusDot, useReducedMotion } from '../components/ui';

/**
 * AKBARAL! — MASTER workspace (mobile), the Arena-style spatial model.
 *
 * The SAME interaction model as the web workspace
 * (src/app/page.tsx + public/styles.css + public/app.js):
 *
 *   LEFT / first pane  · the full project / book / file area with the live
 *                        preview canvas; the download-export control sits
 *                        ABOVE the preview.
 *   RIGHT / second pane· the AKBARAL! brand header, then the main MASTER chat
 *                        (plan, live activity, results, composer, history).
 *
 * Wide viewports (tablets, foldables, landscape) show both panes side by
 * side; phones switch panes with the segmented control instead of being a
 * squeezed desktop. One design system (theme.ts + components/ui.tsx), one
 * spatial hierarchy, every platform.
 *
 * Everything below talks to the real API: projects, project files, versioned
 * website artifacts, and the MASTER orchestration endpoints. There are no
 * simulated agents, no fake progress and no decorative controls.
 */

type Phase = 'idle' | 'thinking' | 'executing' | 'success' | 'error';
type Pane = 'workspace' | 'chat';

interface ProjectRow {
  id: string;
  name: string;
  slug?: string | null;
}

interface FileRow {
  id: string;
  original_name?: string | null;
  mime_type?: string | null;
}

interface ArtifactRow {
  version: number;
  title?: string | null;
  content?: string | null;
}

interface StepRow {
  step_order?: number | null;
  status?: string | null;
  error_message?: string | null;
}

interface Turn {
  id: string;
  role: 'you' | 'master' | 'run' | 'error';
  title: string;
  body: string;
  meta?: string[];
}

const TERMINAL = ['completed', 'failed', 'cancelled'];
const PANE_BREAKPOINT = 900;

const phaseCopy: Record<Phase, { label: string; tone: string }> = {
  idle: { label: 'standby', tone: palette.textDim },
  thinking: { label: 'planning', tone: palette.accent2 },
  executing: { label: 'executing', tone: palette.telemetry },
  success: { label: 'completed', tone: palette.green },
  error: { label: 'failed', tone: palette.red },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let turnSeq = 0;
const nextTurnId = () => `turn-${Date.now()}-${(turnSeq += 1)}`;

/** The real MASTER orchestration pipeline, visualized (no invented stages). */
const FLOW_STAGES = ['Goal', 'Plan', 'Agents', 'Tools', 'Verify', 'Result'];

function flowActive(phase: Phase): number[] {
  switch (phase) {
    case 'thinking': return [1];
    case 'executing': return [2, 3, 4];
    case 'success': return [0, 1, 2, 3, 4, 5];
    default: return [];
  }
}

function OrchestrationFlow({ phase }: { phase: Phase }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  const live = phase === 'thinking' || phase === 'executing';

  useEffect(() => {
    if (!live || reduced) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [live, reduced, pulse]);

  const active = flowActive(phase);
  return (
    <View style={styles.flow} accessibilityLabel="Orchestration pipeline stages">
      {FLOW_STAGES.map((label, i) => {
        const isActive = active.includes(i);
        const color = phase === 'error' && isActive ? palette.red
          : phase === 'success' ? palette.green
          : isActive ? palette.telemetry : palette.textFaint;
        return (
          <React.Fragment key={label}>
            {i > 0 ? <View style={styles.flowConnector} /> : null}
            <Animated.View
              style={[
                styles.flowChip,
                isActive && phase !== 'error' && styles.flowChipActive,
                phase === 'success' && styles.flowChipDone,
                { opacity: isActive && live && !reduced ? pulse : 1 },
              ]}
            >
              {isActive && live ? <StatusDot status={phase === 'executing' ? 'running' : 'pending'} size={6} /> : null}
              <Text style={[styles.flowText, { color }]}>{label}</Text>
            </Animated.View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** One MASTER chat turn — the mobile twin of .chat-msg on the web rail. */
function ChatTurn({ turn }: { turn: Turn }) {
  const isYou = turn.role === 'you';
  const tone = turn.role === 'error' ? palette.red
    : turn.role === 'master' ? palette.green
    : turn.role === 'run' ? palette.telemetry
    : palette.accent;
  return (
    <View style={[styles.turn, isYou ? styles.turnYou : styles.turnMaster, turn.role === 'error' ? styles.turnError : null]}>
      <View style={styles.turnHead}>
        <Text style={[styles.turnWho, { color: isYou ? palette.accent2 : tone }]}>{turn.title.toUpperCase()}</Text>
        {(turn.meta || []).map((m) => (
          <View key={m} style={styles.turnMeta}><Text style={styles.turnMetaText}>{m}</Text></View>
        ))}
      </View>
      <Text style={styles.turnBody}>{turn.body}</Text>
    </View>
  );
}

export function MasterScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= PANE_BREAKPOINT;
  const navigation = useNavigation<{ navigate: (screen: string, params?: unknown) => void }>();
  // The project vault (Workspace tab) opens a project HERE, in the workspace
  // pane — one workspace, reachable from the vault, exactly like the web
  // (#/workspace → Open workspace ↗ on the MASTER screen).
  const route = useRoute();
  // The navigator header is disabled for this tab: the workspace brand header
  // is the top of the screen, so it owns the device safe-area inset.
  const insets = useSafeAreaInsets();

  const [pane, setPane] = useState<Pane>('chat');
  const [goal, setGoal] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null);
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string; mime: string } | null>(null);
  const [fileText, setFileText] = useState('');
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; goal?: string | null; status: string }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [canvasState, setCanvasState] = useState('idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const scrollRef = useRef<ScrollView | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const addTurn = useCallback((turn: Omit<Turn, 'id'>) => {
    setTurns((current) => [...current, { ...turn, id: nextTurnId() }]);
  }, []);

  /** Load the real project surface: files + the current website artifact. */
  const loadWorkspace = useCallback(async (id: string) => {
    if (!id) { setFiles([]); setArtifact(null); setCanvasState('idle'); return; }
    const [detail, artifactBody] = await Promise.all([
      api.get(`/api/projects/${encodeURIComponent(id)}`).catch(() => null),
      api.get(`/api/projects/${encodeURIComponent(id)}/artifacts/website`).catch(() => null),
    ]);
    if (!alive.current) return;
    setFiles(Array.isArray(detail?.files) ? detail.files : []);
    const next = artifactBody?.artifact ?? null;
    setArtifact(next);
    setPreviewFile(null);
    setFileText('');
    setCanvasState(next ? `website v${next.version}` : 'idle');
  }, []);

  /** Real project + task history from the API. */
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [projectBody, taskBody] = await Promise.all([
        api.get('/api/projects').catch(() => ({ projects: [] })),
        api.get('/api/tasks').catch(() => ({ tasks: [] })),
      ]);
      if (!alive.current) return;
      const list: ProjectRow[] = projectBody.projects || [];
      setProjects(list);
      setHistory((taskBody.tasks || []).slice(0, 8));
      const first = list[0]?.id || '';
      setProjectId(first);
      await loadWorkspace(first);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Workspace unavailable');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [loadWorkspace]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Deep link / vault navigation: select the requested project in the pane.
  // Applied ONCE per requested id (a ref, not a state comparison) so that
  // switching project chips afterwards is never snapped back to the link.
  const requestedProject = (route.params as { projectId?: string } | undefined)?.projectId;
  const handledProjectLink = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedProject || handledProjectLink.current === requestedProject) return;
    handledProjectLink.current = requestedProject;
    setProjectId(requestedProject);
    setPane('workspace');
    void loadWorkspace(requestedProject);
  }, [requestedProject, loadWorkspace]);

  /** Render a real file in the canvas (images render directly, text renders
   *  as a document, everything else is shared/downloaded honestly). */
  const openFile = useCallback(async (file: FileRow) => {
    const mime = String(file.mime_type || '');
    const name = String(file.original_name || file.id);
    if (mime.startsWith('image/')) {
      setPreviewFile({ id: file.id, name, mime });
      setFileText('');
      setCanvasState('image');
      if (!wide) setPane('workspace');
      return;
    }
    try {
      const text = await fetchText(`/api/files/${encodeURIComponent(file.id)}`);
      setPreviewFile({ id: file.id, name, mime: mime || 'text/plain' });
      setFileText(text);
      setCanvasState(mime.startsWith('text/html') ? 'html file' : 'document');
      if (!wide) setPane('workspace');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }, [wide]);

  async function fetchText(path: string): Promise<string> {
    const response = await fetch(api.url(path), {
      headers: api.getAccessToken() ? { authorization: `Bearer ${api.getAccessToken()}` } : {},
    });
    if (!response.ok) throw new Error(`preview failed (${response.status})`);
    return response.text();
  }

  /** Real export: the platform share sheet (save to Files, send, or open in
   *  another app). Used for the website deliverable and previewed documents. */
  const exportCurrent = useCallback(async () => {
    const name = previewFile ? previewFile.name : artifact ? `${artifact.title || 'akbaral-website'}-v${artifact.version}.html` : 'akbaral-deliverable';
    const content = previewFile ? fileText : String(artifact?.content || '');
    if (!content) {
      setError('There is nothing to export from this project yet.');
      return;
    }
    try {
      await Share.share({ title: name, message: content });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }, [artifact, fileText, previewFile]);

  /** The real MASTER flow: plan → run → live step status → final result. */
  const submit = useCallback(async () => {
    const text = goal.trim();
    if (!text || busy) return;
    setBusy(true);
    setPhase('thinking');
    setError('');
    setSteps([]);
    addTurn({ role: 'you', title: 'You', body: text, meta: projectId ? ['project'] : [] });
    if (!wide) setPane('chat');
    try {
      const plan = await api.post('/api/workflows/master', { goal: text, project_id: projectId || null });
      const workflowId = plan?.workflow?.id;
      const planned = (plan?.plan?.steps || []).map((step: Record<string, unknown>, index: number) => ({
        step_order: index + 1,
        status: 'pending',
        label: String(step.goal || step.description || step.name || step.agentSlug || `step ${index + 1}`),
      }));
      if (planned.length) {
        addTurn({
          role: 'run',
          title: 'MASTER · plan',
          body: planned.map((step: { step_order: number; label: string }) => `${step.step_order}. ${step.label}`).join('\n'),
          meta: [`${planned.length} step${planned.length === 1 ? '' : 's'}`],
        });
      }
      if (!workflowId) throw new Error('Planning succeeded but no workflow id was returned');
      setPhase('executing');
      await api.post(`/api/workflows/${encodeURIComponent(workflowId)}/run`, {});
      await pollWorkflow(workflowId);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The request could not be completed';
      setPhase('error');
      setError(message);
      addTurn({ role: 'error', title: 'MASTER · failed', body: message });
    } finally {
      if (alive.current) setBusy(false);
      setGoal('');
    }
  }, [addTurn, busy, goal, projectId, wide]);

  async function pollWorkflow(workflowId: string): Promise<void> {
    for (let attempt = 0; attempt < 240 && alive.current; attempt += 1) {
      const body = await api.get(`/api/workflows/${encodeURIComponent(workflowId)}`).catch(() => null);
      const workflow = body?.workflow;
      if (!workflow) { await sleep(1500); continue; }
      const stepRows: StepRow[] = body?.steps || [];
      if (alive.current) setSteps(stepRows);
      if (TERMINAL.includes(String(workflow.status))) {
        if (workflow.status === 'completed') {
          let parsed: Record<string, unknown> | null = null;
          try { parsed = workflow.result_json ? JSON.parse(String(workflow.result_json)) : null; } catch { parsed = null; }
          const final = (parsed?.finalResult ?? parsed) as Record<string, unknown> | null;
          addTurn({ role: 'master', title: 'MASTER · result', body: summarizeResult(final) });
          if (projectId) await loadWorkspace(projectId);
          setPhase('success');
          setCanvasState((current) => (current === 'idle' ? 'result' : current));
          if (!wide && final) setPane('workspace');
        } else {
          const message = String(workflow.error_message || `workflow ${workflow.status}`);
          addTurn({ role: 'error', title: 'MASTER · failed', body: message });
          setPhase('error');
        }
        return;
      }
      await sleep(1500);
    }
  }

  /** Honest summary of the real final result payload (never invented). */
  function summarizeResult(final: Record<string, unknown> | null): string {
    if (!final) return 'The workflow completed without a result payload.';
    const summary = (final.executiveSummary ?? final.content ?? final.summary) as string | undefined;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    const sections = Array.isArray(final.sections) ? (final.sections as Array<Record<string, unknown>>) : [];
    const completed = sections.filter((s) => String(s.status) === 'completed');
    if (completed.length) {
      return completed
        .map((s) => String(s.content || '').slice(0, 400))
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 1200);
    }
    return 'The workflow completed successfully, but no result content was attached to it.';
  }

  const preview = useMemo(() => {
    if (previewFile) {
      if (previewFile.mime.startsWith('image/')) {
        const token = api.getAccessToken();
        return (
          <Image
            style={styles.canvasImage}
            resizeMode="contain"
            source={{ uri: api.url(`/api/files/${encodeURIComponent(previewFile.id)}`), headers: token ? { authorization: `Bearer ${token}` } : {} }}
          />
        );
      }
      return (
        <ScrollView style={styles.canvasScroll} contentContainerStyle={styles.canvasDoc}>
          <Text style={styles.canvasDocText}>{fileText || 'This file has no text content to render.'}</Text>
        </ScrollView>
      );
    }
    if (artifact?.content) {
      return (
        <WebView
          originWhitelist={['about:blank', 'data:*']}
          source={{ html: String(artifact.content) }}
          style={styles.canvasWeb}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(request) => {
            // Keep the deliverable inside the canvas: sub-resources load, but
            // a link may never navigate the canvas to an external app/scheme.
            if (/^(about:|data:)/i.test(request.url)) return true;
            if (/^https?:/i.test(request.url)) return true;
            Linking.openURL(request.url).catch(() => undefined);
            return false;
          }}
        />
      );
    }
    return (
      <EmptyState text="Run a goal with this project selected — the website, document, image or dataset deliverable renders here, with the export control above it." />
    );
  }, [artifact, fileText, previewFile]);

  const status = phaseCopy[phase];

  const workspacePane = (
    <View style={styles.pane} key="workspace">
      {/* project / book selector — the file area header */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectRow}>
        {projects.length === 0 ? <Text style={styles.muted}>No projects yet — create one in the Workspace tab.</Text> : null}
        {projects.map((project) => {
          const active = project.id === projectId;
          return (
            <Pressable
              key={project.id}
              onPress={() => { setProjectId(project.id); void loadWorkspace(project.id); }}
              style={[styles.projectChip, active && styles.projectChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.projectChipText, active && styles.projectChipTextActive]} numberOfLines={1}>{project.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* EXPORT CONTROL — ABOVE THE PREVIEW (same as the web workspace) */}
      <View style={styles.exportBar}>
        <View style={styles.exportId}>
          <Text style={styles.exportLabel}>LIVE PREVIEW</Text>
          <View style={[styles.stateChip, { borderColor: `${statusColor(canvasState)}66` }]}>
            <StatusDot status={canvasState} size={6} />
            <Text style={[styles.stateChipText, { color: statusColor(canvasState) }]} numberOfLines={1}>{canvasState}</Text>
          </View>
        </View>
        <View style={styles.exportActions}>
          <Button label="Export" tone="secondary" onPress={() => void exportCurrent()} disabled={!artifact && !previewFile} />
          {artifact && previewFile ? (
            // The canvas is showing a project file: offer the way back to the
            // website deliverable (labelled for what it does — no fake "open").
            <Button
              label="Website"
              tone="ghost"
              onPress={() => {
                setPreviewFile(null);
                setFileText('');
                setCanvasState(`website v${artifact.version}`);
              }}
            />
          ) : null}
        </View>
      </View>

      {/* THE LIVE PREVIEW CANVAS */}
      <View style={styles.canvas}>{preview}</View>

      {/* THE PROJECT / BOOK / FILE AREA */}
      <View style={styles.filesPanel}>
        <View style={styles.filesHead}>
          <Text style={styles.filesTitle}>FILES</Text>
          <Text style={styles.filesCount}>{files.length ? `${files.length} in project` : 'empty'}</Text>
        </View>
        {loading ? <Skeleton count={2} height={54} /> : null}
        {!loading && files.length === 0 ? (
          <Text style={styles.muted}>No files in this project yet. Files uploaded on the web workspace appear here.</Text>
        ) : null}
        {files.map((file) => (
          <View key={file.id} style={styles.fileRow}>
            <View style={styles.fileBody}>
              <Text style={styles.fileName} numberOfLines={1}>{String(file.original_name || file.id)}</Text>
              <Text style={styles.fileMime} numberOfLines={1}>{String(file.mime_type || 'file')}</Text>
            </View>
            <View style={styles.fileActions}>
              <Pressable style={styles.fileBtn} onPress={() => void openFile(file)} accessibilityRole="button">
                <Text style={styles.fileBtnText}>Canvas</Text>
              </Pressable>
              <Pressable
                style={styles.fileBtn}
                accessibilityRole="button"
                onPress={() => {
                  void (async () => {
                    try {
                      const text = await fetchText(`/api/files/${encodeURIComponent(file.id)}`);
                      await Share.share({ title: String(file.original_name || file.id), message: text });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Download failed');
                    }
                  })();
                }}
              >
                <Text style={styles.fileBtnText}>Download</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const chatPane = (
    <KeyboardAvoidingView
      key="chat"
      style={styles.pane}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={96}
    >
      <View style={styles.coreRow}>
        <StatusDot status={phase === 'executing' ? 'running' : phase === 'error' ? 'failed' : phase === 'success' ? 'completed' : 'idle'} size={9} />
        <Text style={[styles.coreLabel, { color: status.tone }]}>{status.label.toUpperCase()}</Text>
        <Text style={styles.coreHint} numberOfLines={1}>
          {phase === 'thinking' ? 'decomposing the goal and selecting specialists'
            : phase === 'executing' ? 'specialists are executing the plan'
            : phase === 'success' ? 'verified result — deliverable is in the canvas'
            : phase === 'error' ? 'the run failed honestly — credits refunded'
            : 'describe a goal to plan and run'}
        </Text>
      </View>

      <OrchestrationFlow phase={phase} />

      {historyOpen ? (
        <View style={styles.historyBox}>
          <Text style={styles.filesTitle}>RECENT TASKS</Text>
          {history.length === 0 ? <Text style={styles.muted}>No tasks yet.</Text> : null}
          {history.map((task) => (
            <Pressable
              key={task.id}
              style={styles.historyRow}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Tasks', { taskId: task.id })}
            >
              <Text style={styles.historyText} numberOfLines={1}>{String(task.goal || task.id)}</Text>
              <Text style={[styles.historyStatus, { color: statusColor(task.status) }]}>{task.status}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {turns.length === 0 ? (
          <EmptyState text="The MASTER conversation appears here: your goal, the plan, live specialist activity and the verified result." />
        ) : null}
        {turns.map((turn) => <ChatTurn key={turn.id} turn={turn} />)}

        {steps.length > 0 ? (
          <View style={styles.stepsBox}>
            <Text style={styles.filesTitle}>EXECUTION</Text>
            {steps
              .slice()
              .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
              .map((step) => (
                <View key={`step-${step.step_order}`} style={styles.stepRow}>
                  <StatusDot status={String(step.status || 'pending')} size={7} />
                  <Text style={styles.stepText} numberOfLines={2}>
                    Step {step.step_order}: {String(step.status || 'pending')}{step.error_message ? ` — ${step.error_message}` : ''}
                  </Text>
                </View>
              ))}
          </View>
        ) : null}
      </ScrollView>

      {error ? (
        <Pressable onPress={() => setError('')} style={styles.errorBar} accessibilityRole="button">
          <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
        </Pressable>
      ) : null}

      <View style={styles.composer}>
        <Field
          multiline
          value={goal}
          onChangeText={setGoal}
          placeholder="e.g. Build me a website · Research this market · Plan my business"
          style={styles.input}
          label="Goal"
        />
        <View style={styles.composerRow}>
          <Pressable
            onPress={() => setHistoryOpen((open) => !open)}
            style={styles.historyToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
          >
            <Text style={styles.historyToggleText}>{historyOpen ? 'Hide history' : 'History'}</Text>
          </Pressable>
          <View style={styles.composerSpacer} />
          <Button label="Plan & run" onPress={() => void submit()} loading={busy} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <ScreenShell bare style={styles.screen}>
      {/* BRAND HEADER — AKBARAL! logo at the top, then the chat. */}
      <View style={[styles.header, { paddingTop: spacing.md + insets.top }]}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>A!</Text></View>
        <View style={styles.headerText}>
          <View style={styles.wordmarkRow}>
            <Text style={styles.wordmark}>AKBARAL!</Text>
            <Text style={styles.headerSub}>MASTER · workspace</Text>
          </View>
          <Text style={styles.headerNote} numberOfLines={1}>
            {projects.find((p) => p.id === projectId)?.name || 'No project selected'}
          </Text>
        </View>
        <View style={[styles.phasePill, { borderColor: `${status.tone}66` }]}>
          <Text style={[styles.phaseText, { color: status.tone }]}>{status.label}</Text>
        </View>
      </View>

      {/* PANE SWITCH — phones switch panes instead of squeezing the grid */}
      {!wide ? (
        <View style={styles.paneSwitch} accessibilityRole="tablist">
          {(['workspace', 'chat'] as Pane[]).map((key) => {
            const active = pane === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPane(key)}
                style={[styles.paneTab, active && styles.paneTabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.paneTabText, active && styles.paneTabTextActive]}>
                  {key === 'workspace' ? 'Workspace' : 'MASTER chat'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {wide ? (
        <View style={styles.split}>
          <View style={styles.splitWorkspace}>{workspacePane}</View>
          <View style={styles.splitChat}>{chatPane}</View>
        </View>
      ) : (
        <View style={styles.single}>{pane === 'workspace' ? workspacePane : chatPane}</View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0 },
  // (the brand header carries the top inset; see the component)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: glass[2].border,
    backgroundColor: glass[2].fill,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
    ...shadow.glow,
  },
  brandMarkText: { color: palette.onAccent, fontWeight: '900', fontSize: 13, letterSpacing: -0.4 },
  headerText: { flex: 1, minWidth: 0 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  wordmark: { color: palette.text, fontSize: 15, fontWeight: '900', letterSpacing: 1.6 },
  headerSub: { color: palette.textFaint, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  headerNote: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  phasePill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  phaseText: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  paneSwitch: {
    flexDirection: 'row',
    gap: 2,
    margin: spacing.md,
    padding: 3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass[1].border,
    backgroundColor: 'rgba(5,5,8,0.5)',
  },
  paneTab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm },
  paneTabActive: { backgroundColor: palette.accentSoft, borderWidth: 1, borderColor: palette.lineAccent },
  paneTabText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  paneTabTextActive: { color: palette.text },
  single: { flex: 1, minHeight: 0 },
  split: { flex: 1, flexDirection: 'row', minHeight: 0, gap: spacing.md, padding: spacing.md },
  splitWorkspace: { flex: 1.5, minWidth: 0 },
  splitChat: { flex: 1, minWidth: 340, maxWidth: 460 },
  pane: { flex: 1, minHeight: 0, paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  projectRow: { gap: spacing.sm, alignItems: 'center', paddingVertical: 2 },
  projectChip: {
    borderWidth: 1,
    borderColor: glass[1].border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.surface,
    maxWidth: 200,
  },
  projectChipActive: { borderColor: palette.lineAccent, backgroundColor: palette.accentSoft },
  projectChipText: { color: palette.textDim, fontSize: 12.5, fontWeight: '600' },
  projectChipTextActive: { color: palette.text },
  exportBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass[2].border,
    backgroundColor: glass[2].fill,
  },
  exportId: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  exportLabel: { color: palette.text2, fontSize: 9.5, fontWeight: '800', letterSpacing: 2 },
  stateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3,
  },
  stateChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  exportActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  canvas: {
    flex: 1,
    minHeight: 240,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass[1].border,
    backgroundColor: palette.bg2,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  canvasWeb: { flex: 1, backgroundColor: '#ffffff', borderRadius: radius.md },
  canvasImage: { flex: 1, width: '100%' },
  canvasScroll: { flex: 1 },
  canvasDoc: { padding: spacing.sm },
  canvasDocText: { color: palette.text2, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  filesPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass[1].border,
    backgroundColor: glass[1].fill,
    padding: spacing.md,
    gap: spacing.sm,
  },
  filesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filesTitle: { color: palette.text2, fontSize: 9.5, fontWeight: '800', letterSpacing: 2 },
  filesCount: { color: palette.textFaint, fontSize: 11 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    backgroundColor: 'rgba(5,5,8,0.35)',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  fileBody: { flex: 1, minWidth: 0 },
  fileName: { color: palette.text, fontSize: 13, fontWeight: '600' },
  fileMime: { color: palette.textFaint, fontSize: 10.5, marginTop: 1 },
  fileActions: { flexDirection: 'row', gap: 6 },
  fileBtn: {
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: 'center',
  },
  fileBtnText: { color: palette.text2, fontSize: 11.5, fontWeight: '700' },
  coreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coreLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  coreHint: { flex: 1, color: palette.textFaint, fontSize: 11.5 },
  flow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  flowChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: palette.surface,
  },
  flowChipActive: { borderColor: palette.telemetry, backgroundColor: palette.telemetrySoft },
  flowChipDone: { borderColor: palette.green, backgroundColor: palette.greenSoft },
  flowText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  flowConnector: { width: 9, height: 1, backgroundColor: palette.lineStrong },
  historyBox: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: glass[1].border,
    borderRadius: radius.lg,
    backgroundColor: glass[1].fill,
    padding: spacing.md,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  historyText: { flex: 1, color: palette.text2, fontSize: 12.5 },
  historyStatus: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  chatScroll: { flex: 1, minHeight: 0 },
  chatContent: { gap: spacing.md, paddingBottom: spacing.sm },
  turn: {
    gap: 6,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(5,5,8,0.42)',
    padding: spacing.md,
  },
  turnYou: { borderColor: palette.lineAccent, backgroundColor: palette.accentSoft, marginLeft: spacing.xl },
  turnMaster: {},
  turnError: { borderColor: `${palette.red}66` },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  turnWho: { fontSize: 9.5, fontWeight: '900', letterSpacing: 2 },
  turnMeta: { borderWidth: 1, borderColor: palette.lineAccent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  turnMetaText: { color: palette.accent2, fontSize: 9.5, fontWeight: '800', textTransform: 'uppercase' },
  turnBody: { color: palette.text2, fontSize: 13.5, lineHeight: 20 },
  stepsBox: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.lineAccent,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(5,5,8,0.42)',
    padding: spacing.md,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepText: { flex: 1, color: palette.text2, fontSize: 12, fontFamily: 'monospace' },
  errorBar: {
    borderWidth: 1,
    borderColor: `${palette.red}66`,
    backgroundColor: palette.redSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { color: palette.red, fontSize: 12.5, lineHeight: 18 },
  composer: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: spacing.md,
  },
  input: { minHeight: 84, textAlignVertical: 'top' },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  historyToggle: {
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 42,
    justifyContent: 'center',
  },
  historyToggleText: { color: palette.text2, fontSize: 12.5, fontWeight: '700' },
  composerSpacer: { flex: 1 },
  muted: { color: palette.textDim, fontSize: 12.5, lineHeight: 18 },
});

export const MASTER_WORKSPACE_TUNING = {
  paneBreakpoint: PANE_BREAKPOINT,
  stages: FLOW_STAGES,
  typography: typeScale.body,
};
