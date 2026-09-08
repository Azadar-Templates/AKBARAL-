import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { palette, radius, spacing } from '../theme';
import { Button, Card, Field, PageHeader, ScreenShell } from '../components/ui';

type Phase = 'idle' | 'thinking' | 'executing' | 'success' | 'error';

const phaseCopy: Record<Phase, { label: string; tone: string; message: string }> = {
  idle: { label: 'STANDBY', tone: palette.textDim, message: 'MASTER is ready to plan and dispatch your mission.' },
  thinking: { label: 'THINKING', tone: palette.violet, message: 'MASTER is decomposing your goal and selecting specialists.' },
  executing: { label: 'EXECUTING', tone: palette.gold, message: 'Specialist agents are executing the plan in your workspace.' },
  success: { label: 'SUCCESS', tone: palette.green, message: 'Plan and execution completed. Review the output below.' },
  error: { label: 'ERROR', tone: palette.red, message: 'The request could not be completed. Review the error below.' },
};

export function MasterScreen() {
  const [goal, setGoal] = useState('');
  const [output, setOutput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setPhase('thinking');
    setOutput('Planning…');
    try {
      const plan = await api.post('/api/workflows/master', { goal });
      const workflowId = plan.workflow?.id;
      const planText = JSON.stringify(plan.plan, null, 2);
      setPhase('executing');
      if (workflowId) {
        const run = await api.post(`/api/workflows/${workflowId}/run`, {});
        setOutput(`${planText}\n\nExecution started:\n${JSON.stringify(run, null, 2)}`);
        setPhase('success');
      } else {
        setOutput(planText);
        setPhase('success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      Alert.alert('Error', message);
      setOutput(message);
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const state = phaseCopy[phase];

  return (
    <ScreenShell scroll>
      <PageHeader kicker="Mission orchestration" title="MASTER AI" />

      <Card accent="cyan" style={styles.core}>
        <View style={styles.coreRow}>
          <View style={[styles.coreOrb, { borderColor: state.tone, shadowColor: state.tone }]} />
          <View style={styles.coreText}>
            <Text style={[styles.phaseLabel, { color: state.tone }]}>{state.label}</Text>
            <Text style={styles.phaseMessage}>{state.message}</Text>
          </View>
        </View>
      </Card>

      <Text style={styles.muted}>Describe your goal. MASTER plans, selects specialists and executes.</Text>
      <Field multiline value={goal} onChangeText={setGoal} placeholder="e.g. Build my company website and create a launch plan." style={styles.input} />

      <Button label="Plan & run" onPress={submit} loading={busy} />

      {output ? (
        <Card style={styles.output}>
          <Text style={styles.outputText}>{output}</Text>
        </Card>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  core: { marginBottom: spacing.md, padding: spacing.lg },
  coreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  coreOrb: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    backgroundColor: palette.bg3,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    elevation: 6,
  },
  coreText: { flex: 1 },
  phaseLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  phaseMessage: { color: palette.textDim, fontSize: 13, marginTop: 4, lineHeight: 18 },
  muted: { color: palette.textDim, marginBottom: spacing.md },
  input: { minHeight: 120, textAlignVertical: 'top' },
  output: { marginTop: spacing.lg },
  outputText: { color: palette.textSoft, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
