import { describe, expect, test } from 'bun:test';
import { clientIp, UNKNOWN_IP } from '../src/security/client-ip.ts';
import { MAX_TOKEN_LENGTH, SITEVERIFY_URL, verifyTurnstile } from '../src/security/turnstile.ts';
import { asFetch, hangUntilAborted } from './arb-agents.ts';

const SECRET = 'test-turnstile-secret-9999';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (init: RequestInit) => Promise<Response> | Response): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = asFetch(async (url, init) => {
    seen.push({ url, init });
    return respond(init);
  });
  return { fetchImpl, seen };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('verifyTurnstile: success', () => {
  test('success:true is ok and posts the secret, token, and ip to Siteverify', async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    const r = await verifyTurnstile('tok-123', '203.0.113.9', { secretKey: SECRET, fetchImpl });
    expect(r).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(SITEVERIFY_URL);
    expect(seen[0]?.init.method).toBe('POST');
    const form = seen[0]?.init.body as FormData;
    expect(form.get('secret')).toBe(SECRET);
    expect(form.get('response')).toBe('tok-123');
    expect(form.get('remoteip')).toBe('203.0.113.9');
  });

  test.each([undefined, '', 'unknown'])('remoteip is omitted for %p', async (ip) => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    await verifyTurnstile('tok', ip, { secretKey: SECRET, fetchImpl });
    expect((seen[0]?.init.body as FormData).has('remoteip')).toBe(false);
  });
});

describe('verifyTurnstile: every failure mode returns ok:false and never throws', () => {
  test.each([undefined, ''])('missing token %p makes no request', async (token) => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    expect(await verifyTurnstile(token, '1.2.3.4', { secretKey: SECRET, fetchImpl })).toEqual({ ok: false, reason: 'missing_token' });
    expect(seen).toHaveLength(0);
  });

  test('a non-string token (hostile caller) is treated as missing', async () => {
    const { fetchImpl } = fakeFetch(() => json({ success: true }));
    const r = await verifyTurnstile(42 as unknown as string, undefined, { secretKey: SECRET, fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'missing_token' });
  });

  test('a token over the length cap makes no request; the cap itself is accepted', async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({ success: true }));
    const over = await verifyTurnstile('x'.repeat(MAX_TOKEN_LENGTH + 1), undefined, { secretKey: SECRET, fetchImpl });
    expect(over).toEqual({ ok: false, reason: 'token_too_long' });
    expect(seen).toHaveLength(0);
    const at = await verifyTurnstile('x'.repeat(MAX_TOKEN_LENGTH), undefined, { secretKey: SECRET, fetchImpl });
    expect(at).toEqual({ ok: true });
  });

  test.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }],
    [{}],
    [{ success: 'true' }],
    [{ success: 1 }],
    [[]],
  ])('Siteverify answer %j is rejected', async (body) => {
    const { fetchImpl } = fakeFetch(() => json(body));
    expect(await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl })).toEqual({ ok: false, reason: 'rejected' });
  });

  test.each([301, 400, 403, 429, 500, 503])('HTTP %i is http_error', async (status) => {
    const { fetchImpl } = fakeFetch(() => new Response('{"success":true}', { status }));
    expect(await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl })).toEqual({ ok: false, reason: 'http_error' });
  });

  test.each(['not json', '', '"a string"', 'null', '42'])('unreadable or non-object body %p is bad_response', async (text) => {
    const { fetchImpl } = fakeFetch(() => new Response(text, { status: 200 }));
    expect(await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl })).toEqual({ ok: false, reason: 'bad_response' });
  });

  test.each([new TypeError('fetch failed'), new Error('ECONNRESET'), 'a thrown string', undefined, 7])(
    'a transport error (%p) is network_error',
    async (thrown) => {
      const { fetchImpl } = fakeFetch(() => Promise.reject(thrown));
      expect(await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl })).toEqual({ ok: false, reason: 'network_error' });
    },
  );

  test('no answer within the timeout is timeout', async () => {
    const { fetchImpl } = fakeFetch((init) => hangUntilAborted(init));
    const started = Date.now();
    const r = await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl, timeoutMs: 30 });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a body that stalls past the timeout is timeout', async () => {
    const { fetchImpl } = fakeFetch((init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(stream, { status: 200 });
    });
    const r = await verifyTurnstile('t', undefined, { secretKey: SECRET, fetchImpl, timeoutMs: 30 });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });

  test('failure results never contain the secret or the token', async () => {
    const { fetchImpl } = fakeFetch(() => Promise.reject(new Error(`boom ${SECRET}`)));
    const r = await verifyTurnstile('tok-visible', undefined, { secretKey: SECRET, fetchImpl });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain('tok-visible');
  });
});

describe('clientIp: only CF-Connecting-IP', () => {
  const req = (headers: Record<string, string>): Request => new Request('https://macro.my.id/api/plan', { headers });

  test('returns the CF-Connecting-IP address', () => {
    expect(clientIp(req({ 'CF-Connecting-IP': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(req({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(req({ 'cf-connecting-ip': '  198.51.100.4  ' }))).toBe('198.51.100.4');
  });

  test('ignores the socket address argument', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7' }), '10.0.0.1')).toBe('203.0.113.7');
    expect(clientIp(req({}), '10.0.0.1')).toBe(UNKNOWN_IP);
  });

  test('ignores X-Forwarded-For, X-Real-IP, and Forwarded', () => {
    const headers = { 'x-forwarded-for': '6.6.6.6, 7.7.7.7', 'x-real-ip': '8.8.8.8', forwarded: 'for=9.9.9.9' };
    expect(clientIp(req(headers))).toBe(UNKNOWN_IP);
    expect(clientIp(req({ ...headers, 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  test.each(['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3.4, 5.6.7.8', '1.2.3.4:80'])('invalid header %p yields unknown', (value) => {
    expect(clientIp(req({ 'cf-connecting-ip': value }))).toBe(UNKNOWN_IP);
  });
});
