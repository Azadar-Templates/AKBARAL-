import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api/client';
import { palette, radius, spacing } from '../theme';
import { Badge, Button, Card, EmptyState, Field, LoadingState, PageHeader, Pill, ScreenShell } from '../components/ui';

/**
 * Automation & scheduled workflows (mobile) — real management over the same
 * API as the web client: list/create/pause/resume/run-now/delete plus the run
 * history. Deep links (akbaral://automations/:id, e.g. from push
 * notifications) open the run history directly.
 */

interface Automation {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused';
  schedule: { kind: string; runAt?: string; expr?: string; tz?: string; seconds?: number };
  condition: unknown;
  steps: Array<{ agentSlug: string; goal: string; toolKey: string | null }>;
  timeoutMs: number;
  maxRetries: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  failCount: number;
}

interface AutomationRun {
  id: string;
  status: string;
  triggerReason: string;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

function describeSchedule(schedule: Automation['schedule']): string {
  if (schedule.kind === 'once') {
    return `Once · ${schedule.runAt ? new Date(schedule.runAt).toLocaleString() : '—'}`;
  }
  if (schedule.kind === 'cron') {
    return `Cron ${schedule.expr} · ${schedule.tz ?? 'UTC'}`;
  }
  const seconds = schedule.seconds ?? 0;
  if (seconds % 86400 === 0) return `Every ${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `Every ${seconds / 3600}h`;
  return `Every ${seconds}m`;
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function AutomationsScreen({ initialAutomationId }: { initialAutomationId?: string }) {
  const navigation = useNavigation();
  const route = useRoute();
  const deepLinkId = initialAutomationId ?? (route.params as { automationId?: string } | undefined)?.automationId;

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api.get('/api/automations');
      setAutomations((body as { automations?: Automation[] }).automations ?? []);
    } catch {
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (deepLinkId) {
      setOpenId(deepLinkId);
      navigation.setParams({ automationId: undefined } as never);
    }
  }, [deepLinkId, navigation]);

  const closeDetail = useCallback(() => {
    setOpenId(null);
    void load();
  }, [load]);

  if (openId) {
    return <AutomationDetail automationId={openId} onClose={closeDetail} />;
  }

  return (
    <ScreenShell scroll>
      <PageHeader kicker="Automations" title="Scheduled work" />
      <View style={styles.toolbar}>
        <Pill label={`${automations.length} automation${automations.length === 1 ? '' : 's'}`} tone="violet" />
        <Button label={creating ? 'Close' : '＋ New'} tone={creating ? 'ghost' : 'primary'} onPress={() => setCreating(!creating)} />
      </View>

      {creating ? <CreateAutomationForm onCreated={() => { setCreating(false); void load(); }} /> : null}

      {loading && automations.length === 0 ? (
        <LoadingState text="Loading automations…" />
      ) : automations.length === 0 && !creating ? (
        <EmptyState text="No automations yet. Create one to schedule recurring agent work." />
      ) : (
        automations.map((automation) => (
          <Pressable key={automation.id} onPress={() => setOpenId(automation.id)}>
            <Card style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {automation.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {describeSchedule(automation.schedule)} · {automation.steps.length} step{automation.steps.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.muted}>
                    {automation.status === 'active' ? `Next: ${formatTime(automation.nextRunAt)}` : 'Paused'} · {automation.runCount} run{automation.runCount === 1 ? '' : 's'}
                    {automation.failCount > 0 ? ` · ${automation.failCount} failed` : ''}
                  </Text>
                </View>
                <Badge status={automation.status === 'active' ? 'active' : 'disabled'} />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ScreenShell>
  );
}

function CreateAutomationForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [scheduleKind, setScheduleKind] = useState<'interval' | 'cron' | 'once'>('interval');
  const [minutes, setMinutes] = useState('60');
  const [cronExpr, setCronExpr] = useState('30 9 * * *');
  const [cronTz, setCronTz] = useState('Asia/Karachi');
  const [runAt, setRunAt] = useState('');
  const [agentSlug, setAgentSlug] = useState('research-researcher-002');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !goal.trim()) {
      setError('Name and step goal are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const schedule =
        scheduleKind === 'interval'
          ? { kind: 'interval', seconds: Math.max(60, Math.round(Number(minutes || '60') * 60)) }
          : scheduleKind === 'cron'
            ? { kind: 'cron', expr: cronExpr.trim(), tz: cronTz.trim() || 'UTC' }
            : { kind: 'once', run_at: runAt.trim() };
      await api.post('/api/automations', {
        name: name.trim(),
        schedule,
        steps: [{ agent_slug: agentSlug.trim(), goal: goal.trim() }],
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the automation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card accent="violet" style={styles.form}>
      <Text style={styles.formTitle}>New automation</Text>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Morning research" />
      <View style={styles.kindRow}>
        {(['interval', 'cron', 'once'] as const).map((kind) => (
          <Pressable key={kind} onPress={() => setScheduleKind(kind)} style={[styles.kindButton, scheduleKind === kind && styles.kindButtonActive]}>
            <Text style={[styles.kindText, scheduleKind === kind && styles.kindTextActive]}>{kind}</Text>
          </Pressable>
        ))}
      </View>
      {scheduleKind === 'interval' ? (
        <Field label="Every (minutes, min 1)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" placeholder="60" />
      ) : scheduleKind === 'cron' ? (
        <>
          <Field label="Cron (minute hour dom month dow)" value={cronExpr} onChangeText={setCronExpr} placeholder="30 9 * * *" />
          <Field label="Timezone (IANA)" value={cronTz} onChangeText={setCronTz} placeholder="Asia/Karachi" />
        </>
      ) : (
        <Field label="Run at (ISO 8601)" value={runAt} onChangeText={setRunAt} placeholder="2026-09-12T09:00:00Z" />
      )}
      <Field label="Agent slug" value={agentSlug} onChangeText={setAgentSlug} placeholder="research-researcher-002" />
      <Field label="Step goal" value={goal} onChangeText={setGoal} placeholder="What should this agent do every run?" multiline />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={busy ? 'Creating…' : 'Create automation'} onPress={() => void submit()} disabled={busy} loading={busy} />
    </Card>
  );
}

function AutomationDetail({ automationId, onClose }: { automationId: string; onClose: () => void }) {
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = (await api.get(`/api/automations/${encodeURIComponent(automationId)}`)) as { automation?: Automation };
      if (!body.automation) throw new Error('automation not found');
      setAutomation(body.automation);
      const runsBody = (await api.get(`/api/automations/${encodeURIComponent(automationId)}/runs`)) as { runs?: AutomationRun[] };
      setRuns(runsBody.runs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the automation.');
    }
  }, [automationId]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 5000);
    return () => clearInterval(poll);
  }, [load]);

  const act = async (action: 'pause' | 'resume' | 'run' | 'delete') => {
    if (!automation) return;
    if (action === 'delete') {
      Alert.alert('Delete automation', `Delete "${automation.name}"? Open runs are cancelled.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await api.del(`/api/automations/${automation.id}`);
              onClose();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Delete failed');
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
      return;
    }
    setBusy(true);
    try {
      if (action === 'run') {
        await api.post(`/api/automations/${automation.id}/run`, {});
      } else {
        await api.post(`/api/automations/${automation.id}/${action}`, {});
      }
      await load();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !automation) {
    return (
      <ScreenShell scroll>
        <PageHeader kicker="Automations" title="Automation" />
        <EmptyState text={error} />
        <Pressable onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>← All automations</Text>
        </Pressable>
      </ScreenShell>
    );
  }

