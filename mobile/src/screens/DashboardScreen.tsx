import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';

export function DashboardScreen({ user }: { user: { id: string; email: string; freeCredits: number; role: string } }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/tasks').then((body) => setTasks(body.tasks || [])).catch(() => setTasks([])).finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.title}>Dashboard</Text>
      <View style={styles.row}>
        <View style={styles.stat}><Text style={styles.statValue}>{user.freeCredits}</Text><Text style={styles.statLabel}>Free tasks</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{user.role}</Text><Text style={styles.statLabel}>Role</Text></View>
        <View style={styles.stat}><Text style={styles.statValue}>{tasks.length}</Text><Text style={styles.statLabel}>Tasks</Text></View>
      </View>
      <Text style={styles.heading}>Recent tasks</Text>
      {loading ? <Text style={styles.muted}>Loading…</Text> : tasks.slice(0, 10).map((task) => (
        <View key={task.id} style={styles.item}>
          <Text style={styles.itemTitle}>{task.title || task.goal || task.id}</Text>
          <Text style={styles.muted}>{task.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b16', padding: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 12 },
  heading: { color: '#93a5c9', marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#0b1124', borderRadius: 12, padding: 14 },
  statValue: { color: '#ffcf5c', fontSize: 24, fontWeight: '800' },
  statLabel: { color: '#93a5c9' },
  item: { backgroundColor: '#0b1124', borderRadius: 10, padding: 12, marginBottom: 8 },
  itemTitle: { color: '#eaf0ff', fontWeight: '600' },
  muted: { color: '#93a5c9' },
});
