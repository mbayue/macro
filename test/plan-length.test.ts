// Feature: macro, Property 18: Traffic_Event length gate
// Validates: Requirements 1.4
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, PlanResponse } from '../src/api-types.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, samplePlan, testConfig, toolCallOf } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

interface Harness {
  store: Store;
  app: App;
  turnstileCalls: number;
  inferenceCalls: number;
  controllerCalls: number;
  post(body: unknown): Promise<{ status: number; body: unknown }>;
  draftCount(): number;
  planningRequestCount(): number;
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const h = { store, turnstileCalls: 0, inferenceCalls: 0, controllerCalls: 0 } as Harness;
  const controller: RunStarter = {
    start: () => void h.controllerCalls++,
    stop: () => false,
    isRunning: () => false,
  };
  h.app = createApp({
    store,
    config,
    verifyTurnstile: () => {
      h.turnstileCalls++;
      return Promise.resolve({ ok: true });
    },
    client: new InferenceClient({
      config: config.inference,
      store,
      fetchImpl: asFetch(() => {
        h.inferenceCalls++;
        return Promise.resolve(
          chatResponse([toolCallOf('propose_plan', { plan: samplePlan(), rationale: 'A gentle ladder.' })]),
        );
      }),
    }),
    runController: controller,
    probeController: controller,
    now: () => NOW,
    log: () => {},
  });
  h.post = async (body) => {
    const res = await h.app.fetch(
      new Request('http://macro.test/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };
  h.draftCount = () => store.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM drafts').get()?.n ?? -1;
  h.planningRequestCount = () => store.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM planning_requests').get()?.n ?? -1;
  return h;
}

// ------------------------------------------------------------------ generators

const WS_UNITS: readonly string[] = [' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\u3000', '\ufeff', '\u2028', '\u2029'];
const arbPad: fc.Arbitrary<string> = fc.string({ unit: fc.constantFrom(...WS_UNITS), maxLength: 12 });

/** Code points that are neither whitespace (by `String.prototype.trim`) nor a lone surrogate. */
const arbVisibleCodePoint: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 5, arbitrary: fc.integer({ min: 0x21, max: 0x7e }) },
    { weight: 2, arbitrary: fc.integer({ min: 0xa1, max: 0xd7ff }) },
    { weight: 4, arbitrary: fc.integer({ min: 0x1f300, max: 0x1faff }) }, // emoji
    { weight: 2, arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }) }, // any astral
    { weight: 1, arbitrary: fc.constantFrom(0x22, 0x5c, 0x60, 0x3c, 0x200d, 0x1f468) },
  )
  .map((cp) => String.fromCodePoint(cp))
  .filter((s) => s.trim() !== '');

const arbAnyCodePoint: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: arbVisibleCodePoint },
  { weight: 1, arbitrary: fc.constantFrom(...WS_UNITS) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 0x1f }).map((cp) => String.fromCodePoint(cp)) },
);

/** Trimmed lengths clustered at the bounds 9/10 and 1000/1001, plus the full range. */
const arbLength: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(0, 1, 2, 8, 9, 10, 11, 999, 1000, 1001, 1002) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 14 }) },
  { weight: 2, arbitrary: fc.integer({ min: 990, max: 1010 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 1300 }) },
);

/**
 * A string whose trimmed form has exactly `length` code points. The first and last code points of
 * the core are visible, so padding on either side is the only thing `trim` removes.
 */
function arbEvent(length: number): fc.Arbitrary<{ text: string; length: number }> {
  const core: fc.Arbitrary<string> =
    length === 0
      ? fc.constant('')
      : length === 1
        ? arbVisibleCodePoint
        : fc
            .tuple(arbVisibleCodePoint, fc.array(arbAnyCodePoint, { minLength: length - 2, maxLength: length - 2 }), arbVisibleCodePoint)
            .map(([a, mid, z]) => a + mid.join('') + z);
  return fc.tuple(arbPad, core, arbPad).map(([l, c, r]) => ({ text: l + c + r, length }));
}

const arbStringEvent = arbLength.chain(arbEvent);

const arbNonString: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
  fc.dictionary(fc.string({ maxLength: 5 }), fc.string({ maxLength: 20 }), { maxKeys: 2 }),
  fc.string({ minLength: 20, maxLength: 40 }).map((s) => ({ toString: s })),
);

const inRange = (n: number): boolean => n >= 10 && n <= 1000;

