import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.muted}>Session, notifications, credits and subscription are managed securely by the AKBARAL backend.</Text>
      <TouchableOpacity style={styles.button} onPress={onLogout}><Text style={styles.buttonText}>Log out</Text></TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b16', padding: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  muted: { color: '#93a5c9', marginVertical: 12 },
  button: { backgroundColor: 'rgba(255,92,114,0.16)', padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,92,114,0.4)' },
  buttonText: { color: '#ff5c72', fontWeight: '800' },
});
