// Feature: macro, Property 20: One active Run under concurrent starts
// Validates: Requirements 9.1, 9.9
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, StartResponse } from '../src/api-types.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
import { admitStart } from '../src/run/admission.ts';
import type { AdmissionResult } from '../src/run/admission.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import type { RunKind, TestPlan } from '../src/types.ts';
import { arbAcceptedPlan } from './arb.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type StartVia = 'runs' | 'approve' | 'probe';
interface Req {
  via: StartVia;
  delayMs: number;
  plan: TestPlan;
}

const arbReq: fc.Arbitrary<Req> = fc.record({
  via: fc.constantFrom<StartVia>('runs', 'approve', 'probe'),
  delayMs: fc.integer({ min: 0, max: 12 }),
  plan: arbAcceptedPlan,
});
const arbReqs = fc.array(arbReq, { minLength: 2, maxLength: 20 });

interface Harness {
  store: Store;
  app: App;
  runStarts: string[];
  probeStarts: string[];
  /** Per-request Turnstile delay, consumed by token `t<index>`. */
  delays: Map<string, number>;
  seededHash: string;
}

function fakeController(starts: string[]): RunStarter {
  return { start: (id) => void starts.push(id), stop: () => false, isRunning: () => false };
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const seedText = printPlan(samplePlan({ name: 'seeded' }));
  const seededHash = planHash(seedText);
  store.storeApprovedPlan({ hash: seededHash, text: seedText, approvedAt: NOW });
  const h: Harness = { store, app: undefined as unknown as App, runStarts: [], probeStarts: [], delays: new Map(), seededHash };
  h.app = createApp({
    store,
    config,
    // Random per-request delay so that the handlers interleave at the Turnstile await.
    verifyTurnstile: async (token) => {
      await sleep(token === undefined ? 0 : (h.delays.get(token) ?? 0));
      return { ok: true };
    },
    client: new InferenceClient({ config: config.inference, store, fetchImpl: asFetch(() => Promise.reject(new Error('no network'))) }),
    runController: fakeController(h.runStarts),
    probeController: fakeController(h.probeStarts),
    now: () => NOW,
    log: () => {},
  });
  return h;
}

interface Outcome {
  req: Req;
  status: number;
  body: unknown;
}

