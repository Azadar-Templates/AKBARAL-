import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { motion, palette, radius, spacing } from '../theme';
import { Badge, BrandMark, Card, EmptyState, FadeIn, HeroCard, LoadingState, PageHeader, ScreenShell, Stat } from '../components/ui';

export function DashboardScreen({ user, onOpenTask, note }: { user: { id: string; email: string; freeCredits: number; role: string }; onOpenTask: (taskId: string) => void; note?: string | null }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/tasks').then((body) => setTasks(body.tasks || [])).catch(() => setTasks([])).finally(() => setLoading(false));
  }, []);

  return (
    <ScreenShell scroll>
      <FadeIn>
        <View style={styles.brandRow}>
          <BrandMark size={42} />
          <View style={styles.brandText}>
            <Text style={styles.brandName}>AKBARAL!</Text>
            <Text style={styles.brandTagline}>ONE INTELLIGENCE · EVERY SOLUTION</Text>
          </View>
        </View>
      </FadeIn>
      <PageHeader kicker="Command center" title="Dashboard" />
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <View style={styles.row}>
        <Stat label="Free tasks" value={user.freeCredits} accent={palette.accent} />
        <Stat label="Role" value={user.role} accent={palette.telemetry} />
        <Stat label="Tasks" value={tasks.length} accent={palette.accent2} />
      </View>

      <FadeIn delay={motion.staggerMs}>
        <HeroCard eyebrow="MASTER AI" title="Tell AKBARAL what to build." text="MASTER plans the mission, selects specialist agents, streams execution and returns verified output — all inside your private workspace." accent="accent" />
      </FadeIn>

      <Card accent="cyan" style={styles.recommend}>
        <Text style={styles.recommendTitle}>Recommended next</Text>
        <Text style={styles.muted}>Open MASTER AI and describe your next goal. It will choose specialists, reserve one credit atomically and refund it if the run fails.</Text>
      </Card>

      <Text style={styles.heading}>Recent tasks</Text>
      {loading ? <LoadingState /> : tasks.length === 0 ? <EmptyState text="No tasks yet. Open MASTER and describe your goal." /> : tasks.slice(0, 10).map((task) => (
        <Pressable key={task.id} onPress={() => onOpenTask(String(task.id))}>
          <Card style={styles.item}>
            <View style={styles.itemRow}>
              <View style={styles.itemBody}>
                <Text style={styles.itemTitle}>{task.title || task.goal || task.id}</Text>
                <Text style={styles.muted}>{task.status}</Text>
              </View>
              <Badge status={task.status} />
            </View>
          </Card>
        </Pressable>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  brandText: { flex: 1 },
  brandName: { color: palette.text, fontSize: 20, fontWeight: '900', letterSpacing: 1.2 },
  brandTagline: { color: palette.textFaint, fontSize: 9, fontWeight: '800', letterSpacing: 1.6, marginTop: 2 },
  note: { color: palette.accent, fontSize: 12, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  hero: { marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: palette.accent },
  heroEyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  heroTitle: { color: palette.text, fontSize: 19, fontWeight: '900', marginTop: 6, marginBottom: 4 },
  heroText: { color: palette.textDim, lineHeight: 20 },
  recommend: { marginBottom: spacing.md },
  recommendTitle: { color: palette.text, fontWeight: '800', marginBottom: 4 },
  heading: { color: palette.text2, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.md },
  item: { padding: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemBody: { flex: 1 },
  itemTitle: { color: palette.text, fontWeight: '700', fontSize: 15 },
  muted: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.telemetry, shadowColor: palette.telemetry, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
});
