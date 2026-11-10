import { describe, expect, test } from 'bun:test';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  parseSessionId,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from '../src/auth/session.ts';

describe('session cookie helpers', () => {
  test('parseSessionId reads macro_session from Cookie header', () => {
    expect(SESSION_COOKIE).toBe('macro_session');
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseSessionId('macro_session=abc-123; other=1')).toBe('abc-123');
    expect(parseSessionId('other=1; macro_session=xyz')).toBe('xyz');
    expect(parseSessionId(null)).toBeNull();
    expect(parseSessionId('')).toBeNull();
    expect(parseSessionId('other=1')).toBeNull();
  });

  test('serializeSessionCookie includes HttpOnly Secure SameSite=Lax Path=/', () => {
    const cookie = serializeSessionCookie('sid-1', 1_700_000_000_000);
    expect(cookie.startsWith('macro_session=sid-1;')).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Expires=');
  });

  test('serializeClearSessionCookie clears the session cookie', () => {
    const cookie = serializeClearSessionCookie();
    expect(cookie.startsWith('macro_session=;')).toBe(true);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });
});