describe('Property 18: Traffic_Event length gate', () => {
  test('trimmed code-point length decides: outside 10..1000 is a 400 invalid_input with no Turnstile or inference call; inside proceeds', async () => {
    // Feature: macro, Property 18: Traffic_Event length gate
    let below = 0;
    let above = 0;
    let inside = 0;
    await fc.assert(
      fc.asyncProperty(arbStringEvent, async ({ text, length }) => {
        // The construction and an independent computation agree on the trimmed length.
        expect([...text.trim()].length).toBe(length);

        const h = makeHarness();
        const res = await h.post({ trafficEvent: text, turnstileToken: 't' });

        if (inRange(length)) {
          inside++;
          expect(res.status).toBe(200);
          expect((res.body as PlanResponse).gate).toEqual({ status: 'accepted' });
          expect(h.turnstileCalls).toBe(1);
          expect(h.inferenceCalls).toBeGreaterThanOrEqual(1);
          // The stored draft holds the trimmed text.
          expect(h.draftCount()).toBe(1);
          const draft = h.store.getDraft((res.body as PlanResponse).draftId);
          expect(draft?.trafficEvent).toBe(text.trim());
        } else {
          if (length < 10) below++;
          else above++;
          expect(res.status).toBe(400);
          expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
          expect(h.turnstileCalls).toBe(0);
          expect(h.inferenceCalls).toBe(0);
          expect(h.draftCount()).toBe(0);
          expect(h.planningRequestCount()).toBe(0);
        }
        expect(h.controllerCalls).toBe(0);
        h.store.close();
      }),
      { numRuns: 200 },
    );
    expect(below).toBeGreaterThan(10);
    expect(above).toBeGreaterThan(10);
    expect(inside).toBeGreaterThan(10);
  });

  test('exact boundaries with astral and emoji code points: 9 and 1001 fail, 10 and 1000 pass', async () => {
    // Feature: macro, Property 18: Traffic_Event length gate
    const atoms = ['a', '🚀', '😀', '𝒳', '日', '👨‍👩‍👧'] as const; // the last is 5 code points and 8 UTF-16 units
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...atoms), fc.constantFrom(9, 10, 1000, 1001), arbPad, arbPad, async (atom, length, l, r) => {
        const units = [...atom].length;
        const count = Math.floor(length / units);
        const rest = length - count * units;
        const text = l + atom.repeat(count) + 'x'.repeat(rest) + r;
        expect([...text.trim()].length).toBe(length);
        const h = makeHarness();
        const res = await h.post({ trafficEvent: text, turnstileToken: 't' });
        if (inRange(length)) {
          expect(res.status).toBe(200);
          expect(h.turnstileCalls).toBe(1);
          expect(h.inferenceCalls).toBeGreaterThanOrEqual(1);
        } else {
          expect(res.status).toBe(400);
          expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
          expect(h.turnstileCalls).toBe(0);
          expect(h.inferenceCalls).toBe(0);
        }
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('padding never counts: only whitespace is 400 for any amount of it, and a 1000-point event survives huge padding', async () => {
    // Feature: macro, Property 18: Traffic_Event length gate
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: fc.constantFrom(...WS_UNITS), minLength: 0, maxLength: 1500 }), async (blank) => {
        const h = makeHarness();
        const res = await h.post({ trafficEvent: blank, turnstileToken: 't' });
        expect(res.status).toBe(400);
        expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
        expect(h.turnstileCalls).toBe(0);
        expect(h.inferenceCalls).toBe(0);
        h.store.close();
      }),
      { numRuns: 100 },
    );

    const h = makeHarness();
    const ok = await h.post({ trafficEvent: `${' \n\t'.repeat(500)}${'🚀'.repeat(1000)}${'\u3000'.repeat(500)}`, turnstileToken: 't' });
    expect(ok.status).toBe(200);
    expect(h.turnstileCalls).toBe(1);
    h.store.close();
  });

  test('non-string values and a missing trafficEvent get invalid_input with no Turnstile or inference call', async () => {
    // Feature: macro, Property 18: Traffic_Event length gate
    await fc.assert(
      fc.asyncProperty(arbNonString, async (value) => {
        const h = makeHarness();
        const res = await h.post({ trafficEvent: value, turnstileToken: 't' });
        expect(res.status).toBe(400);
        expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
        expect(h.turnstileCalls).toBe(0);
        expect(h.inferenceCalls).toBe(0);
        expect(h.draftCount()).toBe(0);
        h.store.close();
      }),
      { numRuns: 100 },
    );

    for (const body of [{}, { turnstileToken: 't' }, { trafficEvent: undefined }, [], 'text', 7, null]) {
      const h = makeHarness();
      const res = await h.post(body);
      expect(res.status).toBe(400);
      expect(h.turnstileCalls).toBe(0);
      expect(h.inferenceCalls).toBe(0);
      h.store.close();
    }
  });

  test('an invalid-length body never reaches Turnstile even when the Turnstile token is missing or bad', async () => {
    // Feature: macro, Property 18: Traffic_Event length gate
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 9 }).filter((s) => [...s.trim()].length < 10),
        fc.oneof(fc.constant(undefined), fc.string(), fc.integer()),
        async (text, token) => {
          const h = makeHarness();
          const res = await h.post(token === undefined ? { trafficEvent: text } : { trafficEvent: text, turnstileToken: token });
          expect(res.status).toBe(400);
          expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
          expect(h.turnstileCalls).toBe(0);
          expect(h.inferenceCalls).toBe(0);
          h.store.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
