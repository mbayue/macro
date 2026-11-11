import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody } from '../src/api-types.ts';
import type { ResendMailer } from '../src/auth/magic-link.ts';
import {
  checkDnsTxt,
  checkWellKnown,
  detectDnsProvider,
  normalizeVerifyHost,
} from '../src/auth/verify-origin.ts';
import { ContestedOriginError } from '../src/auth/types.ts';
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

async function signIn(app: App, mailerSent: { url: string }[], email = 'a@example.com'): Promise<string> {
  await app.fetch(
    new Request('http://macro.test/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
  const token = new URL(mailerSent[0]!.url).searchParams.get('token')!;
  const consume = await app.fetch(
    new Request(`http://macro.test/api/auth/magic-link/consume?token=${encodeURIComponent(token)}`, {
      redirect: 'manual',
    }),
  );
  const setCookie = consume.headers.get('set-cookie') ?? '';
  const session = setCookie.split(';')[0] ?? '';
  expect(session.startsWith('macro_session=')).toBe(true);
  return session;
}

describe('normalizeVerifyHost', () => {
  test('accepts bare host and https URL as https origin', () => {
    expect(normalizeVerifyHost('shop.example.com')).toEqual({
      ok: true,
      host: 'shop.example.com',
      origin: 'https://shop.example.com',
    });
    expect(normalizeVerifyHost('https://Shop.Example.com/')).toEqual({
      ok: true,
      host: 'shop.example.com',
      origin: 'https://shop.example.com',
    });
  });

  test('rejects http, denylist, and IP literals', () => {
    expect(normalizeVerifyHost('http://shop.example.com').ok).toBe(false);
    expect(normalizeVerifyHost('127.0.0.1').ok).toBe(false);
    expect(normalizeVerifyHost('https://macro.my.id').ok).toBe(false);
    expect(normalizeVerifyHost('yueshop.xyz').ok).toBe(false);
  });
});

describe('checkDnsTxt / checkWellKnown', () => {
  test('DNS succeeds when TXT contains the expected value', async () => {
    const ok = await checkDnsTxt('shop.example.com', 'tok-abc', async (name) => {
      expect(name).toBe('_macro-verify.shop.example.com');
      return [['tok-abc']];
    });
    expect(ok).toBe(true);
  });

  test('well-known succeeds on 200 with exact token body', async () => {
    const ok = await checkWellKnown(
      'https://shop.example.com',
      'tok-abc',
      async (input) => {
        expect(String(input)).toBe('https://shop.example.com/.well-known/macro-site-verification');
        return new Response('tok-abc\n', { status: 200 });
      },
    );
    expect(ok).toBe(true);
  });
});

describe('detectDnsProvider', () => {
  test('identifies Cloudflare nameservers on apex domain', async () => {
    const res = await detectDnsProvider('example.com', async (host) => {
      if (host === 'example.com') {
        return ['ashley.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
      }
      throw new Error('not found');
    });
    expect(res.isCloudflare).toBe(true);
    expect(res.apexHost).toBe('example.com');
    expect(res.cloudFlareDirectUrl).toBe('https://dash.cloudflare.com');
  });

  test('walks up subdomains to find Cloudflare apex nameservers', async () => {
    const res = await detectDnsProvider('shop.sub.example.com', async (host) => {
      if (host === 'shop.sub.example.com' || host === 'sub.example.com') {
        return [];
      }
      if (host === 'example.com') {
        return ['dina.ns.cloudflare.com', 'ed.ns.cloudflare.com'];
      }
      throw new Error('NXDOMAIN');
    });
    expect(res.isCloudflare).toBe(true);
    expect(res.apexHost).toBe('example.com');
  });

  test('returns isCloudflare=false for other DNS providers', async () => {
    const res = await detectDnsProvider('example.com', async () => {
      return ['ns1.digitalocean.com', 'ns2.digitalocean.com'];
    });
    expect(res.isCloudflare).toBe(false);
  });

  test('gracefully returns isCloudflare=false on DNS errors or timeouts', async () => {
    const res = await detectDnsProvider('error.com', async () => {
      throw new Error('DNS timeout');
    });
    expect(res.isCloudflare).toBe(false);
    expect(res.nameservers).toEqual([]);
  });
});

describe('verify routes', () => {
  test('start → DNS check sets verified origin; clear returns to none; contested is 409', async () => {
    const store = new Store(':memory:');
    const sentA: { to: string; url: string }[] = [];
    const sentB: { to: string; url: string }[] = [];
    const mailerA: ResendMailer = {
      sendMagicLink: async (input) => {
        sentA.push(input);
        return { ok: true };
      },
    };
    const mailerB: ResendMailer = {
      sendMagicLink: async (input) => {
        sentB.push(input);
        return { ok: true };
      },
    };
    const config = authConfig();
    let pendingToken = '';
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
      mailer: mailerA,
      resolveTxt: async () => [[pendingToken]],
      resolveNs: async () => ['alex.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      fetchImpl: async () => new Response('no', { status: 404 }),
    });

    const cookieA = await signIn(app, sentA, 'a@example.com');

    const start = await app.fetch(
      new Request('http://macro.test/api/verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieA },
        body: JSON.stringify({ host: 'shop.example.com' }),
      }),
    );
    expect(start.status).toBe(200);
    const startBody = (await start.json()) as {
      token: string;
      txtName: string;
      txtValue: string;
      wellKnownUrl: string;
    };
    expect(startBody.txtName).toBe('_macro-verify.shop.example.com');
    expect(startBody.txtValue).toBe(startBody.token);
    expect(startBody.wellKnownUrl).toBe(
      'https://shop.example.com/.well-known/macro-site-verification',
    );
    expect((startBody as { isCloudflare?: boolean }).isCloudflare).toBe(true);
    pendingToken = startBody.token;
    expect(store.getVerifiedOrigin(store.findUserByEmail('a@example.com')!.id)).toBeNull();

    const check = await app.fetch(
      new Request('http://macro.test/api/verify/check', {
        method: 'POST',
        headers: { cookie: cookieA },
      }),
    );
    expect(check.status).toBe(200);
    const checkBody = (await check.json()) as { verifiedOrigin: { host: string; origin: string } };
    expect(checkBody.verifiedOrigin).toEqual({
      host: 'shop.example.com',
      origin: 'https://shop.example.com',
    });
    expect(store.getVerifiedOrigin(store.findUserByEmail('a@example.com')!.id)?.host).toBe(
      'shop.example.com',
    );

    // Second account cannot take the same host.
    const appB = createApp({
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
      mailer: mailerB,
      resolveTxt: async () => [[pendingToken]],
      fetchImpl: async () => new Response(pendingToken, { status: 200 }),
    });
    const cookieB = await signIn(appB, sentB, 'b@example.com');
    const startB = await appB.fetch(
      new Request('http://macro.test/api/verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ host: 'shop.example.com' }),
      }),
    );
    expect(startB.status).toBe(200);
    const startBBody = (await startB.json()) as { token: string };
    pendingToken = startBBody.token;
    const contested = await appB.fetch(
      new Request('http://macro.test/api/verify/check', {
        method: 'POST',
        headers: { cookie: cookieB },
      }),
    );
    expect(contested.status).toBe(409);
    const contestedBody = (await contested.json()) as ApiErrorBody;
    expect(contestedBody.error.code).toBe('contested_origin');

    const cleared = await app.fetch(
      new Request('http://macro.test/api/verify/clear', {
        method: 'POST',
        headers: { cookie: cookieA },
      }),
    );
    expect(cleared.status).toBe(200);
    expect(store.getVerifiedOrigin(store.findUserByEmail('a@example.com')!.id)).toBeNull();
  });

  test('check succeeds via well-known when DNS fails', async () => {
    const store = new Store(':memory:');
    const sent: { to: string; url: string }[] = [];
    const mailer: ResendMailer = {
      sendMagicLink: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    };
    const config = authConfig();
    let token = '';
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
      resolveTxt: async () => {
        throw new Error('NXDOMAIN');
      },
      fetchImpl: async () => new Response(token, { status: 200 }),
    });
    const cookie = await signIn(app, sent);
    const start = await app.fetch(
      new Request('http://macro.test/api/verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ host: 'https://mine.example.org' }),
      }),
    );
    token = ((await start.json()) as { token: string }).token;
    const check = await app.fetch(
      new Request('http://macro.test/api/verify/check', { method: 'POST', headers: { cookie } }),
    );
    expect(check.status).toBe(200);
  });

  test('setVerifiedOrigin throws ContestedOriginError for foreign host', () => {
    const store = new Store(':memory:');
    const a = store.createUser('a@example.com', NOW);
    const b = store.createUser('b@example.com', NOW);
    store.setVerifiedOrigin(a.id, 'https://shop.example.com', 'shop.example.com', 't1', NOW);
    expect(() =>
      store.setVerifiedOrigin(b.id, 'https://shop.example.com', 'shop.example.com', 't2', NOW),
    ).toThrow(ContestedOriginError);
  });
});