function send(h: Harness, req: Req, index: number, ip: string): Promise<Outcome> {
  const token = `t${index}`;
  h.delays.set(token, req.delayMs);
  const [path, body]: [string, unknown] =
    req.via === 'probe'
      ? ['/api/probe', { turnstileToken: token }]
      : req.via === 'runs'
        ? ['/api/runs', { planHash: h.seededHash, turnstileToken: token }]
        : ['/api/approve', { planText: JSON.stringify(req.plan), turnstileToken: token }];
  return h.app
    .fetch(
      new Request(`http://macro.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify(body),
      }),
    )
    .then(async (res) => ({ req, status: res.status, body: (await res.json()) as unknown }));
}

function runRows(store: Store): { id: string; kind: RunKind; status: string }[] {
  return store.db.query<{ id: string; kind: RunKind; status: string }, []>('SELECT id, kind, status FROM runs').all();
}

/** Asserts exactly one winner among `outcomes` and every other start answered `run_active`. */
function expectSingleWinner(h: Harness, outcomes: readonly Outcome[], startsBefore = { run: 0, probe: 0 }): StartResponse {
  const winners = outcomes.filter((o) => o.status === 200);
  expect(winners).toHaveLength(1);
  const winner = winners[0] as Outcome;
  const won = winner.body as StartResponse;

  for (const o of outcomes) {
    if (o === winner) continue;
    expect(o.status).toBe(409);
    const err = (o.body as ApiErrorBody).error;
    expect(err.code).toBe('run_active');
    expect(err.activeRunId).toBe(won.runId);
  }

  const rows = runRows(h.store);
  expect(rows.filter((r) => r.status === 'running')).toHaveLength(1);
  const winnerKind: RunKind = winner.req.via === 'probe' ? 'probe' : 'run';
  const newRows = rows.filter((r) => r.id === won.runId);
  expect(newRows).toEqual([{ id: won.runId, kind: winnerKind, status: 'running' }]);
  expect(h.store.getActiveRun()?.id).toBe(won.runId);

  // Only the matching controller started, exactly once, with the winner's id.
  const runStarts = h.runStarts.slice(startsBefore.run);
  const probeStarts = h.probeStarts.slice(startsBefore.probe);
  expect(winnerKind === 'probe' ? probeStarts : runStarts).toEqual([won.runId]);
  expect(winnerKind === 'probe' ? runStarts : probeStarts).toEqual([]);
  return won;
}

describe('Property 20: one active Run under concurrent starts', () => {
  test('concurrent POST /api/runs, /api/approve and /api/probe with random Turnstile delays accept exactly one', async () => {
    // Feature: macro, Property 20: One active Run under concurrent starts
    await fc.assert(
      fc.asyncProperty(arbReqs, fc.boolean(), async (reqs, sharedIp) => {
        const h = makeHarness();
        const outcomes = await Promise.all(
          reqs.map((r, i) => send(h, r, i, sharedIp ? '203.0.113.7' : `198.51.100.${i + 1}`)),
        );
        expectSingleWinner(h, outcomes);
        expect(runRows(h.store)).toHaveLength(1);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  }, 15000);

  test('after the active Run ends, the next concurrent burst again admits exactly one', async () => {
    // Feature: macro, Property 20: One active Run under concurrent starts
    await fc.assert(
      fc.asyncProperty(arbReqs, arbReqs, async (first, second) => {
        const h = makeHarness();
        const a = await Promise.all(first.map((r, i) => send(h, r, i, `198.51.100.${i + 1}`)));
        const won = expectSingleWinner(h, a);
        expect(h.store.setRunStatus(won.runId, 'completed', null, NOW + 1)).toBe(true);
        expect(h.store.getActiveRun()).toBeNull();

        const before = { run: h.runStarts.length, probe: h.probeStarts.length };
        const b = await Promise.all(second.map((r, i) => send(h, r, 100 + i, `192.0.2.${i + 1}`)));
        const won2 = expectSingleWinner(h, b, before);
        expect(won2.runId).not.toBe(won.runId);
        expect(runRows(h.store).filter((r) => r.status === 'running')).toHaveLength(1);
        expect(runRows(h.store)).toHaveLength(2);
        h.store.close();
      }),
      { numRuns: 100 },
    );
  }, 15000);

  test('concurrent admitStart calls: one ok, every other run_active naming the winner; one running row', async () => {
    // Feature: macro, Property 20: One active Run under concurrent starts
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ kind: fc.constantFrom<RunKind>('run', 'probe'), delayMs: fc.integer({ min: 0, max: 8 }) }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.boolean(),
        async (reqs, sharedIp) => {
          const store = new Store(':memory:');
          const text = printPlan(samplePlan());
          const hash = planHash(text);
          store.storeApprovedPlan({ hash, text, approvedAt: NOW });
          const results = await Promise.all(
            reqs.map(async (r, i): Promise<{ kind: RunKind; result: AdmissionResult }> => {
              await sleep(r.delayMs);
              const result = admitStart(
                { store, config },
                { kind: r.kind, ...(r.kind === 'run' ? { planHash: hash } : {}), ip: sharedIp ? '203.0.113.7' : `198.51.100.${i + 1}`, now: NOW },
              );
              return { kind: r.kind, result };
            }),
          );
          const oks = results.filter((r) => r.result.ok);
          expect(oks).toHaveLength(1);
          const winner = oks[0] as { kind: RunKind; result: Extract<AdmissionResult, { ok: true }> };
          for (const r of results) {
            if (r === winner) continue;
            expect(r.result.ok).toBe(false);
            if (!r.result.ok) {
              expect(r.result.code).toBe('run_active');
              expect(r.result.activeRunId).toBe(winner.result.runId);
            }
          }
          const rows = runRows(store);
          expect(rows).toEqual([{ id: winner.result.runId, kind: winner.kind, status: 'running' }]);
          store.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a probe in progress blocks a Run start and a Run blocks a probe, with the matching message', async () => {
    const h = makeHarness();
    const probe = await send(h, { via: 'probe', delayMs: 0, plan: undefined as unknown as TestPlan }, 0, '203.0.113.1');
    expect(probe.status).toBe(200);
    const run = await send(h, { via: 'runs', delayMs: 0, plan: undefined as unknown as TestPlan }, 1, '203.0.113.2');
    expect(run.status).toBe(409);
    const err = (run.body as ApiErrorBody).error;
    expect(err.code).toBe('run_active');
    expect(err.message).toContain('Containment_Probe');
    expect(h.runStarts).toEqual([]);
    expect(runRows(h.store)).toHaveLength(1);
    h.store.close();

    const h2 = makeHarness();
    const first = await send(h2, { via: 'runs', delayMs: 0, plan: undefined as unknown as TestPlan }, 0, '203.0.113.1');
    expect(first.status).toBe(200);
    const second = await send(h2, { via: 'probe', delayMs: 0, plan: undefined as unknown as TestPlan }, 1, '203.0.113.2');
    expect(second.status).toBe(409);
    expect((second.body as ApiErrorBody).error.code).toBe('run_active');
    expect(h2.probeStarts).toEqual([]);
    expect(runRows(h2.store)).toHaveLength(1);
    h2.store.close();
  });
});
