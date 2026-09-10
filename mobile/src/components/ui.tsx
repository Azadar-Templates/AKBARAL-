import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { motion, palette, radius, shadow, sigilColors, spacing, statusColor, statusTone, type as typeScale } from '../theme';

/* ============================================================
 * AKBARAL! shared UI primitives — the mobile face of the unified
 * design system (design-system/tokens.json). Same identity as the
 * website: obsidian foundation, indigo/violet atmosphere, glass,
 * hairlines, cinematic restraint. Motion always respects the
 * system reduce-motion preference.
 * ============================================================ */

/** True when the OS reduce-motion preference is on. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (mounted) setReduced(value); })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value: boolean) => setReduced(value));
    return () => { mounted = false; sub.remove(); };
  }, []);
  return reduced;
}

/** Cinematic entrance: soft rise + fade. Instant when reduced motion. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(reduced ? 0 : 12)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: motion.base, delay, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: motion.base, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, rise, delay, reduced]);
  return <Animated.View style={[{ opacity, transform: [{ translateY: rise }] }, style]}>{children}</Animated.View>;
}

/** Pulsing status dot — live/running telemetry heartbeat. */
export function StatusDot({ status, size = 10 }: { status: string; size?: number }) {
  const reduced = useReducedMotion();
  const color = statusColor(status);
  const pulsing = statusTone(status) === 'telemetry';
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulsing || reduced) { opacity.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulsing, reduced, opacity]);
  return (
    <Animated.View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: color, opacity,
        shadowColor: color, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 3,
      }}
    />
  );
}

/** Screen scaffold: obsidian canvas + the shared indigo atmosphere at the top. */
export function ScreenShell({ children, style, scroll }: { children: React.ReactNode; style?: ViewStyle; scroll?: boolean }) {
  const atmosphere = (
    <LinearGradient
      colors={['rgba(93,111,240,0.16)', 'rgba(93,111,240,0.05)', 'rgba(9,11,24,0)']}
      locations={[0, 0.55, 1]}
      style={styles.atmosphere}
      pointerEvents="none"
    />
  );
  if (scroll) {
    return (
      <View style={[styles.screen, style]}>
        {atmosphere}
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[styles.screen, style]}>
      {atmosphere}
      <View style={styles.screenContent}>{children}</View>
    </View>
  );
}

export function PageHeader({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <View style={styles.header}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

/** Accent keys accepted across components (legacy names map forward). */
type AccentKey = 'gold' | 'cyan' | 'violet' | 'blue' | 'accent' | 'telemetry' | 'indigo' | 'red' | 'none';

function accentColor(accent?: AccentKey): string | null {
  switch (accent) {
    case 'gold': case 'accent': return palette.accent;
    case 'cyan': case 'telemetry': return palette.telemetry;
    case 'violet': case 'indigo': return palette.accent2;
    case 'blue': return palette.blue;
    case 'red': return palette.red;
    default: return null;
  }
}

export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: AccentKey }) {
  const color = accentColor(accent);
  return (
    <View style={[styles.card, shadow.card, color ? { borderColor: `${color}55` } : null, style]}>
      <View style={styles.cardSheen} pointerEvents="none" />
      {children}
    </View>
  );
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
  const inner = (
    <>
      {loading ? <ActivityIndicator color={tone === 'primary' ? palette.onAccent : palette.text} /> : <Text style={[styles.buttonText, tone === 'primary' ? { color: palette.onAccent } : null]}>{label}</Text>}
    </>
  );
  if (tone === 'primary') {
    return (
      <Pressable disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, shadow.glow, pressed && !disabled ? styles.buttonPressed : null, disabled ? styles.buttonDisabled : null]}>
        <LinearGradient colors={[palette.accent2, palette.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonGradient}>
          {inner}
        </LinearGradient>
      </Pressable>
    );
  }
  const bg = tone === 'danger' ? palette.redSoft : tone === 'secondary' ? palette.surface2 : 'transparent';
  const color = tone === 'danger' ? palette.red : palette.text;
  const border = tone === 'danger' ? `${palette.red}59` : palette.lineStrong;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: border }, pressed && !disabled ? styles.buttonPressed : null, disabled ? styles.buttonDisabled : null]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label: fieldLabel, style, ...rest } = props;
  return (
    <View style={styles.fieldWrap}>
      {fieldLabel ? <Text style={styles.fieldLabel}>{fieldLabel}</Text> : null}
      <TextInput placeholderTextColor={palette.textFaint} style={[styles.input, style]} {...rest} />
    </View>
  );
}

/** Status badge: colored dot + label; live/running states pulse. */
export function Badge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.badge, { borderColor: `${color}55`, backgroundColor: `${color}1a` }]}>
      <StatusDot status={status} size={6} />
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

