import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, DarkTheme, Theme, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api } from './src/api/client';
import { palette } from './src/theme';
import { automationIdFromDeepLink, registerForPushNotifications, taskIdFromDeepLink, unregisterPushNotifications } from './src/services/push';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { MasterScreen } from './src/screens/MasterScreen';
import { TasksScreen } from './src/screens/TasksScreen';
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

/** Deep links: akbaral://tasks/:id (react-navigation config). The
 * akbaral://automations/:id scheme is handled manually below because the
 * Tasks tab hosts both surfaces. */
const linking = {
  prefixes: ['akbaral://', 'https://akbaral.ai'],
  config: {
    screens: {
      Tasks: 'tasks/:taskId?',
    },
  },
};

const tabIcons: Record<string, string> = {
  Dashboard: '▣',
  MASTER: '◉',
  Tasks: '◍',
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
  const [pushNote, setPushNote] = useState<string | null>(null);
  const navigationRef = useNavigationContainerRef<{ Tasks: { taskId?: string; automationId?: string; viewAutomations?: boolean } | undefined }>();

  const openTaskById = (taskId: string) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Tasks', { taskId });
    }
  };

  const openAutomationById = (automationId: string) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Tasks', { automationId });
    }
  };

  const routeDeepLink = (url: string) => {
    const taskId = taskIdFromDeepLink(url);
    if (taskId) {
      openTaskById(taskId);
      return;
    }
    const automationId = automationIdFromDeepLink(url);
    if (automationId) {
      openAutomationById(automationId);
    }
  };

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

  // Register the device for push after login. Registration failures are shown
  // honestly (reason on the dashboard) — never silently faked.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const result = await registerForPushNotifications();
      if (cancelled) return;
      setPushNote(result.ok ? null : `Push disabled: ${result.reason}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tapping a task notification deep-links into the task detail.
  // Cold-start and in-app akbaral:// links (notification taps also route
  // through the response listeners below).
  useEffect(() => {
    let initialUrl: string | null = null;
    Linking.getInitialURL()
      .then((url) => {
        initialUrl = url;
        if (url) routeDeepLink(url);
      })
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => routeDeepLink(url));
    return () => subscription.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const response = lastNotificationResponse;
    if (response) {
      routeDeepLink(String(response.notification.request.content.data?.deepLink ?? ''));
    }
  }, [lastNotificationResponse]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      routeDeepLink(String(response.notification.request.content.data?.deepLink ?? ''));
    });
    return () => subscription.remove();
  }, []);

  const handleLogout = async () => {
    await unregisterPushNotifications();
    await api.logout();
    setUser(null);
    setPushNote(null);
  };

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
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <StatusBar style="light" />
      <Tab.Navigator>
        <Tab.Screen name="Dashboard" options={makeScreenOptions('Dashboard')}>
          {() => (
            <DashboardScreen
              user={user}
              onOpenTask={openTaskById}
              note={pushNote}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="MASTER" options={makeScreenOptions('MASTER')} component={MasterScreen} />
        <Tab.Screen name="Tasks" options={makeScreenOptions('Tasks')} component={TasksScreen} />
        <Tab.Screen name="Agents" options={makeScreenOptions('Agents')} component={AgentsScreen} />
        <Tab.Screen name="Workspace" options={makeScreenOptions('Workspace')} component={WorkspaceScreen} />
        <Tab.Screen name="Billing" options={makeScreenOptions('Billing')}>{() => <BillingScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="Settings" options={makeScreenOptions('Settings')}>{() => <SettingsScreen onLogout={handleLogout} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
