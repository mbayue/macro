import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import { plannerSystemPrompt, proposePlanTool } from '../src/agents/planner.ts';
import type { ApiErrorBody, PlanResponse } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import { evaluatePlan } from '../src/plan/policy.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
import type { DiscoveredRoute } from '../src/plan/discover.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import type { TestPlan } from '../src/types.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const OWN = 'https://sketch.my.id';
const EVENT = 'A new gallery opens tonight with five hundred visitors browsing the lineart archive.';

const DISCOVERED: DiscoveredRoute[] = [
  { id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true },
  { id: 'r4', kind: 'asset', method: 'GET', path: '/assets/a.webp', defaultOn: false },
];

function htmlResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function jsResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/javascript' } });
}

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

function ownSitePlan(target: string): TestPlan {
  return {
    name: 'sketch browse',
    target,
    stages: [{ vus: 10, durationSec: 60 }],
    journey: [{ route: 'r1', probability: 100, thinkMs: 500 }],
    stopThresholds: { p95Ms: 1500, errorRatePct: 2 },
  };
}

describe('own-site planner prompt', () => {
  test('discovered prompt names the files, sizes assets low, and never mentions the shop', () => {
    const prompt = plannerSystemPrompt(
      { webOrigin: OWN, apiOrigin: OWN, allowlist: [OWN] },
      DISCOVERED,
    );
    expect(prompt).toContain('/assets/a.webp');
    expect(prompt).toContain(
      'Use only the routes in the table. Include the document and each page, script, and style in that table.',
    );
    expect(prompt).not.toContain('at most two steps');
    expect(prompt).not.toContain('order_create');
    expect(prompt).not.toContain('this shop');
  });

  test('demo prompt still describes the shop catalog', () => {
    const prompt = plannerSystemPrompt({ webOrigin: 'https://yue.macro.my.id', apiOrigin: 'https://api.yue.macro.my.id', allowlist: ['https://yue.macro.my.id', 'https://api.yue.macro.my.id'] });
    expect(prompt).toContain('order_create');
    expect(prompt).toContain('store_home');
  });

  test('discovered tool restricts journey routes to the discovered ids', () => {
    const tool = proposePlanTool(DISCOVERED);
    const params = tool.parameters as Record<string, unknown>;
    const text = JSON.stringify(params);
    expect(text).toContain('r1');
    expect(text).toContain('r4');
    expect(text).not.toContain('store_home');
  });
});

