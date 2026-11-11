import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, RunListItem } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { printPlan } from '../src/plan/printer.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

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

describe('GET /api/account/runs', () => {
  test('lists owned runs newest first; requires auth', async () => {
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

    const denied = await app.fetch(new Request('http://macro.test/api/account/runs'));
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as ApiErrorBody).error.code).toBe('auth_required');

    const cookie = await signIn(app, sent);
    const start = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText: printPlan(samplePlan()), turnstileToken: 't', targetMode: 'demo' }),
      }),
    );
    expect(start.status).toBe(200);
    const { runId } = (await start.json()) as { runId: string };

    const list = await app.fetch(new Request('http://macro.test/api/account/runs', { headers: { cookie } }));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { runs: RunListItem[] };
    expect(body.runs.some((r) => r.runId === runId)).toBe(true);
    expect(body.runs.find((r) => r.runId === runId)?.title).toBe('Sample plan');
  });
});
