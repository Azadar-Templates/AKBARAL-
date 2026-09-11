import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, DarkTheme, Theme, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api } from './src/api/client';
import { palette } from './src/theme';
import { BrandMark, useReducedMotion } from './src/components/ui';
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
    primary: palette.accent,
    background: palette.bg,
    card: palette.bg2,
    text: palette.text,
    border: palette.line,
    notification: palette.accent,
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

const makeScreenOptions = (name: string, bottomInset = 0) => ({
  headerShown: true,
  headerStyle: { backgroundColor: 'rgba(8,8,10,0.78)', borderBottomColor: 'rgba(226,226,234,0.09)', borderBottomWidth: StyleSheet.hairlineWidth },
  headerShadowVisible: false,
  headerTitleStyle: { color: palette.text, fontWeight: '800' as const, fontSize: 15, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  headerTintColor: palette.accent,
  tabBarActiveTintColor: palette.accent,
  tabBarInactiveTintColor: palette.textDim,
  tabBarStyle: {
    backgroundColor: 'rgba(8,8,10,0.86)',
    borderTopColor: 'rgba(226,226,234,0.09)',
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 62 + bottomInset,
    paddingBottom: 8 + bottomInset,
    paddingTop: 6,
    elevation: 0,
  },
  tabBarLabelStyle: { fontWeight: '700' as const, fontSize: 10, letterSpacing: 0.6 },
  tabBarIcon: ({ focused }: { focused: boolean }) => (
    <Text style={{ color: focused ? palette.accent : palette.textDim, fontSize: 15, opacity: focused ? 1 : 0.72, textShadowColor: focused ? palette.accent : 'transparent', textShadowRadius: focused ? 10 : 0 }}>{tabIcons[name]}</Text>
  ),
});

/** Premium branded boot screen — the mobile face of the AKBARAL! loading
 * identity (same choreography as the web #boot-veil): monogram, rings,
 * wordmark, tagline and an indeterminate progress sweep. Fades out over
 * the live UI (rendered underneath) so there is no white flash and no
 * layout jump. Honors the OS reduce-motion preference. */
function BootVisual({ reduced }: { reduced: boolean }) {
  const ring1 = React.useRef(new Animated.Value(0)).current;
  const ring2 = React.useRef(new Animated.Value(0)).current;
  const sweep = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (reduced) return;
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 1900, useNativeDriver: true }),
        ]),
      );
    const ringAnim1 = pulse(ring1, 0);
    const ringAnim2 = pulse(ring2, 550);
    ringAnim1.start();
    ringAnim2.start();
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1150, useNativeDriver: true }),
    );
    sweepLoop.start();
    return () => { ringAnim1.stop(); ringAnim2.stop(); sweepLoop.stop(); };
  }, [reduced, ring1, ring2, sweep]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.85, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.3] }) }],
  });

  return (
    <View style={bootStyles.layer}>
      <LinearGradient colors={['rgba(115,120,232,0.16)', 'rgba(8,8,10,0)', 'rgba(151,144,242,0.10)']} locations={[0, 0.55, 1]} style={bootStyles.atmosphere} />
      <View style={bootStyles.core}>
        <Animated.View style={[bootStyles.ring, ringStyle(ring1)]} />
        <Animated.View style={[bootStyles.ring, ringStyle(ring2)]} />
        <BrandMark size={64} />
      </View>
      <Text style={bootStyles.word}>AKBARAL!</Text>
      <Text style={bootStyles.tagline}>ONE INTELLIGENCE · EVERY SOLUTION</Text>
      <View style={bootStyles.line}>
        <Animated.View
          style={{
            width: '38%',
            height: 2,
            borderRadius: 1,
            backgroundColor: palette.accent,
            transform: [{
              translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-70, 190] }),
            }],
          }}
        />
      </View>
    </View>
  );
}

const bootStyles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  atmosphere: { ...StyleSheet.absoluteFillObject },
  core: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: palette.lineAccent },
  word: { color: palette.text, fontSize: 19, fontWeight: '900', letterSpacing: 8, marginTop: 26, paddingLeft: 8 },
  tagline: { color: palette.textFaint, fontSize: 8, fontWeight: '800', letterSpacing: 2.6, marginTop: 8, paddingLeft: 2.6 },
  line: { width: 170, height: 2, backgroundColor: palette.surface2, borderRadius: 1, overflow: 'hidden', marginTop: 26, alignItems: 'flex-start' },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

/** Full app shell — owns all state; lives inside SafeAreaProvider so
 *  useSafeAreaInsets() is legal here (tab bar + headers respect the
 *  Android gesture bar / iOS home indicator). */
function AppShell() {
  const [user, setUser] = useState<{ id: string; email: string; freeCredits: number; role: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [bootGone, setBootGone] = useState(false);
  const bootFade = React.useRef(new Animated.Value(1)).current;
  const bootStart = React.useRef(Date.now()).current;
  const reducedMotion = useReducedMotion();
  const [pushNote, setPushNote] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
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

  // Boot choreography: hold the branded splash for a beat after the app is
  // ready, then crossfade into the live UI (rendered underneath — no jump).
  React.useEffect(() => {
    if (!ready || bootGone) return;
    if (reducedMotion) { setBootGone(true); return; }
    const wait = Math.max(0, 950 - (Date.now() - bootStart));
    const timer = setTimeout(() => {
      Animated.timing(bootFade, { toValue: 0, duration: 480, useNativeDriver: true }).start(() => setBootGone(true));
    }, wait);
    return () => clearTimeout(timer);
  }, [ready, bootGone, reducedMotion, bootFade, bootStart]);

  const handleLogout = async () => {
    await unregisterPushNotifications();
    await api.logout();
    setUser(null);
    setPushNote(null);
  };

  const main = user ? (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <StatusBar style="light" />
      <Tab.Navigator>
        <Tab.Screen name="Dashboard" options={makeScreenOptions('Dashboard', insets.bottom)}>
          {() => (
            <DashboardScreen
              user={user}
              onOpenTask={openTaskById}
              note={pushNote}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="MASTER" options={makeScreenOptions('MASTER', insets.bottom)} component={MasterScreen} />
        <Tab.Screen name="Tasks" options={makeScreenOptions('Tasks', insets.bottom)} component={TasksScreen} />
        <Tab.Screen name="Agents" options={makeScreenOptions('Agents', insets.bottom)} component={AgentsScreen} />
        <Tab.Screen name="Workspace" options={makeScreenOptions('Workspace', insets.bottom)} component={WorkspaceScreen} />
        <Tab.Screen name="Billing" options={makeScreenOptions('Billing', insets.bottom)}>{() => <BillingScreen user={user} />}</Tab.Screen>
        <Tab.Screen name="Settings" options={makeScreenOptions('Settings', insets.bottom)}>{() => <SettingsScreen onLogout={handleLogout} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  ) : (
    <LoginScreen onLogin={setUser} />
  );

  if (!bootGone) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {ready ? main : null}
        <Animated.View style={{ opacity: bootFade }} pointerEvents={ready ? 'none' : 'auto'}>
          <BootVisual reduced={reducedMotion} />
        </Animated.View>
      </View>
    );
  }

  return main;
}
