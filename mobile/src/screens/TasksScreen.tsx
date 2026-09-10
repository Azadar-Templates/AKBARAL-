import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api/client';
import { palette, radius, spacing } from '../theme';
import { Badge, Card, EmptyState, LoadingState, PageHeader, Pill, ScreenShell } from '../components/ui';
import { subscribeExecutionEvents, type ExecutionLogEvent, type LiveState, type LiveSubscription } from '../services/sse';
import { AutomationsScreen } from './AutomationsScreen';

/**
 * M12 mobile task center — the same contract as the web task center:
 * GET /api/tasks (list), GET /api/tasks/:id (task + events + executions + logs)
 * and live logs over the SSE channel /api/executions/:id/events?token=.
 * Deep links (akbaral://tasks/:id) and dashboard taps open the detail view.
 */

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
const MAX_LOG_LINES = 500;

interface TaskRow {
  id: string;
  goal?: string | null;
  status: string;
  created_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  output_data?: string | null;
}

interface ExecutionRow {
  id: string;
  status: string;
  agent_slug?: string | null;
  created_at?: string | null;
}

interface EventRow {
  id: string;
  message: string;
  level?: string | null;
  created_at?: string | null;
}

interface LogRow {
  id: string;
  level?: string | null;
  message: string;
  type?: string | null;
  created_at?: string | null;
}

function isTerminal(status: unknown): boolean {
  return TERMINAL_STATUSES.includes(String(status));
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function describeOutput(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const text = (parsed.text ?? parsed.content ?? parsed.summary ?? parsed.markdown) as string | undefined;
    const body = typeof text === 'string' ? text : JSON.stringify(parsed, null, 1);
    return body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body;
  } catch {
    return raw.length > 4000 ? `${raw.slice(0, 4000)}\n…` : raw;
  }
}

