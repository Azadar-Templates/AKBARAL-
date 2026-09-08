import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing } from '../theme';
import { Button, Card, PageHeader, ScreenShell } from '../components/ui';

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <ScreenShell scroll>
      <PageHeader kicker="Your account" title="Settings" />
      <Card accent="cyan">
        <Text style={styles.title}>Session & security</Text>
        <Text style={styles.muted}>Session, notifications, credits and subscription are managed securely by the AKBARAL backend.</Text>
      </Card>

      {[
        ['Refresh rotation', 'Access tokens refresh with rotated refresh tokens, and logout invalidates active sessions.'],
        ['Credential safety', 'Provider keys are read only server-side and never shipped to the client.'],
        ['Execution isolation', 'Execution streams are scoped to your account and private workspace.'],
      ].map(([heading, body]) => (
        <Card key={heading} style={styles.item}>
          <View style={styles.itemHead}>
            <View style={styles.dot} />
            <Text style={styles.itemTitle}>{heading}</Text>
          </View>
          <Text style={styles.muted}>{body}</Text>
        </Card>
      ))}

      <View style={styles.footer}>
        <Button label="Log out" tone="danger" onPress={onLogout} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  title: { color: palette.text, fontWeight: '900', fontSize: 18, marginBottom: 6 },
  muted: { color: palette.textDim, lineHeight: 19 },
  item: { padding: spacing.lg },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.green, shadowColor: palette.green, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
  itemTitle: { color: palette.text, fontWeight: '800', fontSize: 15 },
  footer: { marginTop: spacing.lg },
});
