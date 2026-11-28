import { describe, expect, test } from 'bun:test';
import { isBlockedIp } from '../proxy/ip.ts';
import { InferenceClient } from '../src/agents/inference.ts';
import { fetchDomainConnectSettings } from '../src/auth/domain-connect.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { checkWellKnown } from '../src/auth/verify-origin.ts';
import { isDenylistedHost } from '../src/plan/policy.ts';
import { isPublicHost } from '../src/security/public-host.ts';
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

  test('SSE /api/runs/:id/events pushes new events immediately without waiting for pollMs', async () => {
    const store = new Store(':memory:');
    const now = Date.now();
    store.storeApprovedPlan({ hash: 'e'.repeat(64), text: JSON.stringify(samplePlan()), approvedAt: now });
    store.createRun({
      id: 'run-sse-push-1',
      kind: 'run',
      planHash: 'e'.repeat(64),
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
      runController: fakeController('run-sse-push-1'),
      probeController: fakeController(),
      sse: { pollMs: 60_000, heartbeatMs: 60_000 },
    });

    const res = await app.fetch(new Request('http://macro.test/api/runs/run-sse-push-1/events'));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    // First chunk is the retry directive.
    const first = await reader.read();
    expect(dec.decode(first.value)).toContain('retry: 3000');

    // Append an event and assert it arrives immediately (< 500ms, well below pollMs: 60_000).
    const nextRead = reader.read();
    store.appendEvent({ runId: 'run-sse-push-1', type: 'stage_start', stageIdx: 0, payload: { stageIdx: 0 }, ts: now });
    const second = await Promise.race([
      nextRead,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE push timed out')), 500)),
    ]);
    expect(dec.decode(second.value)).toContain('event: stage_start');

    await reader.cancel();
    store.close();
  });

  test('POST /api/runs/:id/stop requires Turnstile for anonymous viewers of public runs', async () => {
    const store = new Store(':memory:');
    const now = Date.now();
    store.storeApprovedPlan({ hash: 'f'.repeat(64), text: JSON.stringify(samplePlan()), approvedAt: now });
    store.createRun({
      id: 'run-stop-gate-1',
      kind: 'run',
      planHash: 'f'.repeat(64),
      runtime: 'runc',
      startedAt: now,
      status: 'running',
      visibility: 'public',
    });
    const verifyTurnstile = async (token: unknown) => ({ ok: token === 'good-token' });
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile,
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: fakeController('run-stop-gate-1'),
      probeController: fakeController(),
    });
    const deny = await app.fetch(
      new Request('http://macro.test/api/runs/run-stop-gate-1/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(deny.status).toBe(403);
    const allow = await app.fetch(
      new Request('http://macro.test/api/runs/run-stop-gate-1/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.50' },
        body: JSON.stringify({ turnstileToken: 'good-token' }),
      }),
    );
    expect(allow.status).toBe(200);
    store.close();
  });

  test('fetchDomainConnectSettings and isPublicHost block hosts resolving to private or metadata IPs', async () => {
    let dcFetched = false;
    const dcRes = await fetchDomainConnectSettings(
      'dc.attacker.example',
      'example.com',
      async () => {
        dcFetched = true;
        return new Response('{}', { status: 200 });
      },
      async () => [{ address: '169.254.169.254' }],
    );
    expect(dcRes).toBeNull();
    expect(dcFetched).toBe(false);

    expect(await isPublicHost('rebind.attacker.example', async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }])).toBe(false);
    expect(await isPublicHost('mapped.attacker.example', async () => [{ address: '::ffff:127.0.0.1' }])).toBe(false);
    expect(await isPublicHost('public.example', async () => [{ address: '93.184.216.34' }])).toBe(true);
  });

  test('checkWellKnown blocks hosts resolving to private or loopback IPs and sets a timeout signal', async () => {
    let fetched = false;
    const blocked = await checkWellKnown(
      'https://rebind.attacker.example',
      'tok',
      async () => {
        fetched = true;
        return new Response('tok', { status: 200 });
      },
      async () => [{ address: '127.0.0.1' }],
    );
    expect(blocked).toBe(false);
    expect(fetched).toBe(false);

    let sawSignal = false;
    const allowed = await checkWellKnown(
      'https://public.example',
      'tok',
      async (_url, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        return new Response('tok', { status: 200 });
      },
      async () => [{ address: '93.184.216.34' }],
    );
    expect(allowed).toBe(true);
    expect(sawSignal).toBe(true);
  });

  test('fetchDomainConnectSettings rejects non-https or userinfo urlSyncUX values', async () => {
    for (const badUrl of [
      'http://insecure.example/connect',
      'javascript:alert(1)//',
      'data:text/html,hi',
      'https://user:pass@dc.example/connect',
      'not-a-url',
    ]) {
      const res = await fetchDomainConnectSettings(
        'dc.example',
        'example.com',
        async () =>
          new Response(
            JSON.stringify({
              providerId: 'example',
              providerName: 'Example DNS',
              urlSyncUX: badUrl,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );
      expect(res).toBeNull();
    }
  });

  test('POST /api/runs rejects anonymous or non-owner reruns of own-site plans without creating a run', async () => {
    const store = new Store(':memory:');
    const now = Date.now();
    const owner = store.createUser('owner@example.com', now);
    const other = store.createUser('other@example.com', now);
    store.setVerifiedOrigin(owner.id, 'https://mysite.example', 'mysite.example', 'tok-owner', now);

    const ownerSession = store.createSession(owner.id, now, 60_000);
    const otherSession = store.createSession(other.id, now, 60_000);

    const ownPlanHash = 'a'.repeat(64);
    store.storeApprovedPlan({
      hash: ownPlanHash,
      text: JSON.stringify({ ...samplePlan(), name: 'Secret Own Plan', target: 'https://mysite.example' }),
      approvedAt: now,
    });
    store.storePlanTarget({
      planHash: ownPlanHash,
      webOrigin: 'https://mysite.example',
      apiOrigin: 'https://mysite.example',
      routes: [{ id: 'home', method: 'GET', path: '/', kind: 'page', defaultOn: true }],
    });

    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: fakeController(),
      probeController: fakeController(),
    });

    // Anonymous caller is rejected with 404 and no run is created.
    const anonRes = await app.fetch(
      new Request('http://macro.test/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.60' },
        body: JSON.stringify({ planHash: ownPlanHash, turnstileToken: 't' }),
      }),
    );
    expect(anonRes.status).toBe(404);
    expect(store.listRunsForPlan(ownPlanHash, 10)).toHaveLength(0);

    // Signed-in non-owner is also rejected with 404 and no run is created.
    const otherRes = await app.fetch(
      new Request('http://macro.test/api/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `macro_session=${otherSession.id}`,
        },
        body: JSON.stringify({ planHash: ownPlanHash }),
      }),
    );
    expect(otherRes.status).toBe(404);
    expect(store.listRunsForPlan(ownPlanHash, 10)).toHaveLength(0);

    // Verified owner is admitted as a private run.
    const ownerRes = await app.fetch(
      new Request('http://macro.test/api/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `macro_session=${ownerSession.id}`,
        },
        body: JSON.stringify({ planHash: ownPlanHash }),
      }),
    );
    expect(ownerRes.status).toBe(200);
    const runs = store.listRunsForPlan(ownPlanHash, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.visibility).toBe('private');
    expect(runs[0]?.ownerUserId).toBe(owner.id);

    store.close();
  });

  test('DELETE /api/me preserves recent quota history across account delete and recreate', async () => {
    const store = new Store(':memory:');
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    const user1 = store.createUser('loop@example.com', now);
    for (let i = 0; i < 10; i++) {
      store.recordPlanningRequest(`user:${user1.id}`, now - (10 - i) * 1000);
    }
    store.recordClientStart(`user:${user1.id}`, now - 500);

    expect(store.deleteUser(user1.id)).toBe(true);
    // Old user:<id> rows are gone, carried under a hashed non-PII key until recreated.
    expect(store.planningRequestTimestamps(`user:${user1.id}`, now - 3_600_000)).toHaveLength(0);

    const user2 = store.createUser('loop@example.com', now + 1000);
    expect(user2.id).not.toBe(user1.id);
    expect(store.planningRequestTimestamps(`user:${user2.id}`, now - 3_600_000)).toHaveLength(10);
    expect(store.clientStartTimestamps(`user:${user2.id}`, now - 3_600_000)).toHaveLength(1);
    store.close();
  });

  test('DELETE /api/me stops active private runs before deleting user rows', async () => {
    const store = new Store(':memory:');
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    const user = store.createUser('active@example.com', now);
    const session = store.createSession(user.id, now, 60_000);
    store.createRun({
      id: 'priv-active-1',
      kind: 'run',
      planHash: null,
      status: 'running',
      runtime: 'runc',
      startedAt: now,
      ownerUserId: user.id,
      visibility: 'private',
    });

    const stopped: string[] = [];
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: {
        start: () => {},
        stop: (id) => {
          stopped.push(id);
          return true;
        },
        isRunning: (id) => id === 'priv-active-1',
      },
      probeController: fakeController(),
      now: () => now,
      log: () => {},
    });

    const res = await app.fetch(
      new Request('http://macro.test/api/me', {
        method: 'DELETE',
        headers: { cookie: `macro_session=${session.id}` },
      }),
    );
    expect(res.status).toBe(204);
    expect(stopped).toEqual(['priv-active-1']);
    expect(store.getRun('priv-active-1')).toBeNull();
    store.close();
  });

  test('POST /api/runs/:id/stop rejects non-owners for owned public runs while allowing the owner', async () => {
    const store = new Store(':memory:');
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    const owner = store.createUser('pub-owner@example.com', now);
    const other = store.createUser('pub-other@example.com', now);
    const ownerSession = store.createSession(owner.id, now, 60_000);
    const otherSession = store.createSession(other.id, now, 60_000);
    store.createRun({
      id: 'owned-pub-1',
      kind: 'run',
      planHash: null,
      status: 'running',
      runtime: 'runc',
      startedAt: now,
      ownerUserId: owner.id,
      visibility: 'public',
    });

    const stopped: string[] = [];
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(async () => new Response('{}')) }),
      runController: {
        start: () => {},
        stop: (id) => {
          stopped.push(id);
          return true;
        },
        isRunning: (id) => id === 'owned-pub-1',
      },
      probeController: fakeController(),
      now: () => now,
      log: () => {},
    });

    // Signed-in non-owner cannot stop another user's owned public run.
    const otherRes = await app.fetch(
      new Request('http://macro.test/api/runs/owned-pub-1/stop', {
        method: 'POST',
        headers: { cookie: `macro_session=${otherSession.id}` },
      }),
    );
    expect(otherRes.status).toBe(404);
    expect(stopped).toEqual([]);

    // Anonymous caller (even with valid Turnstile) cannot stop an owned public run.
    const anonRes = await app.fetch(
      new Request('http://macro.test/api/runs/owned-pub-1/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken: 'valid' }),
      }),
    );
    expect(anonRes.status).toBe(404);
    expect(stopped).toEqual([]);

    // Owner can stop their own public run.
    const ownerRes = await app.fetch(
      new Request('http://macro.test/api/runs/owned-pub-1/stop', {
        method: 'POST',
        headers: { cookie: `macro_session=${ownerSession.id}` },
      }),
    );
    expect(ownerRes.status).toBe(200);
    expect(stopped).toEqual(['owned-pub-1']);
    store.close();
  });

  test('fetchDomainConnectSettings rejects oversized (>64 KiB) responses and purgeOldLimitRows purges old drafts', async () => {
    const big = JSON.stringify({
      providerId: 'big',
      providerName: 'Big',
      urlSyncUX: 'https://dc.example/connect',
      pad: 'x'.repeat(70 * 1024),
    });
    const res = await fetchDomainConnectSettings(
      'dc.example',
      'example.com',
      async () => new Response(big, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(res).toBeNull();

    const store = new Store(':memory:');
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    store.createDraft({ id: 'old-draft', trafficEvent: '', createdAt: now - 48 * 3_600_000 });
    store.createDraft({ id: 'fresh-draft', trafficEvent: '', createdAt: now - 60_000 });
    expect(store.purgeOldLimitRows(now)).toBe(1);
    expect(store.getDraft('old-draft')).toBeNull();
    expect(store.getDraft('fresh-draft')).not.toBeNull();
    store.close();
  });

  test('verified_origins expires after 90 days and allows a new verified owner to take over', () => {
    const store = new Store(':memory:');
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const userA = store.createUser('a@example.com', t0);
    const userB = store.createUser('b@example.com', t0);
    store.setVerifiedOrigin(userA.id, 'https://transfer.example', 'transfer.example', 'tok-a', t0);

    // Still active at day 89.
    const day89 = t0 + 89 * 24 * 3_600_000;
    expect(store.getVerifiedOrigin(userA.id, day89)?.host).toBe('transfer.example');

    // Expired at day 91: userA loses access and userB can claim it.
    const day91 = t0 + 91 * 24 * 3_600_000;
    expect(store.getVerifiedOrigin(userA.id, day91)).toBeNull();
    store.setVerifiedOrigin(userB.id, 'https://transfer.example', 'transfer.example', 'tok-b', day91);
    expect(store.getVerifiedOrigin(userB.id, day91)?.host).toBe('transfer.example');
    expect(store.getVerifiedOrigin(userA.id)).toBeNull();
    store.close();
  });
});
