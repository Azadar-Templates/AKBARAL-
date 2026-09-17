import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const extraBase = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? extraBase ?? 'https://api.akbaral.ai';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name?: string; freeCredits: number; role: string };
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async init(): Promise<void> {
    this.accessToken = await AsyncStorage.getItem('ak_access');
    this.refreshToken = await AsyncStorage.getItem('ak_refresh');
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const body = await this.request('/api/auth/login', { method: 'POST', body: { email, password } });
    this.accessToken = body.accessToken;
    this.refreshToken = body.refreshToken;
    await AsyncStorage.setItem('ak_access', body.accessToken);
    await AsyncStorage.setItem('ak_refresh', body.refreshToken);
    return body;
  }

  async register(email: string, password: string, name?: string): Promise<void> {
    await this.request('/api/auth/register', { method: 'POST', body: { email, password, name: name || undefined } });
  }

  async logout(): Promise<void> {
    if (this.refreshToken) {
      await this.request('/api/auth/logout', { method: 'POST', body: { refresh_token: this.refreshToken } }).catch(() => null);
    }
    this.accessToken = null;
    this.refreshToken = null;
    await AsyncStorage.multiRemove(['ak_access', 'ak_refresh']);
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    if (!response.ok) return false;
    const body = await response.json();
    this.accessToken = body.accessToken;
    this.refreshToken = body.refreshToken;
    await AsyncStorage.multiSet([['ak_access', body.accessToken], ['ak_refresh', body.refreshToken]]);
    return true;
  }

  async request<T = any>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request(path, options);
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    }
    return data;
  }

  get(path: string) {
    return this.request(path);
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: 'POST', body });
  }

  del(path: string) {
    return this.request(path, { method: 'DELETE' });
  }

  patch(path: string, body: unknown) {
    return this.request(path, { method: 'PATCH', body });
  }

  /** Absolute URL for a path — used by transports that cannot use request()
   * (e.g. the SSE live-log subscription, which needs ?token= auth). */
  url(path: string): string {
    return `${BASE_URL}${path}`;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
}

export const api = new ApiClient();
