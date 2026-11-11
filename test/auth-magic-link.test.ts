import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

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

interface Harness {
  store: Store;
  app: App;
  sent: { to: string; url: string }[];
  mailer: ResendMailer;
  clock: { now: number };
}

function makeHarness(withAuth: boolean): Harness {
  const store = new Store(':memory:');
  const sent: { to: string; url: string }[] = [];
  const mailer: ResendMailer = {
    sendMagicLink: async (input) => {
      sent.push(input);
      return { ok: true };
    },
  };
  const clock = { now: NOW };
  const config = withAuth ? authConfig() : testConfig();
  const app = createApp({
    store,
    config,
    verifyTurnstile: () => Promise.resolve({ ok: true }),
    client: new InferenceClient({
      config: config.inference,
      store,
      fetchImpl: asFetch(() => Promise.reject(new Error('no network'))),
    }),
    runController: fakeController(),
    probeController: fakeController(),
    now: () => clock.now,
    log: () => {},
    mailer,
  });
  return { store, app, sent, mailer, clock };
}

describe('POST /api/auth/magic-link', () => {
  test('auth unset returns 503', async () => {
    const h = makeHarness(false);
    const res = await h.app.fetch(
      new Request('http://macro.test/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('auth_unavailable');
  });

  test('invalid email returns 400', async () => {
    const h = makeHarness(true);
    const res = await h.app.fetch(
      new Request('http://macro.test/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('consume creates session cookie and cannot be reused', async () => {
    const h = makeHarness(true);
    const post = await h.app.fetch(
      new Request('http://macro.test/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe('a@example.com');
    const url = new URL(h.sent[0]!.url);
    expect(url.pathname).toBe('/api/auth/magic-link/consume');
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    const consume = await h.app.fetch(new Request(url.toString(), { method: 'GET', redirect: 'manual' }));
    expect(consume.status).toBe(303);
    const setCookie = consume.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('macro_session=');
    expect(consume.headers.get('location')).toBe('/app/#/');

    const again = await h.app.fetch(new Request(url.toString(), { method: 'GET', redirect: 'manual' }));
    expect([400, 401]).toContain(again.status);
    const againCookie = again.headers.get('set-cookie');
    expect(againCookie === null || !againCookie.includes('macro_session=') || againCookie.includes('Max-Age=0')).toBe(
      true,
    );
  });


  test('the fourth send to the same address is refused and no further mail is sent', async () => {
    const h = makeHarness(true);
    const post = (email: string) =>
      h.app.fetch(
        new Request('http://macro.test/api/auth/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }),
      );
    for (let i = 0; i < 3; i++) {
      const res = await post('a@example.com');
      expect(res.status).toBe(200);
    }
    const blocked = await post('a@example.com');
    expect(blocked.status).toBe(429);
    expect(h.sent).toHaveLength(3);
    const other = await post('b@example.com');
    expect(other.status).toBe(200);
    expect(h.sent).toHaveLength(4);
  });
  });
