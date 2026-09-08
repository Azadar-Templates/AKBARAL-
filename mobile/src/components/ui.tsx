import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { palette, radius, shadow, spacing } from '../theme';

/* Reusable AKBARAL UI primitives for the mobile client. */

export function ScreenShell({ children, style, scroll }: { children: React.ReactNode; style?: ViewStyle; scroll?: boolean }) {
  if (scroll) {
    return (
      <ScrollView
        style={[styles.screen, style]}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, styles.screenContent, style]}>{children}</View>;
}

export function PageHeader({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <View style={styles.header}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: 'gold' | 'cyan' | 'violet' | 'none' }) {
  const border = accent === 'gold' ? palette.lineGold : accent === 'cyan' ? 'rgba(94,231,255,0.32)' : accent === 'violet' ? 'rgba(187,164,255,0.32)' : palette.line;
  return <View style={[styles.card, shadow.card, { borderColor: border }, style]}>{children}</View>;
}

export function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

export function Button({ label, onPress, tone = 'primary', disabled, loading }: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg = tone === 'primary' ? palette.gold : tone === 'danger' ? 'rgba(255,107,126,0.14)' : tone === 'secondary' ? palette.surfaceStrong : 'transparent';
  const color = tone === 'primary' ? '#231200' : tone === 'danger' ? palette.red : palette.text;
  const border = tone === 'primary' ? 'transparent' : tone === 'danger' ? 'rgba(255,107,126,0.35)' : palette.lineStrong;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: border }, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={palette.textFaint}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

export function Badge({ status }: { status: string }) {
  const color = ['active', 'completed', 'published', 'enabled'].includes(status) ? palette.green : ['failed', 'disabled', 'blocked'].includes(status) ? palette.red : ['pending', 'running', 'planned'].includes(status) ? palette.gold : palette.cyan;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}20` }]}>
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function LoadingState({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={palette.cyan} />
      <Text style={[styles.emptyText, { marginTop: spacing.sm }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.lg },
  kicker: { color: palette.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: palette.text, fontSize: 27, fontWeight: '900', letterSpacing: -0.4 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  stat: { flex: 1, minWidth: 100, padding: spacing.md },
  statValue: { color: palette.gold, fontSize: 23, fontWeight: '900' },
  statLabel: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { color: palette.textDim, fontSize: 12, marginBottom: 6, marginLeft: 2 },
  input: {
    backgroundColor: palette.bg3,
    color: palette.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    fontSize: 15,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  empty: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyText: { color: palette.textDim, textAlign: 'center' },
});
