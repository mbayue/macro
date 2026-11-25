import { describe, expect, test } from 'bun:test';
import type { ApiErrorBody } from '../src/api-types.ts';
import { InferenceClient } from '../src/agents/inference.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

function fakeController(): RunStarter {
  return { start: () => {}, stop: () => false, isRunning: () => false };
}

function googleAuthConfig(withGoogle = true) {
  return testConfig({
    SESSION_SECRET: 'session-secret-test',
    PUBLIC_BASE_URL: 'https://macro.test',
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'Macro <hello@macro.test>',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_REDIRECT_URI: 'https://macro.test/api/auth/github/callback',
    ...(withGoogle
      ? {
          GOOGLE_CLIENT_ID: 'google-id',
          GOOGLE_CLIENT_SECRET: 'google-secret',
          GOOGLE_REDIRECT_URI: 'https://macro.test/api/auth/google/callback',
        }
      : {}),
  });
}

function makeApp(fetchImpl: typeof fetch, withGoogle = true): { app: App; store: Store } {
  const store = new Store(':memory:');
  const config = googleAuthConfig(withGoogle);
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
    googleFetch: fetchImpl,
  });
  return { app, store };
}

describe('Google OAuth', () => {
  test('returns 503 when googleAuth is unconfigured', async () => {
    const { app } = makeApp(asFetch(() => Promise.reject(new Error('unused'))), false);
    const res = await app.fetch(new Request('http://macro.test/api/auth/google/start', { redirect: 'manual' }));
    expect(res.status).toBe(503);
  });

  test('start redirects to Google with state cookie', async () => {
    const { app } = makeApp(asFetch(() => Promise.reject(new Error('unused'))));
    const res = await app.fetch(new Request('http://macro.test/api/auth/google/start', { redirect: 'manual' }));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(loc).toContain('client_id=google-id');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('macro_oauth_state=');
  });

  test('callback with verified email creates user, links google identity, stamps waitlist, and sets session', async () => {
    const fetchImpl = asFetch(async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'g-tok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return new Response(
          JSON.stringify({ sub: 'g-sub-42', email: 'Alice@Example.com', email_verified: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('unexpected', { status: 500 });
    });

    const { app, store } = makeApp(fetchImpl);
    store.addWaitlistEmail('alice@example.com', 100);
    store.markWaitlistInvited('alice@example.com', 200);

    const startRes = await app.fetch(new Request('http://macro.test/api/auth/google/start', { redirect: 'manual' }));
    const state = new URL(startRes.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = (startRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    const cbRes = await app.fetch(
      new Request(`http://macro.test/api/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: { cookie: stateCookie },
      }),
    );
    expect(cbRes.status).toBe(303);
    expect(cbRes.headers.get('location')).toBe('/app/#/');
    const setCookies = cbRes.headers.getSetCookie().join(';');
    expect(setCookies).toContain('macro_session=');

    const user = store.findUserByIdentity('google', 'g-sub-42');
    expect(user?.primaryEmail).toBe('alice@example.com');
    expect(store.getWaitlist('alice@example.com')?.joinedAt).toBe(Date.UTC(2026, 0, 15, 12, 0, 0));
  });

  test('unverified email redirects to sign-in with google_email error and creates no user', async () => {
    const fetchImpl = asFetch(async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'g-tok' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ sub: 'g-sub-99', email: 'unverified@example.com', email_verified: false }),
        { status: 200 },
      );
    });

    const { app, store } = makeApp(fetchImpl);
    const startRes = await app.fetch(new Request('http://macro.test/api/auth/google/start', { redirect: 'manual' }));
    const state = new URL(startRes.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = (startRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    const cbRes = await app.fetch(
      new Request(`http://macro.test/api/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: { cookie: stateCookie },
      }),
    );
    expect(cbRes.status).toBe(303);
    expect(cbRes.headers.get('location')).toBe('/app/#/sign-in?error=google_email');
    expect(store.findUserByEmail('unverified@example.com')).toBeNull();
  });

  test('bad state is rejected with 400 and Google error copy', async () => {
    const { app } = makeApp(asFetch(() => Promise.reject(new Error('unused'))));
    const cbRes = await app.fetch(
      new Request('http://macro.test/api/auth/google/callback?code=code-1&state=wrong', {
        redirect: 'manual',
        headers: { cookie: 'macro_oauth_state=expected' },
      }),
    );
    expect(cbRes.status).toBe(400);
    const body = (await cbRes.json()) as ApiErrorBody;
    expect(body.error).toEqual({
      code: 'invalid_input',
      message: 'Google sign-in failed. Please try again.',
    });
  });

  test('token exchange failure returns Google error copy and clears state cookie', async () => {
    const fetchImpl = asFetch(async () => new Response('bad', { status: 502 }));
    const { app } = makeApp(fetchImpl);
    const startRes = await app.fetch(new Request('http://macro.test/api/auth/google/start', { redirect: 'manual' }));
    const state = new URL(startRes.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = (startRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    const cbRes = await app.fetch(
      new Request(`http://macro.test/api/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: { cookie: stateCookie },
      }),
    );
    expect(cbRes.status).toBe(400);
    const body = (await cbRes.json()) as ApiErrorBody;
    expect(body.error).toEqual({
      code: 'invalid_input',
      message: 'Google sign-in failed. Please try again.',
    });
    expect(cbRes.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});
