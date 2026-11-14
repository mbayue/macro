// POST /api/waitlist: Turnstile-protected sign-up that stores a normalised email once and reveals nothing.
import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody } from '../src/api-types.ts';
import { createApp, normaliseEmail, WAITLIST_LIMIT } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

interface Harness {
  store: Store;
  app: App;
  turnstileOk: boolean;
  turnstileCalls: number;
  logs: string[];
  clock: { now: number };
  post(body: unknown, ip?: string): Promise<{ status: number; body: unknown }>;
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const h = { store, turnstileOk: true, turnstileCalls: 0, logs: [], clock: { now: NOW } } as unknown as Harness;
  const controller: RunStarter = { start: () => {}, stop: () => false, isRunning: () => false };
  h.app = createApp({
    store,
    config,
    verifyTurnstile: () => {
      h.turnstileCalls++;
      return Promise.resolve({ ok: h.turnstileOk });
    },
    client: new InferenceClient({
      config: config.inference,
      store,
      fetchImpl: asFetch(() => Promise.reject(new Error('no network'))),
    }),
    runController: controller,
    probeController: controller,
    now: () => h.clock.now,
    log: (line) => void h.logs.push(line),
  });
  h.post = async (body, ip = '203.0.113.9') => {
    const res = await h.app.fetch(
      new Request('http://macro.test/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };
  return h;
}

describe('normaliseEmail', () => {
  test('trims and lower-cases plausible addresses', () => {
    expect(normaliseEmail('  Ana.Silva@Shop.Example.COM ')).toBe('ana.silva@shop.example.com');
    expect(normaliseEmail('bartholomew.fitzgerald@northwind-industries-holdings.example.com')).toBe(
      'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    );
  });

  test('rejects things that are not addresses', () => {
    for (const bad of ['', 'jo', 'no-at-sign.com', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.c,d@e.com', '<x>@y.com', `${'a'.repeat(250)}@b.com`, 'a@.com']) {
      expect(normaliseEmail(bad)).toBeNull();
    }
  });
});

describe('POST /api/waitlist', () => {
  test('stores a new address once and answers the same for a repeat', async () => {
    const h = makeHarness();
    const first = await h.post({ email: 'Ana@Shop.example.com', turnstileToken: 't' });
    const again = await h.post({ email: 'ana@shop.example.com ', turnstileToken: 't' });
    expect(first).toEqual({ status: 200, body: { ok: true } });
    expect(again).toEqual(first);
    expect(h.store.listWaitlist()).toEqual([
      { email: 'ana@shop.example.com', createdAt: NOW, invitedAt: null, joinedAt: null },
    ]);
  });

  test('an invalid address is refused before Turnstile and stores nothing', async () => {
    const h = makeHarness();
    const res = await h.post({ email: 'not-an-email', turnstileToken: 't' });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
    expect(h.turnstileCalls).toBe(0);
    expect(h.store.listWaitlist()).toEqual([]);
  });

  test('a malformed body is refused', async () => {
    const h = makeHarness();
    expect((await h.post('{not json')).status).toBe(400);
    expect((await h.post({ email: 42, turnstileToken: 't' })).status).toBe(400);
    expect(h.store.listWaitlist()).toEqual([]);
  });

  test('a failed Turnstile check stores nothing', async () => {
    const h = makeHarness();
    h.turnstileOk = false;
    const res = await h.post({ email: 'ana@shop.example.com', turnstileToken: 'bad' });
    expect(res.status).toBe(403);
    expect((res.body as ApiErrorBody).error.code).toBe('turnstile_failed');
    expect(h.store.listWaitlist()).toEqual([]);
  });

  test('limits sign-ups per IP per hour, independently per IP', async () => {
    const h = makeHarness();
    for (let i = 0; i < WAITLIST_LIMIT.max; i++) {
      expect((await h.post({ email: `user${i}@shop.example.com`, turnstileToken: 't' })).status).toBe(200);
    }
    const blocked = await h.post({ email: 'late@shop.example.com', turnstileToken: 't' });
    expect(blocked.status).toBe(429);
    expect((blocked.body as ApiErrorBody).error.code).toBe('rate_limited');
    expect((await h.post({ email: 'other@shop.example.com', turnstileToken: 't' }, '198.51.100.7')).status).toBe(200);
    h.clock.now = NOW + WAITLIST_LIMIT.windowMs + 1;
    expect((await h.post({ email: 'late@shop.example.com', turnstileToken: 't' })).status).toBe(200);
  });

  test('never writes the address to the log', async () => {
    const h = makeHarness();
    await h.post({ email: 'secret.person@shop.example.com', turnstileToken: 't' });
    h.turnstileOk = false;
    await h.post({ email: 'secret.person@shop.example.com', turnstileToken: 't' });
    expect(h.logs.join('\n')).not.toContain('secret.person');
  });

  test('removeWaitlistEmail deletes one entry', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('a@shop.example.com', NOW);
    h.store.addWaitlistEmail('b@shop.example.com', NOW + 1);
    expect(h.store.removeWaitlistEmail('a@shop.example.com')).toBe(true);
    expect(h.store.removeWaitlistEmail('a@shop.example.com')).toBe(false);
    expect(h.store.listWaitlist().map((r) => r.email)).toEqual(['b@shop.example.com']);
  });
});

describe('waitlist join tracking', () => {
  function authHarness(): {
    store: Store;
    app: App;
    sent: { to: string; url: string }[];
    clock: { now: number };
  } {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const clock = { now: NOW };
    const config = testConfig({
      SESSION_SECRET: 'session-secret-test',
      PUBLIC_BASE_URL: 'https://macro.test',
      RESEND_API_KEY: 're_test',
      RESEND_FROM: 'Macro <hello@macro.test>',
      GITHUB_CLIENT_ID: 'gh-id',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      GITHUB_REDIRECT_URI: 'https://macro.test/api/auth/github/callback',
    });
    const controller: RunStarter = { start: () => {}, stop: () => false, isRunning: () => false };
    const app = createApp({
      store,
      config,
      verifyTurnstile: () => Promise.resolve({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(() => Promise.reject(new Error('no network'))),
      }),
      runController: controller,
      probeController: controller,
      now: () => clock.now,
      log: () => {},
      mailer: {
        sendMagicLink: async (input) => {
          sent.push(input);
          return { ok: true };
        },
      },
    });
    return { store, app, sent, clock };
  }

  /** Requests a magic link and consumes it, creating the session. Steps past the 60 s send cooldown. */
  async function signIn(h: ReturnType<typeof authHarness>, email: string): Promise<void> {
    h.clock.now += 61_000;
    const post = await h.app.fetch(
      new Request('http://macro.test/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    expect(post.status).toBe(200);
    const url = new URL(h.sent[h.sent.length - 1]!.url);
    const consume = await h.app.fetch(new Request(url.toString(), { method: 'GET', redirect: 'manual' }));
    expect(consume.status).toBe(303);
  }

  test('an invited address is stamped joined at its first sign-in, and only once', async () => {
    const h = authHarness();
    h.store.addWaitlistEmail('ana@shop.example.com', NOW);
    h.store.markWaitlistInvited('ana@shop.example.com', NOW + 5);
    await signIn(h, 'ana@shop.example.com');
    expect(h.store.getWaitlist('ana@shop.example.com')?.joinedAt).toBe(NOW + 61_000);
    await signIn(h, 'ana@shop.example.com');
    expect(h.store.getWaitlist('ana@shop.example.com')?.joinedAt).toBe(NOW + 61_000);
  });

  test('a sign-in before any invite does not touch the row', async () => {
    const h = authHarness();
    h.store.addWaitlistEmail('late@shop.example.com', NOW);
    await signIn(h, 'late@shop.example.com');
    const row = h.store.getWaitlist('late@shop.example.com');
    expect(row?.joinedAt).toBeNull();
    expect(row?.invitedAt).toBeNull();
    // The invite then works, and the next sign-in counts.
    h.store.markWaitlistInvited('late@shop.example.com', NOW + 50);
    await signIn(h, 'late@shop.example.com');
    expect(h.store.getWaitlist('late@shop.example.com')?.joinedAt).toBe(NOW + 122_000);
  });
});

describe('waitlist activation times', () => {
  test('an uninvited row reads with null times', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('ana@shop.example.com', NOW);
    expect(h.store.getWaitlist('ana@shop.example.com')).toEqual({
      email: 'ana@shop.example.com',
      createdAt: NOW,
      invitedAt: null,
      joinedAt: null,
    });
    expect(h.store.getWaitlist('nobody@shop.example.com')).toBeNull();
  });

  test('markWaitlistInvited sets the time and markWaitlistJoined stamps an invited row once', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('ana@shop.example.com', NOW);
    h.store.markWaitlistInvited('ana@shop.example.com', NOW + 1000);
    expect(h.store.getWaitlist('ana@shop.example.com')?.invitedAt).toBe(NOW + 1000);
    expect(h.store.markWaitlistJoined('ana@shop.example.com', NOW + 2000)).toBe(true);
    expect(h.store.getWaitlist('ana@shop.example.com')?.joinedAt).toBe(NOW + 2000);
    expect(h.store.markWaitlistJoined('ana@shop.example.com', NOW + 3000)).toBe(false);
    expect(h.store.getWaitlist('ana@shop.example.com')?.joinedAt).toBe(NOW + 2000);
  });

  test('markWaitlistJoined refuses unknown and uninvited rows', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('late@shop.example.com', NOW);
    expect(h.store.markWaitlistJoined('late@shop.example.com', NOW + 1)).toBe(false);
    expect(h.store.getWaitlist('late@shop.example.com')?.joinedAt).toBeNull();
    expect(h.store.markWaitlistJoined('nobody@shop.example.com', NOW + 1)).toBe(false);
  });

  test('markWaitlistInvited overwrites the time (the force re-send case)', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('ana@shop.example.com', NOW);
    h.store.markWaitlistInvited('ana@shop.example.com', NOW + 1);
    h.store.markWaitlistInvited('ana@shop.example.com', NOW + 2);
    expect(h.store.getWaitlist('ana@shop.example.com')?.invitedAt).toBe(NOW + 2);
  });

  test('listWaitlist orders oldest first and carries both times', () => {
    const h = makeHarness();
    h.store.addWaitlistEmail('b@shop.example.com', NOW + 10);
    h.store.addWaitlistEmail('a@shop.example.com', NOW);
    h.store.markWaitlistInvited('a@shop.example.com', NOW + 5);
    expect(h.store.listWaitlist()).toEqual([
      { email: 'a@shop.example.com', createdAt: NOW, invitedAt: NOW + 5, joinedAt: null },
      { email: 'b@shop.example.com', createdAt: NOW + 10, invitedAt: null, joinedAt: null },
    ]);
  });
});
