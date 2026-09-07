import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';

export function AgentsScreen() {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<any[]>([]);

  const load = async () => {
    const params = new URLSearchParams({ limit: '50' });
    if (query) params.set('q', query);
    const body = await api.get(`/api/agents?${params}`);
    setAgents(body.agents || []);
  };

  useEffect(() => { load(); }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Agent World</Text>
      <View style={styles.searchRow}>
        <TextInput style={styles.input} placeholder="Search agents…" value={query} onChangeText={setQuery} />
        <TouchableOpacity style={styles.smallButton} onPress={load}><Text style={styles.smallButtonText}>Go</Text></TouchableOpacity>
      </View>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.muted}>{item.specialization || item.description || item.slug}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.smallButton} onPress={() => api.post('/api/agents/' + item.slug + '/save', { saved: true, favorite: true }).catch(() => null)}><Text style={styles.smallButtonText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => api.post('/api/workflows/agent', { agent_slug: item.slug, goal: item.specialization }).catch(() => null)}><Text style={styles.smallButtonText}>Run</Text></TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b16', padding: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  input: { flex: 1, backgroundColor: '#101b38', color: '#eaf0ff', borderRadius: 10, padding: 12 },
  smallButton: { backgroundColor: '#20324b', padding: 10, borderRadius: 10 },
  smallButtonText: { color: '#ffcf5c', fontWeight: '800' },
  card: { backgroundColor: '#0b1124', borderRadius: 12, padding: 12, marginBottom: 10 },
  cardTitle: { color: '#eaf0ff', fontWeight: '700' },
  muted: { color: '#93a5c9' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
