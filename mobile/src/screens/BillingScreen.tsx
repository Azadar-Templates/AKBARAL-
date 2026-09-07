import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';

export function BillingScreen({ user }: { user: { id: string; email: string; freeCredits: number; role: string } }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [credits, setCredits] = useState('10');
  const [amount, setAmount] = useState('2500');

  useEffect(() => {
    api.get('/api/billing/plans').then((body) => setPlans(body.plans || [])).catch(() => setPlans([]));
  }, []);

  const buy = async () => {
    const body = await api.post('/api/billing/credits', { credits: Number(credits), amount_cents: Number(amount), provider: 'manual' }).catch((e) => ({ error: e.message }));
    alert(body?.error ?? JSON.stringify(body.order ?? body));
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.title}>Billing & credits</Text>
      <View style={styles.stat}><Text style={styles.statValue}>{user.freeCredits}</Text><Text style={styles.statLabel}>Free tasks</Text></View>
      {plans.map((plan) => (
        <View key={plan.key} style={styles.card}>
          <Text style={styles.cardTitle}>{plan.name}</Text>
          <Text style={styles.muted}>PKR {Number(plan.price_cents || 0) / 100} / {plan.billing_interval || 'month'}</Text>
        </View>
      ))}
      <Text style={styles.heading}>Custom credits</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={credits} onChangeText={setCredits} placeholder="Credits" />
      <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Amount PKR" />
      <TouchableOpacity style={styles.button} onPress={buy}><Text style={styles.buttonText}>Request purchase</Text></TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b16', padding: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  heading: { color: '#93a5c9', marginTop: 16, marginBottom: 8 },
  stat: { backgroundColor: '#0b1124', borderRadius: 12, padding: 14, marginBottom: 12 },
  statValue: { color: '#ffcf5c', fontSize: 26, fontWeight: '800' },
  statLabel: { color: '#93a5c9' },
  card: { backgroundColor: '#0b1124', borderRadius: 12, padding: 12, marginBottom: 10 },
  cardTitle: { color: '#eaf0ff', fontWeight: '700' },
  muted: { color: '#93a5c9' },
  input: { backgroundColor: '#101b38', color: '#eaf0ff', borderRadius: 10, padding: 12, marginBottom: 10 },
  button: { backgroundColor: '#ffcf5c', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#231200', fontWeight: '800' },
});
