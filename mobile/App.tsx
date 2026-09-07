import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { api } from './src/api/client';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { MasterScreen } from './src/screens/MasterScreen';
import { AgentsScreen } from './src/screens/AgentsScreen';
import { WorkspaceScreen } from './src/screens/WorkspaceScreen';
import { BillingScreen } from './src/screens/BillingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

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
    return <View style={{ flex: 1, backgroundColor: '#070b16', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>AKBARAL!</Text></View>;
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  return (
    <NavigationContainer theme={DarkTheme}>
      <StatusBar style="light" />
      <Tab.Navigator screenOptions={{ headerShown: true, tabBarActiveTintColor: '#ffcf5c', tabBarInactiveTintColor: '#7f8fae', tabBarStyle: { backgroundColor: '#0b1124' } }}>
        <Tab.Screen name="Dashboard">{() => <DashboardScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="MASTER" component={MasterScreen} />
        <Tab.Screen name="Agents" component={AgentsScreen} />
        <Tab.Screen name="Workspace" component={WorkspaceScreen} />
        <Tab.Screen name="Billing">{() => <BillingScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="Settings">{() => <SettingsScreen onLogout={async () => { await api.logout(); setUser(null); }} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
