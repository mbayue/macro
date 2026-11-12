import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, PlanResponse, StartResponse } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
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
    const ownPlan = samplePlan({
      target: OWN,
      journey: [{ route: 'r1', probability: 100, thinkMs: 500 }],
    });
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
      fetchImpl: (async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
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
          draftId: planned.draftId,
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
      fetchImpl: (async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'shop.example.com', 'tok', NOW);

    store.createDraft({ id: 'draft-own-1', trafficEvent: EVENT, createdAt: NOW });
    store.setDraftDiscovery('draft-own-1', OWN, [{ id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true }]);
    const draftId = 'draft-own-1';

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
          draftId,
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('plan_rejected');
  });

  test('approve keeps only the checked routes and rejects a row that was left off', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const app = createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'shop.example.com', 'tok', NOW);
    store.createDraft({ id: 'draft-checked', trafficEvent: EVENT, createdAt: NOW });
    const home = { id: 'r1', kind: 'document' as const, method: 'GET' as const, path: '/', defaultOn: true };
    const logo = { id: 'r2', kind: 'asset' as const, method: 'GET' as const, path: '/logo.webp', defaultOn: false };
    store.setDraftDiscovery('draft-checked', OWN, [home, logo], ['r1']);
    const good = samplePlan({ target: OWN, journey: [{ route: 'r1', probability: 100, thinkMs: 500 }] });
    const ok = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText: printPlan(good), turnstileToken: 't', targetMode: 'own', targetOrigin: OWN, draftId: 'draft-checked' }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(store.getPlanTarget(planHash(printPlan(good)))?.routes).toEqual([home]);
    const bad = samplePlan({
      target: OWN,
      journey: [
        { route: 'r1', probability: 100, thinkMs: 500 },
        { route: 'r2', probability: 10, thinkMs: 500 },
      ],
    });
    const rejected = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText: printPlan(bad), turnstileToken: 't', targetMode: 'own', targetOrigin: OWN, draftId: 'draft-checked' }),
      }),
    );
    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as ApiErrorBody).error.message).toBe("This plan's routes do not match the routes read from the site.");
    expect(store.getPlan(planHash(printPlan(bad)))).toBeNull();
  });
});
