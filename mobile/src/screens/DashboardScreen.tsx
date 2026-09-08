import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { palette, radius, spacing } from '../theme';
import { Card, EmptyState, LoadingState, PageHeader, ScreenShell, Stat } from '../components/ui';

export function DashboardScreen({ user }: { user: { id: string; email: string; freeCredits: number; role: string } }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/tasks').then((body) => setTasks(body.tasks || [])).catch(() => setTasks([])).finally(() => setLoading(false));
  }, []);

  return (
    <ScreenShell scroll>
      <PageHeader kicker="Command center" title="Dashboard" />
      <View style={styles.row}>
        <Stat label="Free tasks" value={user.freeCredits} accent={palette.gold} />
        <Stat label="Role" value={user.role} accent={palette.cyan} />
        <Stat label="Tasks" value={tasks.length} accent={palette.violet} />
      </View>

      <Card accent="gold" style={styles.hero}>
        <Text style={styles.heroEyebrow}>MASTER AI</Text>
        <Text style={styles.heroTitle}>Tell AKBARAL what to build.</Text>
        <Text style={styles.heroText}>MASTER plans the mission, selects specialist agents, streams execution and returns verified output — all inside your private workspace.</Text>
      </Card>

      <Text style={styles.heading}>Recent tasks</Text>
      {loading ? <LoadingState /> : tasks.length === 0 ? <EmptyState text="No tasks yet. Open MASTER and describe your goal." /> : tasks.slice(0, 10).map((task) => (
        <Card key={task.id} style={styles.item}>
          <View style={styles.itemRow}>
            <View style={styles.itemBody}>
              <Text style={styles.itemTitle}>{task.title || task.goal || task.id}</Text>
              <Text style={styles.muted}>{task.status}</Text>
            </View>
            <View style={styles.statusDot} />
          </View>
        </Card>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  hero: { marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: palette.gold },
  heroEyebrow: { color: palette.gold, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  heroTitle: { color: palette.text, fontSize: 19, fontWeight: '900', marginTop: 6, marginBottom: 4 },
  heroText: { color: palette.textDim, lineHeight: 20 },
  heading: { color: palette.textSoft, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.md },
  item: { padding: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemBody: { flex: 1 },
  itemTitle: { color: palette.text, fontWeight: '700', fontSize: 15 },
  muted: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.cyan, shadowColor: palette.cyan, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
});
