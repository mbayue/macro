/** Session cookie parse/serialize helpers (pure). */

export const SESSION_COOKIE = 'macro_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseSessionId(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === '') return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== SESSION_COOKIE) continue;
    const value = trimmed.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

function cookieAttrs(extra: string, secure: boolean): string {
  const base = `${SESSION_COOKIE}=${extra}; Path=/; HttpOnly; SameSite=Lax`;
  return secure ? `${base}; Secure` : base;
}

/** `secure` defaults true (HTTPS). Pass false for local http:// PUBLIC_BASE_URL. */
export function serializeSessionCookie(sessionId: string, expiresAt: number, secure = true): string {
  const expires = new Date(expiresAt).toUTCString();
  return cookieAttrs(`${sessionId}; Expires=${expires}`, secure);
}

export function serializeClearSessionCookie(secure = true): string {
  return cookieAttrs('; Max-Age=0', secure);
}