  if (!automation) {
    return (
      <ScreenShell scroll>
        <PageHeader kicker="Automations" title="Automation" />
        <LoadingState text="Loading automation…" />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell scroll>
      <Pressable onPress={onClose} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← All automations</Text>
      </Pressable>
      <PageHeader kicker="Automation" title={automation.name} />
      <View style={styles.metaRow}>
        <Badge status={automation.status === 'active' ? 'active' : 'disabled'} />
        <Pill label={automation.status === 'active' ? `next ${formatTime(automation.nextRunAt)}` : 'paused'} tone={automation.status === 'active' ? 'cyan' : 'neutral'} />
      </View>

      <Card accent="none" style={styles.section}>
        <Text style={styles.label}>Schedule</Text>
        <Text style={styles.body}>{describeSchedule(automation.schedule)}</Text>
        <Text style={styles.label}>Steps</Text>
        {automation.steps.map((step, index) => (
          <View key={String(index)} style={styles.stepRow}>
            <Text style={styles.stepIndex}>{index + 1}</Text>
            <View style={styles.stepBody}>
              <Text style={styles.body}>{step.goal}</Text>
              <Text style={styles.muted}>{step.agentSlug}</Text>
            </View>
          </View>
        ))}
        <Text style={styles.label}>Stats</Text>
        <Text style={styles.muted}>
          {automation.runCount} run{automation.runCount === 1 ? '' : 's'} · {automation.failCount} failed · retries {automation.maxRetries} · timeout {Math.round(automation.timeoutMs / 1000)}s
        </Text>
        <Text style={styles.muted}>Last run: {formatTime(automation.lastRunAt)}</Text>
      </Card>

      <View style={styles.actions}>
        {automation.status === 'active' ? (
          <Button label={busy ? '…' : '⏸ Pause'} tone="ghost" onPress={() => void act('pause')} disabled={busy} />
        ) : (
          <Button label={busy ? '…' : '▶ Resume'} tone="ghost" onPress={() => void act('resume')} disabled={busy} />
        )}
        <Button label={busy ? '…' : '⚡ Run now'} tone="primary" onPress={() => void act('run')} disabled={busy} />
        <Button label="Delete" tone="danger" onPress={() => void act('delete')} disabled={busy} />
      </View>

      <Text style={styles.heading}>Runs</Text>
      {runs.length === 0 ? (
        <EmptyState text="No runs yet." />
      ) : (
        runs.map((run) => (
          <Card key={run.id} accent="none" style={styles.runCard}>
            <View style={styles.itemRow}>
              <View style={styles.itemBody}>
                <Text style={styles.muted}>{formatTime(run.startedAt ?? run.scheduledFor)}</Text>
                <Text style={styles.body}>
                  {run.triggerReason === 'manual' ? 'Manual run' : 'Scheduled run'}
                  {run.errorMessage ? `\n${run.errorMessage}` : ''}
                </Text>
              </View>
              <Badge status={run.status} />
            </View>
          </Card>
        ))
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
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
  stepRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stepIndex: { color: palette.violet, fontWeight: '900', fontSize: 13 },
  stepBody: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  heading: { color: palette.textSoft, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.sm },
  runCard: { padding: spacing.sm, marginBottom: spacing.sm },
  form: { padding: spacing.md, marginBottom: spacing.md },
  formTitle: { color: palette.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.sm },
  kindRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  kindButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line },
  kindButtonActive: { borderColor: palette.violet, backgroundColor: palette.violetSoft },
  kindText: { color: palette.textDim, fontWeight: '700', fontSize: 12 },
  kindTextActive: { color: palette.violet },
  error: { color: palette.red, fontSize: 12, marginBottom: spacing.sm },
});
