import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, PlanResponse, StartResponse } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { printPlan } from '../src/plan/printer.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, samplePlan, testConfig, toolCallOf, WEB } from './arb-agents.ts';

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

async function signIn(app: App, sent: { url: string }[], email = 'a@example.com'): Promise<string> {
  await app.fetch(
    new Request('http://macro.test/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
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

describe('own-site plan/approve gate', () => {
  test('signed-out own mode returns auth_required; demo still works signed-out', async () => {
    const store = new Store(':memory:');
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
    });

    const ownDenied = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trafficEvent: EVENT,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(ownDenied.status).toBe(401);
    expect(((await ownDenied.json()) as ApiErrorBody).error.code).toBe('auth_required');

    const demo = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'demo' }),
      }),
    );
    expect(demo.status).toBe(200);
    const body = (await demo.json()) as PlanResponse;
    expect(body.plan?.target).toBe(WEB);
  });

  test('signed-in without verify gets verification_required; verified own accepts matching origin', async () => {
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

    const cookie = await signIn(app, sent);
    const needVerify = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          trafficEvent: EVENT,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(needVerify.status).toBe(403);
    expect(((await needVerify.json()) as ApiErrorBody).error.code).toBe('verification_required');

    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'shop.example.com', 'tok', NOW);

    const ok = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          trafficEvent: EVENT,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(ok.status).toBe(200);
    const planned = (await ok.json()) as PlanResponse;
    expect(planned.gate?.status).toBe('accepted');
    expect(planned.plan?.target).toBe(OWN);

    const approveOk = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          planText: planned.planText,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(approveOk.status).toBe(200);
    expect(((await approveOk.json()) as StartResponse).runId).toBeTruthy();
  });

  test('approve rejects own-site plan targeting a different host', async () => {
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
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'shop.example.com', 'tok', NOW);

    const other = samplePlan({ target: 'https://other.example.com' });
    const res = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          planText: printPlan(other),
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('plan_rejected');
  });
});
