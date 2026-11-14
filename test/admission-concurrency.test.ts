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

/** Asserts exactly one active winner among `outcomes` and every other start is queued in FIFO order. */
function expectSingleWinner(h: Harness, outcomes: readonly Outcome[], startsBefore = { run: 0, probe: 0 }): StartResponse {
  const admitted = outcomes.filter((o) => o.status === 200);
  const winners = admitted.filter((o) => (o.body as StartResponse).status === 'running');
  expect(winners).toHaveLength(1);
  const winner = winners[0] as Outcome;
  const won = winner.body as StartResponse;

  const queuedPositions: number[] = [];
  for (const o of outcomes) {
    if (o === winner) continue;
    if (o.status === 429) {
      expect((o.body as ApiErrorBody).error.code).toBe('rate_limited');
      continue;
    }
    expect(o.status).toBe(200);
    const body = o.body as StartResponse;
    expect(body.status).toBe('queued');
    expect(typeof body.queuePosition).toBe('number');
    queuedPositions.push(body.queuePosition as number);
  }
  expect(queuedPositions.sort((a, b) => a - b)).toEqual(
    Array.from({ length: admitted.length - 1 }, (_, i) => i + 1),
  );

  const rows = runRows(h.store);
  expect(rows.filter((r) => r.status === 'running')).toHaveLength(1);
  expect(rows.filter((r) => r.status === 'queued')).toHaveLength(admitted.length - 1);
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
        expect(runRows(h.store).filter((r) => r.status === 'running')).toHaveLength(1);
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
        for (const r of runRows(h.store)) {
          if (r.status === 'queued') h.store.stopQueuedRun(r.id, NOW + 1);
        }
        expect(h.store.setRunStatus(won.runId, 'completed', null, NOW + 1)).toBe(true);
        expect(h.store.getActiveRun()).toBeNull();

        const before = { run: h.runStarts.length, probe: h.probeStarts.length };
        const b = await Promise.all(second.map((r, i) => send(h, r, 100 + i, `192.0.2.${i + 1}`)));
        const won2 = expectSingleWinner(h, b, before);
        expect(won2.runId).not.toBe(won.runId);
        expect(runRows(h.store).filter((r) => r.status === 'running')).toHaveLength(1);
        expect(runRows(h.store)).toHaveLength(first.length + second.length);
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
          const running = results.filter((r) => r.result.ok && r.result.status === 'running');
          expect(running).toHaveLength(1);
          const winner = running[0] as { kind: RunKind; result: Extract<AdmissionResult, { ok: true }> };
          const okCount = results.filter((r) => r.result.ok).length;
          for (const r of results) {
            if (r === winner) continue;
            if (!r.result.ok) {
              expect(r.result.code).toBe('rate_limited');
              continue;
            }
            expect(r.result.status).toBe('queued');
            expect(typeof r.result.queuePosition).toBe('number');
          }
          const rows = runRows(store);
          expect(rows.filter((r) => r.status === 'running')).toEqual([
            { id: winner.result.runId, kind: winner.kind, status: 'running' },
          ]);
          expect(rows.filter((r) => r.status === 'queued')).toHaveLength(okCount - 1);
          store.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a probe in progress queues a Run start and a Run queues a probe', async () => {
    const h = makeHarness();
    const probe = await send(h, { via: 'probe', delayMs: 0, plan: undefined as unknown as TestPlan }, 0, '203.0.113.1');
    expect(probe.status).toBe(200);
    expect((probe.body as StartResponse).status).toBe('running');
    const run = await send(h, { via: 'runs', delayMs: 0, plan: undefined as unknown as TestPlan }, 1, '203.0.113.2');
    expect(run.status).toBe(200);
    expect((run.body as StartResponse).status).toBe('queued');
    expect((run.body as StartResponse).queuePosition).toBe(1);
    expect(h.runStarts).toEqual([]);
    expect(runRows(h.store)).toHaveLength(2);
    h.store.close();

    const h2 = makeHarness();
    const first = await send(h2, { via: 'runs', delayMs: 0, plan: undefined as unknown as TestPlan }, 0, '203.0.113.1');
    expect(first.status).toBe(200);
    expect((first.body as StartResponse).status).toBe('running');
    const second = await send(h2, { via: 'probe', delayMs: 0, plan: undefined as unknown as TestPlan }, 1, '203.0.113.2');
    expect(second.status).toBe(200);
    expect((second.body as StartResponse).status).toBe('queued');
    expect((second.body as StartResponse).queuePosition).toBe(1);
    expect(h2.probeStarts).toEqual([]);
    expect(runRows(h2.store)).toHaveLength(2);
    h2.store.close();
  });
});
