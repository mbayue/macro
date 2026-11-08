// Feature: macro, Property 7: Approval stores only canonical, accepted plans
// Validates: Requirements 4.9, 5.2, 5.6
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, StartResponse } from '../src/api-types.ts';
import { parsePlan } from '../src/plan/parser.ts';
import { evaluatePlan } from '../src/plan/policy.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import type { TestPlan } from '../src/types.ts';
import { ALLOWLIST, arbAcceptedPlan, arbBoundaryPlan, arbTestPlan } from './arb.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

interface Harness {
  store: Store;
  app: App;
  runStarts: string[];
  probeStarts: string[];
  turnstileCalls: number;
  turnstileOk: boolean;
  inferenceCalls: number;
  approve(planText: unknown): Promise<{ status: number; body: unknown }>;
  plans(): { hash: string; text: string }[];
  runs(): { id: string; plan_hash: string | null; status: string }[];
}

function fakeController(starts: string[]): RunStarter {
  return { start: (id) => void starts.push(id), stop: () => false, isRunning: () => false };
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const h = { store, runStarts: [], probeStarts: [], turnstileCalls: 0, turnstileOk: true, inferenceCalls: 0 } as unknown as Harness;
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
      fetchImpl: asFetch(() => {
        h.inferenceCalls++;
        return Promise.reject(new Error('no network'));
      }),
    }),
    runController: fakeController(h.runStarts),
    probeController: fakeController(h.probeStarts),
    now: () => NOW,
    log: () => {},
  });
  h.approve = async (planText) => {
    const res = await h.app.fetch(
      new Request('http://macro.test/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
        body: JSON.stringify({ planText, turnstileToken: 't' }),
      }),
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };
  h.plans = () => store.db.query<{ hash: string; text: string }, []>('SELECT hash, text FROM plans').all();
  h.runs = () => store.db.query<{ id: string; plan_hash: string | null; status: string }, []>('SELECT id, plan_hash, status FROM runs').all();
  return h;
}

// ---------------------------------------------------------------- text formats

/** Re-orders the keys of every object (reverse order), keeping the values. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
}

const FORMATS: readonly ((plan: TestPlan) => string)[] = [
  (p) => printPlan(p),
  (p) => JSON.stringify(p),
  (p) => JSON.stringify(p, null, 2),
  (p) => JSON.stringify(p, null, '\t'),
  (p) => JSON.stringify(reverseKeys(p)),
  (p) => `\n\n  ${JSON.stringify(reverseKeys(p), null, 4)}  \n`,
  // A fence is only safe when no string in the plan contains a backtick run; the oracle copes either way.
  (p) => `\`\`\`json\n${JSON.stringify(p, null, 2)}\n\`\`\``,
  (p) => `Here is the plan:\n\`\`\`\n${JSON.stringify(p)}\n\`\`\`\nThanks!`,
];

const arbFormat = fc.integer({ min: 0, max: FORMATS.length - 1 });

/** Broken or hostile variants of valid text. */
const MUTATIONS: readonly ((s: string) => string)[] = [
  (s) => s.slice(0, Math.max(1, s.length >> 1)),
  (s) => s.slice(0, -1),
  (s) => `${s}}`,
  (s) => s.replace('"stages"', '"stagez"'),
  (s) => s.replace(/"vus":\d+/, '"vus":501'),
  (s) => s.replace(/"vus":\d+/, '"vus":1.0'),
  (s) => s.replace(/"vus":\d+/, '"vus":1e2'),
  (s) => s.replace(/https:\/\/[a-z.]+/, 'https://evil.test'),
  (s) => s.replace('{', '{"extra":1,'),
  (s) => s.replace('{', '{"name":"dup",'),
  (s) => s.replaceAll('"', "'"),
  (s) => s.replace(/"durationSec":\d+/, '"durationSec":29'),
  (s) => `${s}${' '.repeat(17000)}`,
  (s) => `[${s}]`,
];

const arbText: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(arbAcceptedPlan, arbFormat).map(([p, f]) => (FORMATS[f] as (p: TestPlan) => string)(p)) },
  { weight: 2, arbitrary: fc.tuple(arbBoundaryPlan, arbFormat).map(([p, f]) => (FORMATS[f] as (p: TestPlan) => string)(p)) },
  { weight: 3, arbitrary: fc.tuple(arbTestPlan, arbFormat).map(([p, f]) => (FORMATS[f] as (p: TestPlan) => string)(p)) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(arbAcceptedPlan, arbFormat, fc.integer({ min: 0, max: MUTATIONS.length - 1 }))
      .map(([p, f, m]) => (MUTATIONS[m] as (s: string) => string)((FORMATS[f] as (p: TestPlan) => string)(p))),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 200 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 100 }) },
  { weight: 1, arbitrary: fc.constantFrom('', ' ', '{}', '[]', 'null', '```', '```json\n```', '{"name":"x"}', '42') },
);

