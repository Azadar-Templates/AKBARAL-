import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';
import { palette, radius, spacing, shadow } from '../theme';
import { Button, BrandMark, Card, Field, Pill } from '../components/ui';

export function LoginScreen({ onLogin }: { onLogin: (user: { id: string; email: string; freeCredits: number; role: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('AKBARAL!', 'Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      if (registerMode) {
        await api.register(email, password, name);
        Alert.alert('Welcome', 'Account created. Sign in to continue.');
        setRegisterMode(false);
        return;
      }
      const body = await api.login(email, password);
      onLogin(body.user);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.brandWrap}>
          <BrandMark />
          <Text style={styles.brand}>AKBARAL<Text style={styles.brandMark}>!</Text></Text>
          <Text style={styles.eyebrow}>MASTER AI OPERATING PLATFORM</Text>
          <View style={styles.pillRow}>
            <Pill label="4,000+ agents" tone="gold" />
            <Pill label="Real execution" tone="cyan" />
            <Pill label="Honest credits" tone="green" />
          </View>
        </View>

        <Card accent="gold" style={styles.card}>
          <Text style={styles.title}>{registerMode ? 'Create account' : 'Sign in'}</Text>
          <Text style={styles.subtitle}>{registerMode ? 'Join the AKBARAL intelligence layer.' : 'Access MASTER, your agents and your workspace.'}</Text>
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" placeholder="you@company.com" value={email} onChangeText={setEmail} />
          {registerMode && <Field label="Name" placeholder="Your name" value={name} onChangeText={setName} />}
          <Field label="Password" secureTextEntry placeholder="••••••••" value={password} onChangeText={setPassword} />
          <Button label={registerMode ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
          <TouchableOpacity onPress={() => setRegisterMode((value) => !value)} disabled={busy}>
            <Text style={styles.link}>{registerMode ? 'Already have an account? Sign in' : 'No account? Create one'}</Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.trust}>
          {['Encrypted tokens', 'Credential-safe', 'SOC-grade ops'].map((item) => (
            <View key={item} style={styles.chip}><Text style={styles.chipText}>{item}</Text></View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: palette.bg },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  brandWrap: { alignItems: 'center', marginBottom: spacing.xl },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', marginTop: spacing.md },
  brand: { color: palette.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  brandMark: { color: palette.gold },
  eyebrow: { color: palette.cyan, fontSize: 10, fontWeight: '800', letterSpacing: 2.4, marginTop: 4 },
  card: { width: '100%', maxWidth: 430, padding: spacing.xl },
  title: { color: palette.text, fontSize: 22, fontWeight: '900', marginBottom: 4 },
  subtitle: { color: palette.textDim, marginBottom: spacing.lg },
  link: { color: palette.cyan, textAlign: 'center', marginTop: spacing.lg, fontWeight: '700' },
  trust: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.lg },
  chip: {
    backgroundColor: palette.bg3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipText: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
});
