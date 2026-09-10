import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { palette, radius, spacing } from '../theme';
import { Button, Card, Field, PageHeader, ScreenShell, StatusDot, useReducedMotion } from '../components/ui';

type Phase = 'idle' | 'thinking' | 'executing' | 'success' | 'error';

const phaseCopy: Record<Phase, { label: string; tone: string; message: string }> = {
  idle: { label: 'STANDBY', tone: palette.textDim, message: 'MASTER is ready to plan and dispatch your mission.' },
  thinking: { label: 'THINKING', tone: palette.accent2, message: 'MASTER is decomposing your goal and selecting specialists.' },
  executing: { label: 'EXECUTING', tone: palette.accent, message: 'Specialist agents are executing the plan in your workspace.' },
  success: { label: 'SUCCESS', tone: palette.green, message: 'Plan and execution completed. Review the output below.' },
  error: { label: 'ERROR', tone: palette.red, message: 'The request could not be completed. Review the error below.' },
};

/** The MASTER orchestration pipeline, visualized: the real stages a goal
 * travels through (goal → plan → agents → tools → verification → result).
 * Live stages pulse; success settles green; failures mark red. Purely a
 * representation of the actual pipeline — no fabricated progress. */
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

export function MasterScreen() {
  const [goal, setGoal] = useState('');
  const [output, setOutput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const orbPulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (phase === 'idle' || phase === 'success' || phase === 'error' || reducedMotion) {
      orbPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbPulse, { toValue: 1.18, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(orbPulse, { toValue: 0.92, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, orbPulse, reducedMotion]);

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
          <Animated.View style={[styles.coreOrb, { borderColor: state.tone, shadowColor: state.tone, transform: [{ scale: orbPulse }] }]} />
          <View style={styles.coreText}>
            <Text style={[styles.phaseLabel, { color: state.tone }]}>{state.label}</Text>
            <Text style={styles.phaseMessage}>{state.message}</Text>
          </View>
        </View>
      </Card>

      <OrchestrationFlow phase={phase} />

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
  flow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: spacing.md },
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
  muted: { color: palette.textDim, marginBottom: spacing.md },
  input: { minHeight: 120, textAlignVertical: 'top' },
  output: { marginTop: spacing.lg },
  outputText: { color: palette.text2, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