describe('pending verification restore', () => {
  test('GET /api/me and /api/verify/pending return the same token; cancel drops it', async () => {
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
      resolveNs: async () => ['alex.ns.cloudflare.com'],
    });
    const cookie = await signIn(app, sent);
    const start = await app.fetch(
      new Request('http://macro.test/api/verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ host: 'shop.example.com' }),
      }),
    );
    expect(start.status).toBe(200);
    const started = (await start.json()) as { token: string; txtName: string; isCloudflare?: boolean };
    const me = await app.fetch(new Request('http://macro.test/api/me', { headers: { cookie } }));
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      pendingVerification: { host: string; origin: string } | null;
    };
    expect(meBody.pendingVerification).toEqual({
      host: 'shop.example.com',
      origin: 'https://shop.example.com',
    });
    const pending = await app.fetch(new Request('http://macro.test/api/verify/pending', { headers: { cookie } }));
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as { token: string; txtName: string; isCloudflare?: boolean };
    expect(pendingBody.token).toBe(started.token);
    expect(pendingBody.txtName).toBe('_macro-verify.shop.example.com');
    expect(pendingBody.isCloudflare).toBe(true);
    const cancel = await app.fetch(
      new Request('http://macro.test/api/verify/cancel', { method: 'POST', headers: { cookie } }),
    );
    expect(cancel.status).toBe(200);
    const gone = await app.fetch(new Request('http://macro.test/api/verify/pending', { headers: { cookie } }));
    expect(gone.status).toBe(404);
    const meAfter = await app.fetch(new Request('http://macro.test/api/me', { headers: { cookie } }));
    const meAfterBody = (await meAfter.json()) as { pendingVerification: { host: string } | null };
    expect(meAfterBody.pendingVerification).toBeNull();
  });
});
