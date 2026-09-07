import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';

export function WorkspaceScreen() {
  const [projects, setProjects] = useState<any[]>([]);
  const [name, setName] = useState('');

  const load = async () => {
    const body = await api.get('/api/projects').catch(() => ({ projects: [] }));
    setProjects(body.projects || []);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await api.post('/api/projects', { name: name.trim() });
    setName('');
    await load();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Workspace</Text>
      <View style={styles.searchRow}>
        <TextInput style={styles.input} placeholder="New project name" value={name} onChangeText={setName} />
        <TouchableOpacity style={styles.smallButton} onPress={create}><Text style={styles.smallButtonText}>Create</Text></TouchableOpacity>
      </View>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.muted}>{item.slug || item.id}</Text>
          </View>
        )}
      />
      <Text style={styles.muted}>Files can be uploaded through the web workspace or the API.</Text>
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
});
