import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../api/client';
import { palette, spacing } from '../theme';
import { AgentSigil, Badge, Button, Card, EmptyState, Field, PageHeader, Skeleton } from '../components/ui';

export function AgentsScreen() {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (query) params.set('q', query);
    try {
      const body = await api.get(`/api/agents?${params}`);
      setAgents(body.agents || []);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Could not load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (slug: string) => {
    setBusySlug(slug);
    try {
      await api.post(`/api/agents/${slug}/save`, { saved: true, favorite: true });
      Alert.alert('Agent World', `${slug} saved to your library.`);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Save failed');
    } finally {
      setBusySlug(null);
    }
  };

  const run = async (slug: string, goal: string) => {
    setBusySlug(slug);
    try {
      const body = await api.post('/api/workflows/agent', { agent_slug: slug, goal });
      Alert.alert('Dispatched', `${slug} started. Execution ${body.executionId}.`);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Dispatch failed');
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['rgba(93,111,240,0.16)', 'rgba(93,111,240,0.05)', 'rgba(9,11,24,0)']} locations={[0, 0.55, 1]} style={styles.atmosphere} pointerEvents="none" />
      <View style={styles.header}>
        <PageHeader kicker="Specialist intelligence" title="Agent World" />
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Field placeholder="Search agents…" value={query} onChangeText={setQuery} />
          </View>
          <Button label="Go" onPress={load} />
        </View>
      </View>

      {loading ? (
        <View style={styles.skeletonWrap}><Skeleton count={4} height={96} /></View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState text="No agents found." />}
          renderItem={({ item }) => (
            <Card accent="none" style={styles.card}>
              <View style={styles.cardHead}>
                <AgentSigil name={item.name} category={item.category} />
                <View style={styles.cardBody}>
                  {item.category ? <Text style={styles.cardCategory}>{item.category}</Text> : null}
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.muted} numberOfLines={2}>{item.specialization || item.description || item.slug}</Text>
                </View>
                <Badge status={item.status || 'active'} />
              </View>
              {(item.capabilities || []).slice(0, 4).map((cap: string) => (
                <View key={cap} style={styles.tag}><Text style={styles.tagText}>{cap}</Text></View>
              ))}
              <View style={styles.cardActions}>
                <Button label="Save" tone="ghost" onPress={() => save(item.slug)} disabled={busySlug === item.slug} />
                <Button label="Run" tone="secondary" onPress={() => run(item.slug, item.specialization || `${item.slug} task`)} disabled={busySlug === item.slug} />
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  atmosphere: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  skeletonWrap: { paddingHorizontal: spacing.lg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  searchField: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  card: { padding: spacing.lg },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardBody: { flex: 1 },
  cardCategory: { color: palette.telemetry, fontSize: 9, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 3 },
  cardTitle: { color: palette.text, fontWeight: '800', fontSize: 16 },
  muted: { color: palette.textDim, marginTop: 2 },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: palette.bg3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
    marginRight: 6,
  },
  tagText: { color: palette.text2, fontSize: 11 },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