describe('own-site plan approve', () => {
  test('discovery failure returns discover_failed and never calls the planner', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    let plannerCalls = 0;
    const app = createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      planner: async () => {
        plannerCalls += 1;
        throw new Error('planner must not run when discovery fails');
      },
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl: (async () => new Response('no', { status: 302 })) as unknown as typeof fetch,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'sketch.my.id', 'tok', NOW);
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('discover_failed');
    expect(plannerCalls).toBe(0);
  });

  test('successful own-site plan returns discovered routes and the verified target', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const seen: string[] = [];
    const fetchImpl = (async (input: string) => {
      seen.push(input);
      if (input === `${OWN}/`) {
        return htmlResponse('<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">');
      }
      return jsResponse('"/assets/a.webp"');
    }) as typeof fetch;
    let plannerDiscovered: readonly DiscoveredRoute[] | undefined;
    const app = createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      planner: (async (_event: string, _draftId: string, _t?: unknown, discovered?: readonly DiscoveredRoute[]) => {
        plannerDiscovered = discovered;
        const rows = discovered ?? [];
        const plan = {
          ...ownSitePlan(OWN),
          journey: (rows.length > 0 ? rows : [{ id: 'r1' }]).slice(0, 8).map((r) => ({
            route: r.id,
            probability: 100,
            thinkMs: 500,
          })),
        };
        const gate = discovered === undefined ? evaluatePlan(plan, [OWN]) : evaluatePlan(plan, [OWN], [...discovered]);
        if (gate.status !== 'accepted') throw new Error('fixture plan must gate clean');
        return {
          ok: true,
          plan,
          planText: printPlan(plan),
          planHash: planHash(printPlan(plan)),
          rationale: 'browse the gallery',
          gate,
          parseError: null,
        };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'sketch.my.id', 'tok', NOW);
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanResponse;
    expect(body.plan?.target).toBe(OWN);
    expect(plannerDiscovered?.some((r) => r.path === '/assets/a.webp')).toBe(true);
    expect(body.routes.some((r) => r.path === '/assets/a.webp' && r.defaultOn === true)).toBe(true);
    const draft = store.getDraft(body.draftId);
    expect(draft?.selectedIds).toEqual((plannerDiscovered ?? []).map((r) => r.id));
    expect(body.plan?.journey.map((s) => s.route).every((id) => (body.routes as { id: string }[]).some((r) => r.id === id))).toBe(true);
    expect(seen).toContain(`${OWN}/`);
  });

  test('demo plan does not fetch the site and returns no routes', async () => {
    const store = new Store(':memory:');
    let fetched = 0;
    const app = createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      planner: (async () => {
        const plan = ownSitePlan('https://yue.macro.my.id');
        return {
          ok: true,
          plan,
          planText: printPlan(plan),
          planHash: planHash(printPlan(plan)),
          rationale: 'demo',
          gate: { status: 'accepted' as const },
          parseError: null,
        };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      fetchImpl: (async () => {
        fetched += 1;
        return new Response('no', { status: 500 });
      }) as unknown as typeof fetch,
    });
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'demo' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanResponse;
    expect(body.routes).toEqual([]);
    expect(fetched).toBe(0);
  });

  test('routeIds plans only those routes and does not fetch again', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const seen: string[] = [];
    let plannerIds: string[] = [];
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
      planner: (async (_e: string, _d: string, _t?: unknown, discovered?: readonly DiscoveredRoute[]) => {
        plannerIds = (discovered ?? []).map((r) => r.id);
        const plan = ownSitePlan(OWN);
        return {
          ok: true,
          plan,
          planText: printPlan(plan),
          planHash: planHash(printPlan(plan)),
          rationale: 'home only',
          gate: evaluatePlan(plan, [OWN], [...(discovered ?? [])]),
          parseError: null,
        };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl: (async (input: string) => {
        seen.push(input);
        if (input === `${OWN}/`) return htmlResponse('<a href="/about">a</a>');
        return new Response('no', { status: 404 });
      }) as typeof fetch,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'sketch.my.id', 'tok', NOW);
    const first = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    expect(first.status).toBe(200);
    const fetchesAfterFirst = seen.length;
    const second = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          trafficEvent: EVENT,
          turnstileToken: 't',
          targetMode: 'own',
          targetOrigin: OWN,
          routeIds: ['r1'],
        }),
      }),
    );
    expect(second.status).toBe(200);
    expect(plannerIds).toEqual(['r1']);
    expect(seen.length).toBe(fetchesAfterFirst);
  });

  test('bad routeIds is 400 and the planner is not called', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    let plannerCalls = 0;
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
      planner: (async () => {
        plannerCalls += 1;
        const plan = ownSitePlan(OWN);
        return { ok: true, plan, planText: printPlan(plan), planHash: planHash(printPlan(plan)), rationale: 'x', gate: { status: 'accepted' as const }, parseError: null };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl: (async () => htmlResponse('<a href="/about">a</a>')) as unknown as typeof fetch,
    });
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'sketch.my.id', 'tok', NOW);
    await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    plannerCalls = 0;
    for (const routeIds of [[], ['r2'], ['r1', 'r1'], ['nope']]) {
      const res = await app.fetch(
        new Request('http://macro.test/api/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN, routeIds }),
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.message).toBe('Those routes do not match the pages read from the site.');
    }
    expect(plannerCalls).toBe(0);
  });

  test('a demo plan ignores routeIds', async () => {
    const store = new Store(':memory:');
    const app = createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      planner: (async () => {
        const plan = ownSitePlan('https://yue.macro.my.id');
        return { ok: true, plan, planText: printPlan(plan), planHash: planHash(printPlan(plan)), rationale: 'demo', gate: { status: 'accepted' as const }, parseError: null };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    });
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'demo', routeIds: ['r1'] }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe('own-site approve', () => {
  function discoveryFetch(seen: string[]): typeof fetch {
    return (async (input: string) => {
      seen.push(input);
      if (input === `${OWN}/`) {
        return htmlResponse('<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">');
      }
      return jsResponse('"/assets/a.webp"');
    }) as typeof fetch;
  }

  function ownSiteApp(
    store: Store,
    sent: { to: string; url: string }[],
    fetchImpl: typeof fetch,
    plan: TestPlan = ownSitePlan(OWN),
  ): App {
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    return createApp({
      store,
      config: authConfig(),
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({ config: authConfig().inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no'))) }),
      planner: (async (_event: string, _draftId: string, _t?: unknown, discovered?: readonly DiscoveredRoute[]) => {
        const gate = discovered === undefined ? evaluatePlan(plan, [OWN]) : evaluatePlan(plan, [OWN], [...discovered]);
        if (gate.status !== 'accepted') throw new Error('fixture plan must gate clean');
        return {
          ok: true,
          plan,
          planText: printPlan(plan),
          planHash: planHash(printPlan(plan)),
          rationale: 'browse the gallery',
          gate,
          parseError: null,
        };
      }) as never,
      runController: fakeController(),
      probeController: fakeController(),
      now: () => NOW,
      log: () => {},
      mailer,
      fetchImpl,
    });
  }

  async function planOwnSite(app: App, store: Store, sent: { to: string; url: string }[]): Promise<{ cookie: string; draftId: string; planText: string; planHash: string }> {
    const cookie = await signIn(app, sent);
    const user = store.findUserByEmail('a@example.com')!;
    store.setVerifiedOrigin(user.id, OWN, 'sketch.my.id', 'tok', NOW);
    const res = await app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ trafficEvent: EVENT, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanResponse;
    return { cookie, draftId: body.draftId, planText: body.planText!, planHash: body.planHash! };
  }

  test('approve without draftId on own-site is 400', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const seen: string[] = [];
    const app = ownSiteApp(store, sent, discoveryFetch(seen));
    const { cookie, planText } = await planOwnSite(app, store, sent);
    const res = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('approve with a journey id outside the draft routes is 422 and stores nothing', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const seen: string[] = [];
    const app = ownSiteApp(store, sent, discoveryFetch(seen));
    const { cookie, draftId, planHash } = await planOwnSite(app, store, sent);
    const bad = { ...ownSitePlan(OWN), journey: [{ route: 'r9', probability: 50, thinkMs: 500 }] };
    const res = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText: printPlan(bad), turnstileToken: 't', targetMode: 'own', targetOrigin: OWN, draftId }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.message).toBe("This plan's routes do not match the routes read from the site.");
    expect(store.getPlan(planHash)).toBeNull();
    expect(store.getPlanTarget(planHash)).toBeNull();
  });

  test('approve of the unmodified plan inserts plan_targets with both origins equal to the verified origin', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const seen: string[] = [];
    const app = ownSiteApp(store, sent, discoveryFetch(seen));
    const { cookie, draftId, planText, planHash } = await planOwnSite(app, store, sent);
    const res = await app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ planText, turnstileToken: 't', targetMode: 'own', targetOrigin: OWN, draftId }),
      }),
    );
    expect(res.status).toBe(200);
    const started = (await res.json()) as { runId: string };
    expect(started.runId).toBeTruthy();
    const stored = store.getPlanTarget(planHash);
    expect(stored).toEqual({
      planHash,
      webOrigin: OWN,
      apiOrigin: OWN,
      routes: stored?.routes ?? [],
    });
    expect(store.getPlanTarget(planHash)?.webOrigin).toBe(OWN);
    expect(store.getPlanTarget(planHash)?.apiOrigin).toBe(OWN);
  });
});
