import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api } from './src/api/client';
import { palette } from './src/theme';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { MasterScreen } from './src/screens/MasterScreen';
import { AgentsScreen } from './src/screens/AgentsScreen';
import { WorkspaceScreen } from './src/screens/WorkspaceScreen';
import { BillingScreen } from './src/screens/BillingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.gold,
    background: palette.bg,
    card: palette.bg2,
    text: palette.text,
    border: palette.line,
    notification: palette.gold,
  },
};

const tabIcons: Record<string, string> = {
  Dashboard: '▣',
  MASTER: '◉',
  Agents: '⬡',
  Workspace: '▤',
  Billing: '◈',
  Settings: '⚙',
};

const makeScreenOptions = (name: string) => ({
  headerShown: true,
  headerStyle: { backgroundColor: palette.bg2, borderBottomColor: palette.line, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitleStyle: { color: palette.text, fontWeight: '900' as const, fontSize: 16 },
  headerTintColor: palette.gold,
  tabBarActiveTintColor: palette.gold,
  tabBarInactiveTintColor: palette.textDim,
  tabBarStyle: {
    backgroundColor: palette.bg2,
    borderTopColor: palette.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabelStyle: { fontWeight: '700' as const, fontSize: 11 },
  tabBarIcon: ({ focused }: { focused: boolean }) => (
    <Text style={{ color: focused ? palette.gold : palette.textDim, fontSize: 15, opacity: focused ? 1 : 0.72 }}>{tabIcons[name]}</Text>
  ),
});

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string; freeCredits: number; role: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await api.init();
      try {
        const body = await api.get('/api/me');
        setUser(body.user);
      } catch {
        setUser(null);
      }
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.gold} size="large" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Tab.Navigator>
        <Tab.Screen name="Dashboard" options={makeScreenOptions('Dashboard')}>{() => <DashboardScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="MASTER" options={makeScreenOptions('MASTER')} component={MasterScreen} />
        <Tab.Screen name="Agents" options={makeScreenOptions('Agents')} component={AgentsScreen} />
        <Tab.Screen name="Workspace" options={makeScreenOptions('Workspace')} component={WorkspaceScreen} />
        <Tab.Screen name="Billing" options={makeScreenOptions('Billing')}>{() => <BillingScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="Settings" options={makeScreenOptions('Settings')}>{() => <SettingsScreen onLogout={async () => { await api.logout(); setUser(null); }} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
