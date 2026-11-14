import { describe, expect, test } from 'bun:test';
import { isBlockedIp } from '../proxy/ip.ts';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { checkWellKnown } from '../src/auth/verify-origin.ts';
import { isDenylistedHost } from '../src/plan/policy.ts';
import { createApp } from '../src/server.ts';
import type { RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

function fakeController(activeId?: string): RunStarter {
  return { start: () => {}, stop: () => false, isRunning: (id) => id === activeId };
}

function authConfig() {
  return testConfig({
    SESSION_SECRET: 'session-secret-test-security-fixes',
    PUBLIC_BASE_URL: 'https://macro.test',
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'Macro <hello@macro.test>',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_REDIRECT_URI: 'https://macro.test/api/auth/github/callback',
  });
}

describe('security fixes regression', () => {
  test('magic-link consume rejects control characters (including tab) in returnTo', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const config = authConfig();
    const app = createApp({
      store,
      config,
      mailer,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: fakeController(),
      probeController: fakeController(),
    });

    await app.fetch(
      new Request('http://macro.test/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    );
    const token = new URL(sent[0]!.url).searchParams.get('token')!;
    const res = await app.fetch(
      new Request(
        `http://macro.test/api/auth/magic-link/consume?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent('/\t/evil.com')}`,
        { redirect: 'manual' },
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/app/#/');
    store.close();
  });

  test('SSE /api/runs/:id/events enforces per-IP concurrency limit and releases slots on cancel', async () => {
    const store = new Store(':memory:');
    const now = Date.now();
    store.storeApprovedPlan({ hash: 'd'.repeat(64), text: JSON.stringify(samplePlan()), approvedAt: now });
    store.createRun({
      id: 'run-sse-cap-1',
      kind: 'run',
      planHash: 'd'.repeat(64),
      runtime: 'runc',
      startedAt: now,
      visibility: 'public',
    });

    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: fakeController('run-sse-cap-1'),
      probeController: fakeController(),
      sse: { maxPerIp: 2, maxTotal: 4, pollMs: 1000, heartbeatMs: 2000 },
    });

    const r1 = await app.fetch(
      new Request('http://macro.test/api/runs/run-sse-cap-1/events', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
    );
    const r2 = await app.fetch(
      new Request('http://macro.test/api/runs/run-sse-cap-1/events', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
    );
    const r3 = await app.fetch(
      new Request('http://macro.test/api/runs/run-sse-cap-1/events', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
    );

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);

    await r1.body?.cancel();
    const r4 = await app.fetch(
      new Request('http://macro.test/api/runs/run-sse-cap-1/events', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
    );
    expect(r4.status).toBe(200);

    await r2.body?.cancel();
    await r4.body?.cancel();
    store.close();
  });

  test('isBlockedIp blocks 2002::/16, 64:ff9b:1::/48, and 100::/64', () => {
    expect(isBlockedIp('2002:c000:0204::1')).toBe(true);
    expect(isBlockedIp('64:ff9b:1::1')).toBe(true);
    expect(isBlockedIp('100::1')).toBe(true);
  });

  test('isDenylistedHost blocks localhost, .local, and .internal while allowing yue.macro.my.id', () => {
    expect(isDenylistedHost('localhost')).toBe(true);
    expect(isDenylistedHost('sub.localhost')).toBe(true);
    expect(isDenylistedHost('printer.local')).toBe(true);
    expect(isDenylistedHost('metadata.internal')).toBe(true);
    expect(isDenylistedHost('yue.macro.my.id')).toBe(false);
  });

  test('checkWellKnown rejects oversized responses without reading unbounded bodies', async () => {
    const big = 'a'.repeat(5000);
    const ok = await checkWellKnown('https://example.com', 'tok', async () => new Response(big, { status: 200 }));
    expect(ok).toBe(false);
  });
});
