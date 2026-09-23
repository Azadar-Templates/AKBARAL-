/**
 * Diagnostic text only: never use this value to connect. PostgreSQL secrets
 * may occur in userinfo OR query parameters, so masking only `user:pass@` is
 * insufficient. Keep only scheme, host/port and database path; omit fragments
 * and every query parameter (including future token/auth parameter names).
 */
export function displayDatabaseTarget(value: string): string {
  const input = value.trim();
  if (!/^postgres(?:ql)?:/i.test(input)) return value;
  try {
    const url = new URL(input);
    if (!url.host) return '[redacted PostgreSQL target]';
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    // Parsing failure must never fall back to echoing the secret-bearing URL.
    return '[redacted PostgreSQL target]';
  }
}
