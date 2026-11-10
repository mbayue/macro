import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, MeResponse, PlanResponse } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, samplePlan, testConfig, toolCallOf } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

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

async function signIn(app: App, mailerSent: { url: string }[]): Promise<string> {
  await app.fetch(
    new Request('http://macro.test/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    }),
  );
  const token = new URL(mailerSent[0]!.url).searchParams.get('token')!;
  const consume = await app.fetch(
    new Request(`http://macro.test/api/auth/magic-link/consume?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    }),
  );
  const setCookie = consume.headers.get('set-cookie') ?? '';
  const session = setCookie.split(';')[0] ?? '';
  expect(session.startsWith('macro_session=')).toBe(true);
  return session;
}

describe('session gate', () => {
  test('signed-in plan skips Turnstile and records planning under user subject', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    let turnstileCalls = 0;
    const config = authConfig();
    const plan = samplePlan();
    const app = createApp({
      store,
      config,
      verifyTurnstile: () => {
        turnstileCalls++;
        return Promise.resolve({ ok: false });
      },
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() =>
          Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan, rationale: 'ok' })])),
        ),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
    });

    const cookie = await signIn(app, sent);
    turnstileCalls = 0;
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          trafficEvent: 'A new banner drops tonight with five hundred visitors opening the store.',
          turnstileToken: 'ignored',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(turnstileCalls).toBe(0);
    const body = (await res.json()) as PlanResponse;
    expect(body.plan).not.toBeNull();

    const user = store.findUserByEmail('a@example.com');
    expect(user).not.toBeNull();
    const subject = `user:${user!.id}`;
    const stamps = store.planningRequestTimestamps(subject, NOW - 3_600_000);
    expect(stamps.length).toBeGreaterThanOrEqual(1);
  });

  test('signed-out plan still requires Turnstile', async () => {
    const store = new Store(':memory:');
    const config = authConfig();
    const app = createApp({
      store,
      config,
      verifyTurnstile: () => Promise.resolve({ ok: false }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() => Promise.reject(new Error('no'))),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
    });
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trafficEvent: 'A new banner drops tonight with five hundred visitors opening the store.',
          turnstileToken: 'bad',
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('turnstile_failed');
  });

  test('sign-out clears cookie and /api/me becomes 401', async () => {
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
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() => Promise.reject(new Error('no'))),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
    });
    const cookie = await signIn(app, sent);
    const meOk = await app.fetch(new Request('http://macro.test/api/me', { headers: { cookie } }));
    expect(meOk.status).toBe(200);
    const me = (await meOk.json()) as MeResponse;
    expect(me.user.email).toBe('a@example.com');

    const out = await app.fetch(
      new Request('http://macro.test/api/auth/sign-out', { method: 'POST', headers: { cookie } }),
    );
    expect([200, 204]).toContain(out.status);
    const clear = out.headers.get('set-cookie') ?? '';
    expect(clear).toContain('macro_session=');
    expect(clear).toContain('Max-Age=0');

    const meGone = await app.fetch(new Request('http://macro.test/api/me', { headers: { cookie } }));
    expect(meGone.status).toBe(401);
  });
});