describe('Property 7: /api/approve stores only canonical, accepted plans', () => {
  test('stored text is printPlan(parsePlan(text)), its key is its hash; rejected text stores nothing and starts nothing', async () => {
    // Feature: macro, Property 7: Approval stores only canonical, accepted plans
    let accepted = 0;
    let rejected = 0;
    await fc.assert(
      fc.asyncProperty(arbText, async (text) => {
        const h = makeHarness();
        const parsed = parsePlan(text);
        const accepts = parsed.ok && evaluatePlan(parsed.plan, ALLOWLIST).status === 'accepted';
        const res = await h.approve(text);

        if (text === '') {
          // The body schema requires a non-empty planText.
          expect(res.status).toBe(400);
          expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
        }

        if (accepts && parsed.ok) {
          accepted++;
          expect(res.status).toBe(200);
          const storedText = printPlan(parsed.plan);
          const rows = h.plans();
          expect(rows).toHaveLength(1);
          const row = rows[0] as { hash: string; text: string };
          expect(row.text).toBe(storedText);
          expect(row.hash).toBe(planHash(row.text));
          // Canonical text is a fixed point of parse -> print.
          const again = parsePlan(row.text);
          expect(again.ok && printPlan(again.plan)).toBe(row.text);
          expect(again.ok && evaluatePlan(again.plan, ALLOWLIST).status).toBe('accepted');

          const body = res.body as StartResponse;
          expect(body.planHash).toBe(row.hash);
          expect(h.store.hasApprovedPlan(row.hash)).toBe(true);
          expect(h.runs()).toEqual([{ id: body.runId, plan_hash: row.hash, status: 'running' }]);
          expect(h.runStarts).toEqual([body.runId]);
        } else {
          rejected++;
          if (text !== '') {
            expect(res.status).toBe(422);
            expect((res.body as ApiErrorBody).error.code).toBe('plan_rejected');
          }
          expect(h.plans()).toEqual([]);
          expect(h.runs()).toEqual([]);
          expect(h.runStarts).toEqual([]);
          expect(h.probeStarts).toEqual([]);
          expect(h.store.getActiveRun()).toBeNull();
        }
        expect(h.inferenceCalls).toBe(0);
        h.store.close();
      }),
      { numRuns: 300 },
    );
    // The generator must exercise both branches, otherwise the property is vacuous.
    expect(accepted).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(20);
  });

  test('approving any two re-formatted variants of one plan keeps a single plans row and one hash', async () => {
    // Feature: macro, Property 7: Approval stores only canonical, accepted plans
    await fc.assert(
      fc.asyncProperty(arbAcceptedPlan, arbFormat, arbFormat, async (plan, f1, f2) => {
        const h = makeHarness();
        const t1 = (FORMATS[f1] as (p: TestPlan) => string)(plan);
        const t2 = (FORMATS[f2] as (p: TestPlan) => string)(plan);
        // Fences are unsafe for names with backtick runs; those variants are rejected, so skip them.
        const p1 = parsePlan(t1);
        const p2 = parsePlan(t2);
        fc.pre(p1.ok && p2.ok);

        const first = await h.approve(t1);
        expect(first.status).toBe(200);
        const id1 = (first.body as StartResponse).runId;
        expect(h.store.setRunStatus(id1, 'completed', null, NOW + 1)).toBe(true);
        const second = await h.approve(t2);
        expect(second.status).toBe(200);

        const rows = h.plans();
        expect(rows).toHaveLength(1);
        const row = rows[0] as { hash: string; text: string };
        expect(row.text).toBe(printPlan(plan));
        expect((first.body as StartResponse).planHash).toBe(row.hash);
        expect((second.body as StartResponse).planHash).toBe(row.hash);
        expect(h.runs()).toHaveLength(2);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('an accepted plan approved while a Run is active is stored once but starts nothing', async () => {
    // Feature: macro, Property 7: Approval stores only canonical, accepted plans
    await fc.assert(
      fc.asyncProperty(arbAcceptedPlan, async (plan) => {
        const h = makeHarness();
        h.store.createRun({ id: 'busy', kind: 'probe', planHash: null, runtime: 'runsc', startedAt: NOW });
        const res = await h.approve(JSON.stringify(plan));
        expect(res.status).toBe(409);
        expect((res.body as ApiErrorBody).error.code).toBe('run_active');
        const rows = h.plans();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.text).toBe(printPlan(plan));
        expect(rows[0]?.hash).toBe(planHash(printPlan(plan)));
        expect(h.runs().map((r) => r.id)).toEqual(['busy']);
        expect(h.runStarts).toEqual([]);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('a failed Turnstile check stores nothing and starts nothing, even for an accepted plan', async () => {
    // Feature: macro, Property 7: Approval stores only canonical, accepted plans
    await fc.assert(
      fc.asyncProperty(arbAcceptedPlan, async (plan) => {
        const h = makeHarness();
        h.turnstileOk = false;
        const res = await h.approve(printPlan(plan));
        expect(res.status).toBe(403);
        expect((res.body as ApiErrorBody).error.code).toBe('turnstile_failed');
        expect(h.plans()).toEqual([]);
        expect(h.runs()).toEqual([]);
        expect(h.runStarts).toEqual([]);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('a non-string or missing planText is invalid_input and stores nothing', async () => {
    // Feature: macro, Property 7: Approval stores only canonical, accepted plans
    const arbNonString = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string(), { maxLength: 2 }), fc.record({ a: fc.integer() }));
    await fc.assert(
      fc.asyncProperty(arbNonString, async (value) => {
        const h = makeHarness();
        const res = await h.approve(value);
        expect(res.status).toBe(400);
        expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
        expect(h.turnstileCalls).toBe(0);
        expect(h.plans()).toEqual([]);
        expect(h.runs()).toEqual([]);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });

  test('a valid plan padded past 16 KiB is rejected and stores nothing', async () => {
    const h = makeHarness();
    const res = await h.approve(`${JSON.stringify(samplePlan())}${' '.repeat(17000)}`);
    expect(res.status).toBe(422);
    expect((res.body as ApiErrorBody).error.code).toBe('plan_rejected');
    expect(h.plans()).toEqual([]);
    expect(h.runs()).toEqual([]);
    h.store.close();
  });

  test('positive control: the response and stored row for a known plan', async () => {
    const h = makeHarness();
    const plan = samplePlan({ name: 'control' });
    const res = await h.approve(JSON.stringify(plan, null, 2));
    expect(res.status).toBe(200);
    expect(h.plans()).toEqual([{ hash: planHash(printPlan(plan)), text: printPlan(plan) }]);
    h.store.close();
  });
});