export function TasksScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const deepLinkId = (route.params as { taskId?: string } | undefined)?.taskId;
  const automationId = (route.params as { automationId?: string } | undefined)?.automationId;
  const viewAutomations = (route.params as { viewAutomations?: boolean } | undefined)?.viewAutomations;

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api.get('/api/tasks');
      setTasks((body as { tasks?: TaskRow[] }).tasks ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadTasks();
    }, [loadTasks]),
  );

  // Deep link / dashboard tap → open the task detail.
  useEffect(() => {
    if (deepLinkId) {
      setOpenId(deepLinkId);
      // Clear the param so back-navigation from detail returns to the list.
      const setParams = (navigation as unknown as { setParams: (params: Record<string, unknown>) => void }).setParams;
      setParams({ taskId: undefined });
    }
  }, [deepLinkId, navigation]);

  // Automations live behind the Tasks tab (deep links + toolbar entry).
  if (automationId || viewAutomations) {
    return <AutomationsScreen initialAutomationId={automationId} />;
  }

  const closeDetail = useCallback(() => {
    setOpenId(null);
    void loadTasks();
  }, [loadTasks]);

  const openTask = useCallback((id: string) => {
    setOpenId(id);
  }, []);

  if (openId) {
    return <TaskDetailScreen taskId={openId} onClose={closeDetail} />;
  }

  return (
    <ScreenShell scroll>
      <PageHeader kicker="Task center" title="Tasks" />
      <View style={styles.toolbar}>
        <Pill label={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`} tone="cyan" />
        <View style={styles.toolbarRight}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              const setParams = (navigation as unknown as { setParams: (params: Record<string, unknown>) => void }).setParams;
              setParams({ viewAutomations: true });
            }}>
            <Text style={styles.automationsLink}>⚡ Automations</Text>
          </Pressable>
          <Pressable onPress={() => void loadTasks()} hitSlop={8}>
            <Text style={styles.refresh}>{loading ? 'Refreshing…' : '↻ Refresh'}</Text>
          </Pressable>
        </View>
      </View>
      {loading && tasks.length === 0 ? (
        <LoadingState text="Loading tasks…" />
      ) : tasks.length === 0 ? (
        <EmptyState text="No tasks yet. Open MASTER and describe your goal." />
      ) : (
        tasks.map((task) => (
          <Pressable key={task.id} onPress={() => openTask(task.id)}>
            <Card style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle} numberOfLines={2}>
                    {task.goal || task.id}
                  </Text>
                  <Text style={styles.muted}>{formatTime(task.created_at)}</Text>
                </View>
                <Badge status={task.status} />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ScreenShell>
  );
}

function TaskDetailScreen({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [task, setTask] = useState<TaskRow | null>(null);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [liveState, setLiveState] = useState<LiveState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const subscription = useRef<LiveSubscription | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      const body = (await api.get(`/api/tasks/${encodeURIComponent(taskId)}`)) as {
        task?: TaskRow;
        executions?: ExecutionRow[];
        events?: EventRow[];
        logs?: LogRow[];
      };
      if (!body.task) throw new Error('task not found');
      setTask(body.task);
      setExecutions(body.executions ?? []);
      setEvents(body.events ?? []);
      setLogs((body.logs ?? []).slice(-MAX_LOG_LINES));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the task.');
    }
  }, [taskId]);

  // Initial load.
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // While the task is non-terminal: subscribe to the newest execution's live
  // log stream (same SSE channel as the web task center) and poll the task
  // until it reaches a terminal state.
  useEffect(() => {
    if (!task || isTerminal(task.status) || executions.length === 0) return;
    const target = [...executions]
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .find((execution) => !isTerminal(execution.status)) ?? executions[executions.length - 1];
    if (!target) return;

    const seen = new Set<string>();
    subscription.current = subscribeExecutionEvents(
      target.id,
      (event: ExecutionLogEvent) => {
        if (event.type !== 'log' || seen.has(event.id)) return;
        seen.add(event.id);
        setLogs((prev) => {
          if (prev.some((row) => row.id === event.id)) return prev;
          const next = [...prev, { id: event.id, level: event.level, message: event.message, type: event.logType, created_at: event.createdAt }];
          return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
        });
      },
      setLiveState,
    );

    const poll = setInterval(() => void loadDetail(), 5000);
    return () => {
      subscription.current?.close();
      subscription.current = null;
      clearInterval(poll);
    };
  }, [task?.id, task?.status, executions.length, loadDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !task) {
    return (
      <ScreenShell scroll>
        <PageHeader kicker="Task center" title="Task" />
        <EmptyState text={error} />
        <Pressable onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>← All tasks</Text>
        </Pressable>
      </ScreenShell>
    );
  }

  if (!task) {
    return (
      <ScreenShell scroll>
        <PageHeader kicker="Task center" title="Task" />
        <LoadingState text="Loading task…" />
      </ScreenShell>
    );
  }

  const running = !isTerminal(task.status);
  const output = describeOutput(task.output_data);

  return (
    <ScreenShell scroll>
      <Pressable onPress={onClose} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← All tasks</Text>
      </Pressable>
      <PageHeader kicker={running ? 'Running' : 'Result'} title={task.goal || task.id} />
      <View style={styles.metaRow}>
        <Badge status={task.status} />
        {running ? <Pill label={liveState === 'live' ? '● live' : liveState} tone="cyan" /> : null}
      </View>

      <Card accent="none" style={styles.section}>
        <Text style={styles.label}>Goal</Text>
        <Text style={styles.body}>{task.goal || '—'}</Text>
        <Text style={styles.label}>Created</Text>
        <Text style={styles.muted}>{formatTime(task.created_at)}</Text>
        {task.completed_at ? (
          <>
            <Text style={styles.label}>Finished</Text>
            <Text style={styles.muted}>{formatTime(task.completed_at)}</Text>
          </>
        ) : null}
        {executions.map((execution) => (
          <View key={execution.id} style={styles.executionRow}>
            <Text style={styles.muted} numberOfLines={1}>
              {execution.agent_slug || 'agent'} · {execution.id}
            </Text>
            <Badge status={execution.status} />
          </View>
        ))}
      </Card>

      {task.error_message ? (
        <Card accent="none" style={styles.errorCard}>
          <Text style={styles.errorText}>⚠ {task.error_message}</Text>
        </Card>
      ) : null}

      {events.length > 0 ? (
        <Text style={styles.heading}>Events</Text>
      ) : null}
      {events.map((event) => (
        <Card key={event.id} accent="none" style={styles.eventCard}>
          <Text style={styles.muted}>{formatTime(event.created_at)}</Text>
          <Text style={styles.body}>{event.message}</Text>
        </Card>
      ))}

      {output ? (
        <>
          <Text style={styles.heading}>Output</Text>
          <Card accent="none" style={styles.outputCard}>
            <Text style={styles.outputText}>{output}</Text>
          </Card>
        </>
      ) : null}

      <Text style={styles.heading}>{running ? 'Live logs' : 'Logs'}</Text>
      <View style={styles.console}>
        {logs.length === 0 ? (
          <Text style={styles.consoleLine}>No log lines yet.</Text>
        ) : (
          logs.map((row) => (
            <Text key={row.id} style={[styles.consoleLine, row.level === 'error' && styles.consoleError, row.level === 'warn' && styles.consoleWarn]}>
              {row.message}
            </Text>
          ))
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  refresh: { color: palette.cyan, fontWeight: '800', fontSize: 13 },
  toolbarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  automationsLink: { color: palette.violet, fontWeight: '800', fontSize: 13 },
  item: { padding: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemBody: { flex: 1, paddingRight: spacing.sm },
  itemTitle: { color: palette.text, fontWeight: '700', fontSize: 15 },
  muted: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  back: { marginBottom: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: palette.gold, fontWeight: '800', fontSize: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  section: { marginBottom: spacing.md },
  label: { color: palette.textFaint, fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase', marginTop: spacing.sm },
  body: { color: palette.text, fontSize: 14, marginTop: 2 },
  executionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  errorCard: { borderColor: palette.red, marginBottom: spacing.md },
  errorText: { color: palette.red, fontSize: 13 },
  heading: { color: palette.textSoft, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.sm },
  eventCard: { padding: spacing.sm, marginBottom: spacing.sm },
  outputCard: { padding: spacing.md, marginBottom: spacing.md },
  outputText: { color: palette.text, fontSize: 13, lineHeight: 19 },
  console: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xl },
  consoleLine: { color: palette.textDim, fontSize: 11, lineHeight: 17 },
  consoleError: { color: palette.red },
  consoleWarn: { color: palette.gold },
});
