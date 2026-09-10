import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { palette, spacing } from '../theme';
import { Button, Card, Field, LoadingState, PageHeader, ScreenShell, Skeleton, Stat } from '../components/ui';

/** USD money formatting shared with the web client ($50 / $49.99). */
function usd(cents: unknown): string {
  const n = Number(cents || 0) / 100;
  return n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BillingScreen({ user }: { user: { id: string; email: string; freeCredits: number; role: string } }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [credits, setCredits] = useState('10');
  const [amount, setAmount] = useState('1000'); // $10.00 in USD cents
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/billing/plans').then((body) => setPlans(body.plans || [])).catch(() => setPlans([]));
  }, []);

  const buy = async () => {
    setBusy(true);
    try {
      const body = await api.post('/api/billing/credits', { credits: Number(credits), amount_cents: Number(amount), provider: 'manual' }).catch((e) => ({ error: e.message }));
      Alert.alert('Purchase', body?.error ?? JSON.stringify(body.order ?? body));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell scroll>
      <PageHeader kicker="Control costs" title="Billing & credits" />
      <View style={styles.row}>
        <Stat label="Free tasks" value={user.freeCredits} accent={palette.accent} />
        <Stat label="Role" value={user.role} accent={palette.telemetry} />
      </View>

      <Text style={styles.heading}>Plans</Text>
      {plans.length === 0 ? <Skeleton count={3} height={76} /> : plans.map((plan) => (
        <Card key={plan.key} accent={plan.key === 'pro' ? 'accent' : 'telemetry'} style={plan.key === 'pro' ? styles.featured : undefined}>
          <View style={styles.planHead}>
            <Text style={styles.planName}>{plan.name}</Text>
            {plan.key === 'pro' ? <View style={styles.featuredTag}><Text style={styles.featuredTagText}>FEATURED</Text></View> : null}
          </View>
          <Text style={styles.planPrice}>{usd(plan.price_cents)}<Text style={styles.planInterval}> / {plan.billing_interval || 'month'}</Text></Text>
          <Text style={styles.muted}>{plan.description || ''}</Text>
          <Text style={styles.planMeta}>{plan.monthly_credits || 0} credits · {plan.max_agents || 0} agents · {plan.max_workspaces || 0} workspaces</Text>
        </Card>
      ))}

      <Text style={styles.heading}>Custom credit top-up</Text>
      <Field keyboardType="numeric" value={credits} onChangeText={setCredits} placeholder="Credits" label="Credits" />
      <Field keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Amount in USD cents" label="Amount (USD cents)" />
      <Button label="Request secure purchase" onPress={buy} loading={busy} />

      <View style={styles.security}>
        <Text style={styles.securityText}>Payments are credentialed server-side with Razorpay or your configured provider. No card data touches the app client.</Text>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  heading: { color: palette.text2, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.sm },
  featured: { borderLeftWidth: 3, borderLeftColor: palette.accent },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { color: palette.text, fontWeight: '900', fontSize: 17 },
  featuredTag: {
    backgroundColor: 'rgba(255,207,92,0.14)',
    borderColor: palette.lineAccent,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  featuredTagText: { color: palette.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  planPrice: { color: palette.text, fontSize: 24, fontWeight: '900', marginTop: 6 },
  planInterval: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  planMeta: { color: palette.textDim, fontSize: 12, marginTop: 8 },
  muted: { color: palette.textDim, marginTop: 4 },
  security: {
    backgroundColor: palette.bg3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  securityText: { color: palette.textDim, fontSize: 12, lineHeight: 18 },
});
