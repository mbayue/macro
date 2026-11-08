// Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
// Validates: Requirements 5.5
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Mock } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, StartResponse } from '../src/api-types.ts';
import { printPlan, planHash } from '../src/plan/printer.ts';
import { admitStart, isPlanHash } from '../src/run/admission.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { ALLOWLIST } from './arb.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

interface Harness {
  store: Store;
  app: App;
  runStarts: string[];
  probeStarts: string[];
  turnstileCalls: number;
  inferenceCalls: number;
  post(path: string, body: unknown, ip?: string): Promise<{ status: number; body: unknown }>;
  runCount(): number;
}

function fakeController(starts: string[]): RunStarter {
  return {
    start: (id) => {
      starts.push(id);
    },
    stop: () => false,
    isRunning: () => false,
  };
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const h = {
    store,
    runStarts: [] as string[],
    probeStarts: [] as string[],
    turnstileCalls: 0,
    inferenceCalls: 0,
  } as Harness;
  const client = new InferenceClient({
    config: config.inference,
    store,
    fetchImpl: asFetch(() => {
      h.inferenceCalls++;
      return Promise.resolve(new Response('no', { status: 500 }));
    }),
  });
  h.app = createApp({
    store,
    config,
    verifyTurnstile: () => {
      h.turnstileCalls++;
      return Promise.resolve({ ok: true });
    },
    client,
    runController: fakeController(h.runStarts),
    probeController: fakeController(h.probeStarts),
    now: () => NOW,
    log: () => {},
  });
  h.post = async (path, body, ip = '203.0.113.9') => {
    const res = await h.app.fetch(
      new Request(`http://macro.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };
  h.runCount = () => store.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM runs').get()?.n ?? -1;
  return h;
}

/** Approves `n` distinct canonical plans directly in the store and returns their hashes. */
function seedApproved(store: Store, n: number): string[] {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const text = printPlan(samplePlan({ name: `seed ${i}` }));
    const hash = planHash(text);
    store.storeApprovedPlan({ hash, text, approvedAt: NOW });
    hashes.push(hash);
  }
  return hashes;
}

const HEX = '0123456789abcdef';
const arbHex64: fc.Arbitrary<string> = fc.string({ unit: fc.constantFrom(...HEX), minLength: 64, maxLength: 64 });

/** Strings that are NOT 64 lowercase hex characters. */
const arbMalformedHash: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 4, arbitrary: fc.string({ maxLength: 100 }) },
    { weight: 2, arbitrary: fc.string({ unit: 'binary', maxLength: 80 }) },
    { weight: 2, arbitrary: fc.string({ unit: fc.constantFrom(...HEX), maxLength: 130 }) },
    { weight: 2, arbitrary: arbHex64.map((s) => s.toUpperCase()) },
    { weight: 2, arbitrary: arbHex64.map((s) => s.slice(0, 63)) },
    { weight: 2, arbitrary: arbHex64.map((s) => `${s}0`) },
    { weight: 2, arbitrary: fc.tuple(arbHex64, fc.constantFrom(' ', '\n', '\t', '\0', '%20', '\u00a0')).map(([s, w]) => s + w) },
    { weight: 2, arbitrary: fc.tuple(arbHex64, fc.constantFrom(' ', '\n', '0x', 'sha256:')).map(([s, w]) => w + s) },
    { weight: 1, arbitrary: fc.constantFrom('', ' ', 'null', 'undefined', '0', '../../etc/passwd', "' OR 1=1 --", 'g'.repeat(64)) },
  )
  .filter((s) => !isPlanHash(s));

describe('Property 8: unapproved Plan_Hash never starts a Run', () => {
  let spawnSpy: Mock<typeof Bun.spawn>;
  let spawnSyncSpy: Mock<typeof Bun.spawnSync>;

  beforeEach(() => {
    spawnSpy = spyOn(Bun, 'spawn');
    spawnSyncSpy = spyOn(Bun, 'spawnSync');
  });
  afterEach(() => {
    spawnSpy.mockRestore();
    spawnSyncSpy.mockRestore();
  });

  test('POST /api/runs with a malformed hash: plan_not_approved, no run row, no controller, no Docker', async () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    await fc.assert(
      fc.asyncProperty(arbMalformedHash, async (hash) => {
        const h = makeHarness();
        seedApproved(h.store, 2);
        const res = await h.post('/api/runs', { planHash: hash, turnstileToken: 't' });
        expect(res.status).toBe(404);
        expect((res.body as ApiErrorBody).error.code).toBe('plan_not_approved');
        expect(h.runCount()).toBe(0);
        expect(h.store.getActiveRun()).toBeNull();
        expect(h.runStarts).toEqual([]);
        expect(h.probeStarts).toEqual([]);
        expect(h.inferenceCalls).toBe(0);
        h.store.close();
      }),
      { numRuns: 200 },
    );
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(spawnSyncSpy).not.toHaveBeenCalled();
  });

  test('POST /api/runs with a well-formed but unknown hash: plan_not_approved, nothing started', async () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    await fc.assert(
      fc.asyncProperty(arbHex64, fc.integer({ min: 0, max: 3 }), async (hash, seeded) => {
        const h = makeHarness();
        const known = seedApproved(h.store, seeded);
        fc.pre(!known.includes(hash));
        const res = await h.post('/api/runs', { planHash: hash, turnstileToken: 't' });
        expect(res.status).toBe(404);
        expect((res.body as ApiErrorBody).error.code).toBe('plan_not_approved');
        expect(h.runCount()).toBe(0);
        expect(h.runStarts).toEqual([]);
        expect(h.probeStarts).toEqual([]);
        expect(h.store.getActiveRun()).toBeNull();
        h.store.close();
      }),
      { numRuns: 200 },
    );
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(spawnSyncSpy).not.toHaveBeenCalled();
  });

  test('near-misses of a STORED hash (case, whitespace, truncation, extension) never start a Run', async () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    const variants: readonly ((s: string) => string)[] = [
      (s) => s.toUpperCase(),
      (s) => ` ${s}`,
      (s) => `${s} `,
      (s) => `${s}\n`,
      (s) => s.slice(1),
      (s) => s.slice(0, 63),
      (s) => `${s}a`,
      (s) => `0${s}`,
      (s) => s.slice(0, 63) + (s.endsWith('0') ? '1' : '0'),
    ];
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: variants.length - 1 }), fc.integer({ min: 0, max: 2 }), async (v, which) => {
        const h = makeHarness();
        const stored = seedApproved(h.store, 3)[which] as string;
        const hash = (variants[v] as (s: string) => string)(stored);
        const res = await h.post('/api/runs', { planHash: hash, turnstileToken: 't' });
        expect(res.status).toBe(404);
        expect((res.body as ApiErrorBody).error.code).toBe('plan_not_approved');
        expect(h.runCount()).toBe(0);
        expect(h.runStarts).toEqual([]);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('a non-string planHash is rejected as invalid_input before Turnstile; nothing starts', async () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    const arbNonString = fc.oneof(
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.string(), { maxLength: 3 }),
      fc.dictionary(fc.string({ maxLength: 5 }), fc.string({ maxLength: 5 }), { maxKeys: 3 }),
    );
    await fc.assert(
      fc.asyncProperty(arbNonString, async (hash) => {
        const h = makeHarness();
        seedApproved(h.store, 1);
        const res = await h.post('/api/runs', { planHash: hash, turnstileToken: 't' });
        expect(res.status).toBe(400);
        expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
        expect(h.turnstileCalls).toBe(0);
        expect(h.runCount()).toBe(0);
        expect(h.runStarts).toEqual([]);
        h.store.close();
      }),
      { numRuns: 100 },
    );
    const h = makeHarness();
    const missing = await h.post('/api/runs', { turnstileToken: 't' });
    expect(missing.status).toBe(400);
    expect(h.runCount()).toBe(0);
    h.store.close();
  });

  test('admitStart (the admission path) refuses any non-approved hash with plan_not_approved and inserts nothing', () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    fc.assert(
      fc.property(fc.oneof(arbMalformedHash, arbHex64), fc.constantFrom('203.0.113.1', 'unknown'), (hash, ip) => {
        const store = new Store(':memory:');
        const known = seedApproved(store, 2);
        fc.pre(!known.includes(hash));
        const result = admitStart({ store, config }, { kind: 'run', planHash: hash, ip, now: NOW });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('plan_not_approved');
        expect(store.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(0);
        expect(store.clientStartTimestamps(ip, 0)).toEqual([]);
        store.close();
      }),
      { numRuns: 200 },
    );
  });

  test('admitStart refuses a run start with no planHash, and a non-string planHash', () => {
    // Feature: macro, Property 8: Unapproved Plan_Hash never starts a Run
    const store = new Store(':memory:');
    seedApproved(store, 1);
    expect(admitStart({ store, config }, { kind: 'run', ip: 'unknown', now: NOW })).toMatchObject({
      ok: false,
      code: 'plan_not_approved',
    });
    const bad = [42, null, {}, [], true] as unknown as string[];
    for (const planHash of bad) {
      expect(admitStart({ store, config }, { kind: 'run', planHash, ip: 'unknown', now: NOW })).toMatchObject({
        ok: false,
        code: 'plan_not_approved',
      });
    }
    expect(store.getActiveRun()).toBeNull();
    store.close();
  });

  test('positive control: a stored hash starts exactly one Run on the run controller', async () => {
    const h = makeHarness();
    const [hash] = seedApproved(h.store, 1) as [string];
    const res = await h.post('/api/runs', { planHash: hash, turnstileToken: 't' });
    expect(res.status).toBe(200);
    const body = res.body as StartResponse;
    expect(body.planHash).toBe(hash);
    expect(h.runStarts).toEqual([body.runId]);
    expect(h.probeStarts).toEqual([]);
    expect(h.runCount()).toBe(1);
    expect(h.store.getRun(body.runId)).toMatchObject({ status: 'running', kind: 'run', planHash: hash });
    h.store.close();
  });

  test('the allowlist the fakes use is the standard one', () => {
    expect(config.target.allowlist).toEqual(ALLOWLIST);
  });
});
