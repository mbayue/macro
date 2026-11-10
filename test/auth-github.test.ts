import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

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

function makeApp(fetchImpl: typeof fetch): { app: App; store: Store } {
  const store = new Store(':memory:');
  const config = authConfig();
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
    now: () => Date.UTC(2026, 0, 15, 12, 0, 0),
    log: () => {},
    githubFetch: fetchImpl,
  });
  return { app, store };
}

describe('GitHub OAuth', () => {
  test('start redirects to GitHub with state cookie', async () => {
    const { app } = makeApp(asFetch(() => Promise.reject(new Error('unused'))));
    const res = await app.fetch(new Request('http://macro.test/api/auth/github/start', { redirect: 'manual' }));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith('https://github.com/login/oauth/authorize?')).toBe(true);
    expect(loc).toContain('client_id=gh-id');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('macro_oauth_state=');
  });

  test('callback with verified email sets session', async () => {
    const fetchImpl = asFetch(async (url) => {
      const u = String(url);
      if (u.includes('access_token')) {
        return new Response(JSON.stringify({ access_token: 'tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/user')) {
        return new Response(JSON.stringify({ id: 42, login: 'octo' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/user/emails')) {
        return new Response(
          JSON.stringify([{ email: 'octo@example.com', primary: true, verified: true }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('no', { status: 404 });
    });
    const { app, store } = makeApp(fetchImpl);
    const start = await app.fetch(new Request('http://macro.test/api/auth/github/start', { redirect: 'manual' }));
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cb = await app.fetch(
      new Request(`http://macro.test/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
        headers: { cookie: stateCookie },
        redirect: 'manual',
      }),
    );
    expect(cb.status).toBe(303);
    expect(cb.headers.get('set-cookie') ?? '').toContain('macro_session=');
    expect(store.findUserByEmail('octo@example.com')).not.toBeNull();
  });

  test('no usable email creates no user', async () => {
    const fetchImpl = asFetch(async (url) => {
      const u = String(url);
      if (u.includes('access_token')) {
        return new Response(JSON.stringify({ access_token: 'tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/user')) {
        return new Response(JSON.stringify({ id: 99, login: 'ghost' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/user/emails')) {
        return new Response(JSON.stringify([{ email: 'x@example.com', primary: true, verified: false }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('no', { status: 404 });
    });
    const { app, store } = makeApp(fetchImpl);
    const start = await app.fetch(new Request('http://macro.test/api/auth/github/start', { redirect: 'manual' }));
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cb = await app.fetch(
      new Request(`http://macro.test/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
        headers: { cookie: stateCookie },
        redirect: 'manual',
      }),
    );
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toContain('sign-in?error=github_email');
    expect(store.findUserByEmail('x@example.com')).toBeNull();
    expect((cb.headers.get('set-cookie') ?? '').includes('macro_session=')).toBe(false);
  });

  test('bad state is rejected', async () => {
    const { app } = makeApp(asFetch(() => Promise.reject(new Error('unused'))));
    const start = await app.fetch(new Request('http://macro.test/api/auth/github/start', { redirect: 'manual' }));
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const cb = await app.fetch(
      new Request('http://macro.test/api/auth/github/callback?code=abc&state=wrong', {
        headers: { cookie: stateCookie },
        redirect: 'manual',
      }),
    );
    expect([400, 401, 403]).toContain(cb.status);
  });
});
