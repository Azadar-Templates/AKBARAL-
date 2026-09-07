import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../api/client';

export function LoginScreen({ onLogin }: { onLogin: (user: { id: string; email: string; freeCredits: number; role: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [name, setName] = useState('');

  const submit = async () => {
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
    }
  };

  return (
    <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>AKBARAL!</Text>
        <Text style={styles.subtitle}>Master AI Operating Platform</Text>
        <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
        {registerMode && <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />}
        <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
        <TouchableOpacity style={styles.button} onPress={submit}>
          <Text style={styles.buttonText}>{registerMode ? 'Create account' : 'Sign in'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setRegisterMode((value) => !value)}>
          <Text style={styles.link}>{registerMode ? 'Already have an account? Sign in' : 'No account? Create one'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#070b16', alignItems: 'center', justifyContent: 'center' },
  card: { width: '90%', maxWidth: 420, padding: 22, borderRadius: 16, backgroundColor: '#0b1124' },
  title: { color: '#ffcf5c', fontSize: 30, fontWeight: '800' },
  subtitle: { color: '#93a5c9', marginBottom: 18 },
  input: { backgroundColor: '#101b38', color: '#eaf0ff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#29406b', marginBottom: 10 },
  button: { backgroundColor: '#ffcf5c', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  buttonText: { color: '#231200', fontWeight: '800' },
  link: { color: '#32d6ff', textAlign: 'center', marginTop: 14 },
});
