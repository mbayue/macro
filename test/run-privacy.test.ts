import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, ClaimResponse, StartResponse } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { printPlan } from '../src/plan/printer.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, samplePlan, testConfig, toolCallOf } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const OWN = 'https://shop.example.com';
const EVENT = 'A new banner drops tonight with five hundred visitors opening the store.';

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

async function signIn(app: App, sent: { url: string }[], email: string): Promise<string> {
  await app.fetch(
    new Request('http://macro.test/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
  const token = new URL(sent[sent.length - 1]!.url).searchParams.get('token')!;
  const consume = await app.fetch(
    new Request(`http://macro.test/api/auth/magic-link/consume?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    }),
  );
  return (consume.headers.get('set-cookie') ?? '').split(';')[0]!;
}

describe('run privacy and claim', () => {
  test('own-site run is private: stranger gets 404; owner can read and stop', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const config = authConfig();
    const ownPlan = samplePlan({ target: OWN });
    const app = createApp({
      store,
      config,
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() =>
          Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan: ownPlan, rationale: 'ok sized' })])),
        ),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
    });

    const cookieA = await signIn(app, sent, 'a@example.com');
    const userA = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(userA.id, OWN, 'shop.example.com', 'tok', NOW);

    const planRes = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({
          trafficEvent: EVENT,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    const planned = (await planRes.json()) as { planText: string };
    const start = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({
          planText: planned.planText,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(start.status).toBe(200);
    const { runId } = (await start.json()) as StartResponse;
    const row = store.getRun(runId)!;
    expect(row.visibility).toBe('private');
    expect(row.ownerUserId).toBe(userA.id);

    const anon = await app.fetch(new Request(`http://macro.test/api/runs/${runId}`));
    expect(anon.status).toBe(404);
    expect(((await anon.json()) as ApiErrorBody).error.code).toBe('not_found');

    const owner = await app.fetch(new Request(`http://macro.test/api/runs/${runId}`, { headers: { cookie: cookieA } }));
    expect(owner.status).toBe(200);

    const cookieB = await signIn(app, sent, 'b@example.com');
    const other = await app.fetch(new Request(`http://macro.test/api/runs/${runId}`, { headers: { cookie: cookieB } }));
    expect(other.status).toBe(404);

    const stop = await app.fetch(
      new Request(`http://macro.test/api/runs/${runId}/stop`, {
        method: 'POST',
        headers: { cookie: cookieA },
      }),
    );
    expect(stop.status).toBe(200);
  });

  test('claim assigns public demo runs to the signed-in user without making them private', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const config = authConfig();
    const plan = samplePlan();
    const app = createApp({
      store,
      config,
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() =>
          Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan, rationale: 'ok sized' })])),
        ),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
    });

    const planText = printPlan(plan);
    const start = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planText, turnstileToken: 't', targetMode: 'demo' }),
      }),
    );
    // approve needs stored approved plan — approve path stores it. But plan must pass gate.
    expect(start.status).toBe(200);
    const { runId } = (await start.json()) as StartResponse;
    expect(store.getRun(runId)!.ownerUserId).toBeNull();
    expect(store.getRun(runId)!.visibility).toBe('public');

    const cookie = await signIn(app, sent, 'claimer@example.com');
    const claim = await app.fetch(
      new Request('http://macro.test/api/auth/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ runIds: [runId] }),
      }),
    );
    expect(claim.status).toBe(200);
    const body = (await claim.json()) as ClaimResponse;
    expect(body.claimed).toContain(runId);
    const after = store.getRun(runId)!;
    expect(after.ownerUserId).toBe(store.findUserByEmail('claimer@example.com')!.id);
    expect(after.visibility).toBe('public');
  });
});
