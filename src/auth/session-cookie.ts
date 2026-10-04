export const AUTH_SESSION_COOKIE = 'akbaral_session';

/** The same browser session cookie is used by password and OAuth sign-in. */
export function serializeAuthSession(token: string, maxAgeSeconds = 60 * 60): string {
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearAuthSession(): string {
  return `${AUTH_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function readAuthSessionCookie(header: string | undefined): string {
  const item = (header ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`));
  if (!item) return '';
  return decodeURIComponent(item.slice(AUTH_SESSION_COOKIE.length + 1));
}
