import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { AccountDraft, ApiErrorBody } from '../src/api-types.ts';
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

async function signIn(app: App, sent: { url: string }[]): Promise<string> {
  await app.fetch(
    new Request('http://macro.test/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' }),
    }),
  );
  const token = new URL(sent[0]!.url).searchParams.get('token')!;
  const consume = await app.fetch(
    new Request(`http://macro.test/api/auth/magic-link/consume?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    }),
  );
  return (consume.headers.get('set-cookie') ?? '').split(';')[0]!;
}

function makeApp(store: Store, mailer: ResendMailer): App {
  const config = authConfig();
  return createApp({
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
}

describe('account draft', () => {
  test('PUT then GET round-trips; newer lastEditedAt wins; equal prefers body', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const app = makeApp(store, mailer);
    const cookie = await signIn(app, sent);

    const empty = await app.fetch(new Request('http://macro.test/api/draft', { headers: { cookie } }));
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as AccountDraft;
    expect(emptyBody.trafficEvent).toBe('');
    expect(emptyBody.targetMode).toBe('demo');
    expect(emptyBody.targetOrigin).toBeNull();
    expect(emptyBody.lastEditedAt).toBe(0);

    const first: AccountDraft = {
      trafficEvent: 'First draft text for the weekend sale.',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: NOW - 1000,
    };
    const put1 = await app.fetch(
      new Request('http://macro.test/api/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(first),
      }),
    );
    expect(put1.status).toBe(200);
    expect(await put1.json()).toEqual(first);

    const got = await app.fetch(new Request('http://macro.test/api/draft', { headers: { cookie } }));
    expect((await got.json()) as AccountDraft).toEqual(first);

    const older: AccountDraft = {
      trafficEvent: 'Stale older draft that must lose.',
      targetMode: 'own',
      targetOrigin: 'https://shop.example.com',
      lastEditedAt: NOW - 2000,
    };
    const conflict = await app.fetch(
      new Request('http://macro.test/api/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(older),
      }),
    );
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { draft: AccountDraft };
    expect(conflictBody.draft).toEqual(first);

    const newer: AccountDraft = {
      trafficEvent: 'Newer draft wins the conflict.',
      targetMode: 'own',
      targetOrigin: 'https://shop.example.com',
      lastEditedAt: NOW,
    };
    const put2 = await app.fetch(
      new Request('http://macro.test/api/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(newer),
      }),
    );
    expect(put2.status).toBe(200);
    expect(await put2.json()).toEqual(newer);

    const equal: AccountDraft = {
      trafficEvent: 'Equal timestamp prefers request body',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: NOW,
    };
    const put3 = await app.fetch(
      new Request('http://macro.test/api/draft', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(equal),
      }),
    );
    expect(put3.status).toBe(200);
    expect(await put3.json()).toEqual(equal);
  });

  test('unsigned draft routes require auth', async () => {
    const store = new Store(':memory:');
    const app = makeApp(store, {
      sendMagicLink: async () => ({ ok: true }),
    });
    const get = await app.fetch(new Request('http://macro.test/api/draft'));
    expect(get.status).toBe(401);
    expect(((await get.json()) as ApiErrorBody).error.code).toBe('auth_required');
  });
});
