import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { palette, spacing } from '../theme';
import { Button, Card, EmptyState, Field, PageHeader } from '../components/ui';
import { LinearGradient } from 'expo-linear-gradient';

export function WorkspaceScreen() {
  const [projects, setProjects] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const body = await api.get('/api/projects').catch(() => ({ projects: [] }));
    setProjects(body.projects || []);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/projects', { name: name.trim() });
      setName('');
      await load();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['rgba(115,120,232,0.16)', 'rgba(115,120,232,0.05)', 'rgba(8,8,10,0)']} locations={[0, 0.55, 1]} style={styles.atmosphere} pointerEvents="none" />
      <View style={styles.header}>
        <PageHeader kicker="Project vault" title="Workspace" />
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Field placeholder="New project name" value={name} onChangeText={setName} />
          </View>
          <Button label="Create" onPress={create} loading={busy} />
        </View>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState text="No projects yet. Create one to host your work." />}
        renderItem={({ item }) => (
          <Card accent="cyan" style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.muted}>{item.slug || item.id}</Text>
              </View>
              <View style={styles.orb} />
            </View>
          </Card>
        )}
      />

      <View style={styles.footnote}>
        <Text style={styles.muted}>Files can be uploaded through the web workspace or the API.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  atmosphere: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  searchField: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  card: { padding: spacing.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardBody: { flex: 1 },
  cardTitle: { color: palette.text, fontWeight: '800', fontSize: 16 },
  muted: { color: palette.textDim, marginTop: 2 },
  orb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.telemetry,
    shadowColor: palette.telemetry,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 5,
  },
  footnote: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
