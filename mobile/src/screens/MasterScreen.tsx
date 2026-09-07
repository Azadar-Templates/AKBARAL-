import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';

export function MasterScreen() {
  const [goal, setGoal] = useState('');
  const [output, setOutput] = useState('');

  const submit = async () => {
    if (!goal.trim()) return;
    setOutput('Planning…');
    try {
      const plan = await api.post('/api/workflows/master', { goal });
      const workflowId = plan.workflow?.id;
      setOutput(JSON.stringify(plan.plan, null, 2));
      if (workflowId) {
        const run = await api.post(`/api/workflows/${workflowId}/run`, {});
        setOutput(`${JSON.stringify(plan.plan, null, 2)}\n\nExecution: ${JSON.stringify(run, null, 2)}`);
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed');
      setOutput(error instanceof Error ? error.message : 'Failed');
    }
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.title}>MASTER AI</Text>
      <Text style={styles.muted}>Describe your goal. MASTER plans, selects specialists and executes.</Text>
      <TextInput style={styles.input} multiline value={goal} onChangeText={setGoal} placeholder="e.g. Build my company website and create a launch plan." />
      <TouchableOpacity style={styles.button} onPress={submit}><Text style={styles.buttonText}>Plan & run</Text></TouchableOpacity>
      {output ? <View style={styles.output}><Text style={styles.outputText}>{output}</Text></View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b16', padding: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  muted: { color: '#93a5c9', marginBottom: 14 },
  input: { backgroundColor: '#101b38', color: '#eaf0ff', minHeight: 120, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#29406b' },
  button: { backgroundColor: '#ffcf5c', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  buttonText: { color: '#231200', fontWeight: '800' },
  output: { backgroundColor: '#0a1226', borderRadius: 12, padding: 14, marginTop: 16 },
  outputText: { color: '#d6e2ff', fontFamily: 'monospace' },
});