/** Neutral pill with tone keys (legacy tone names map to the unified palette). */
export function Pill({ label, tone }: { label: string; tone?: 'gold' | 'cyan' | 'blue' | 'violet' | 'green' | 'red' | 'neutral' | 'accent' | 'telemetry' | 'indigo' | 'amber' }) {
  const colorMap: Record<string, string> = {
    gold: palette.accent, accent: palette.accent,
    cyan: palette.telemetry, telemetry: palette.telemetry,
    blue: palette.blue, violet: palette.accent2, indigo: palette.accent2,
    green: palette.green, red: palette.red, amber: palette.amber, neutral: palette.textDim,
  };
  const softMap: Record<string, string> = {
    gold: palette.accentSoft, accent: palette.accentSoft,
    cyan: palette.telemetrySoft, telemetry: palette.telemetrySoft,
    blue: palette.blueSoft, violet: palette.indigoSoft, indigo: palette.indigoSoft,
    green: palette.greenSoft, red: palette.redSoft, amber: palette.amberSoft, neutral: palette.surface2,
  };
  const key = tone ?? 'neutral';
  const color = colorMap[key] ?? palette.textDim;
  return (
    <View style={[styles.pill, { backgroundColor: softMap[key] ?? palette.surface2, borderColor: `${color}44` }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark} pointerEvents="none">
        <Text style={styles.emptyMarkText}>⬡</Text>
      </View>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function LoadingState({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={palette.telemetry} />
      <Text style={[styles.emptyText, { marginTop: spacing.sm }]}>{text}</Text>
    </View>
  );
}

/** Animated shimmer placeholder rows for loading lists. */
export function Skeleton({ count = 3, height = 58 }: { count?: number; height?: number }) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1400, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-160, 360] });
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.skeletonRow, { height, marginBottom: i === count - 1 ? 0 : spacing.md }]}>
          {!reduced && (
            <Animated.View style={{ transform: [{ translateX }] }}>
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ width: 130, height }}
              />
            </Animated.View>
          )}
        </View>
      ))}
    </View>
  );
}

/** Honest error state with an optional retry action. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.empty, { borderColor: `${palette.red}44` }]}>
      <Text style={[styles.emptyText, { color: palette.red }]}>{message}</Text>
      {onRetry ? <Button label="Retry" tone="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Slim progress track with the accent gradient fill (0..1). */
export function ProgressBar({ value, style }: { value: number; style?: ViewStyle }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.progressTrack, style]}>
      <LinearGradient
        colors={[palette.accent2, palette.accent]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.progressFill, { width: `${Math.round(clamped * 100)}%` }]}
      />
    </View>
  );
}

export function BrandMark({ size = 46 }: { size?: number }) {
  return (
    <View style={[styles.brandMark, { width: size, height: size, borderRadius: Math.round(size * 0.3) }, shadow.glow]}>
      <LinearGradient colors={[palette.accent2, palette.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandGradient}>
        <View style={styles.brandSheen} pointerEvents="none" />
        <Text style={[styles.brandMarkText, { fontSize: Math.round(size * 0.41) }]}>A!</Text>
      </LinearGradient>
    </View>
  );
}

/** Agent identity sigil — the shared formula from design-system/tokens.json. */
export function AgentSigil({ name, category, size = 38 }: { name: string; category?: string; size?: number }) {
  const colors = sigilColors(name, category);
  const mono = monogramOf(name);
  return (
    <View
      style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.36),
        borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.fill,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: colors.glow, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
      }}
    >
      <Text style={{ color: colors.text, fontSize: Math.round(size * 0.3), fontWeight: '800', letterSpacing: 0.8 }}>{mono}</Text>
    </View>
  );
}

function monogramOf(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function HeroCard({ eyebrow, title, text, accent = 'accent' }: { eyebrow: string; title: string; text: string; accent?: AccentKey }) {
  const color = accentColor(accent) ?? palette.accent;
  return (
    <View style={[styles.heroCard, { borderColor: `${color}66` }]}>
      <View style={[styles.heroGlow, { backgroundColor: `${color}26` }]} pointerEvents="none" />
      <Text style={[styles.heroEyebrow, { color: palette.telemetry }]}>{eyebrow}</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  atmosphere: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.lg },
  kicker: { color: palette.telemetry, fontSize: typeScale.micro.fontSize, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: palette.text, fontSize: 27, fontWeight: '900', letterSpacing: -0.5 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardSheen: { position: 'absolute', top: 0, left: 10, right: 10, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  stat: { flex: 1, minWidth: 100, padding: spacing.md },
  statValue: { color: palette.accent, fontSize: 23, fontWeight: '900', letterSpacing: -0.4 },
  statLabel: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: spacing.lg },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { color: palette.textDim, fontSize: 12, marginBottom: 6, marginLeft: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  empty: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  emptyMark: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1, borderColor: palette.lineStrong,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surface2,
    marginBottom: spacing.xs,
  },
  emptyMarkText: { color: palette.textFaint, fontSize: 18 },
  emptyText: { color: palette.textDim, textAlign: 'center' },
  skeletonRow: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
  },
  progressTrack: { height: 6, borderRadius: radius.pill, backgroundColor: palette.surface2, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: radius.pill },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5, marginBottom: spacing.sm, marginRight: spacing.xs },
  pillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  brandMark: { overflow: 'hidden', marginBottom: spacing.lg },
  brandGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brandSheen: { position: 'absolute', top: -16, left: -22, width: 96, height: 96, backgroundColor: 'rgba(255,255,255,0.28)', transform: [{ rotate: '18deg' }] },
  brandMarkText: { color: palette.onAccent, fontWeight: '900' },
  heroCard: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.xl, marginBottom: spacing.lg, overflow: 'hidden', backgroundColor: palette.surface },
  heroGlow: { position: 'absolute', top: -50, right: -46, width: 160, height: 160, borderRadius: 80 },
  heroEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm },
  heroTitle: { color: palette.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: spacing.sm },
  heroText: { color: palette.text2, fontSize: 14, lineHeight: 20 },
});
