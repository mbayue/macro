import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { QuotaResponse } from '../src/api-types.ts';
import { createApp } from '../src/server.ts';
import type { RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

function fakeController(): RunStarter {
  return { start: () => {}, stop: () => false, isRunning: () => false };
}

function authConfig() {
  return testConfig({
    SESSION_SECRET: 'session-secret-test',
    PUBLIC_BASE_URL: 'https://macro.test',
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'Macro <hello@macro.test>',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_REDIRECT_URI: 'https://macro.test/api/auth/github/callback',
  });
}

describe('GET /api/quota and DELETE /api/me', () => {
  test('GET /api/quota reports remaining planning and daily runs for IP and account', async () => {
    const store = new Store(':memory:');
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(async () => new Response('{}')),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
    });

    store.recordClientStart('unknown', NOW - 200);
    const ipRes = await app.fetch(new Request('http://macro.test/api/quota'));
    expect(ipRes.status).toBe(200);
    const ipQuota = (await ipRes.json()) as QuotaResponse;
    expect(ipQuota.scope).toBe('ip');
    expect(ipQuota.planning.used).toBe(0);
    expect(ipQuota.planning.remaining).toBe(ipQuota.planning.limit);
    expect(ipQuota.dailyRuns.used).toBe(1);
    expect(ipQuota.dailyRuns.limit).toBe(10);
    expect(ipQuota.dailyRuns.remaining).toBe(9);

    const user = store.createUser('quota@example.com', NOW);
    const session = store.createSession(user.id, NOW, 60_000);
    store.recordPlanningRequest(`user:${user.id}`, NOW - 1000);
    store.recordPlanningRequest(`user:${user.id}`, NOW - 500);

    const userRes = await app.fetch(
      new Request('http://macro.test/api/quota', {
        headers: { cookie: `macro_session=${session.id}` },
      }),
    );
    expect(userRes.status).toBe(200);
    const userQuota = (await userRes.json()) as QuotaResponse;
    expect(userQuota.scope).toBe('account');
    expect(userQuota.planning.used).toBe(2);
    expect(userQuota.planning.remaining).toBe(userQuota.planning.limit - 2);
    expect(userQuota.dailyRuns.used).toBe(0);
    expect(userQuota.dailyRuns.limit).toBe(50);
    expect(userQuota.dailyRuns.remaining).toBe(50);
  });

  test('DELETE /api/me requires auth and deletes user + private runs while unlinking public runs', async () => {
    const store = new Store(':memory:');
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(async () => new Response('{}')),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
    });

    const unauth = await app.fetch(new Request('http://macro.test/api/me', { method: 'DELETE' }));
    expect(unauth.status).toBe(401);

    const user = store.createUser('del@example.com', NOW);
    const session = store.createSession(user.id, NOW, 60_000);
    store.putAccountDraft(user.id, {
      trafficEvent: 'Spike test',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: NOW,
    });
    store.createRun({
      id: 'run-priv',
      kind: 'run',
      planHash: null,
      status: 'running',
      runtime: 'runc',
      startedAt: NOW,
      ownerUserId: user.id,
      visibility: 'private',
    });
    store.createRun({
      id: 'run-pub',
      kind: 'run',
      planHash: null,
      status: 'running',
      runtime: 'runc',
      startedAt: NOW,
      ownerUserId: user.id,
      visibility: 'public',
    });

    const delRes = await app.fetch(
      new Request('http://macro.test/api/me', {
        method: 'DELETE',
        headers: { cookie: `macro_session=${session.id}` },
      }),
    );
    expect(delRes.status).toBe(204);
    expect(delRes.headers.get('set-cookie')).toContain('Max-Age=0');

    expect(store.getUser(user.id)).toBeNull();
    expect(store.getSession(session.id)).toBeNull();
    expect(store.getAccountDraft(user.id)).toBeNull();
    expect(store.getRun('run-priv')).toBeNull();
    expect(store.getRun('run-pub')?.ownerUserId).toBeNull();
  });
});
