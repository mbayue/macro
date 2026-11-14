import { describe, expect, test } from 'bun:test';
import type { ApiErrorBody, RunSnapshot, StartResponse, StopResponse } from '../src/api-types.ts';
import type { Config } from '../src/config.ts';
import { InferenceClient } from '../src/agents/inference.ts';
import { planHash } from '../src/plan/printer.ts';
import { MAX_QUEUED_RUNS } from '../src/run/admission.ts';
import { createApp, type RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';

const NOW = 1_770_000_000_000;

const config: Config = {
  inference: {
    apiKey: '',
    baseUrl: 'https://inference.test/v1',
    model: 'test-model',
    fallbackModel: 'test-fallback',
  },
  turnstile: { secretKey: '', siteKey: 'site-key' },
  target: {
    webOrigin: 'https://shop.example',
    apiOrigin: 'https://api.shop.example',
    allowlist: ['https://shop.example', 'https://api.shop.example'],
  },
  sandbox: { runtime: 'runsc', k6Image: 'grafana/k6:test' },
  macroVmIp: '198.51.100.1',
  port: 3000,
  dataDir: ':memory:',
  dockerHost: 'unix:///var/run/docker.sock',
};

const PLAN_TEXT = JSON.stringify({
  name: 'Queue test',
  target: 'https://shop.example',
  stages: [{ vus: 10, durationSec: 10 }],
  journey: [{ route: 'store_home', probability: 100, thinkMs: 500 }],
  stopThresholds: { p95Ms: 1000, errorRatePct: 5 },
});

interface FakeController extends RunStarter {
  started: string[];
  complete(runId: string): void;
}

function makeFakeController(store: Store): FakeController {
  const active = new Map<string, { resolve: () => void; done: Promise<void> }>();
  const started: string[] = [];
  return {
    started,
    start(runId: string) {
      started.push(runId);
      let resolve!: () => void;
      const done = new Promise<void>((r) => {
        resolve = r;
      });
      active.set(runId, { resolve, done });
    },
    stop(runId: string) {
      const changed = store.setRunStatus(runId, 'stopped', null, NOW);
      this.complete(runId);
      return changed;
    },
    isRunning(runId: string) {
      return active.has(runId);
    },
    hasActive() {
      return active.size > 0;
    },
    whenDone(runId: string) {
      return active.get(runId)?.done ?? Promise.resolve();
    },
    complete(runId: string) {
      const entry = active.get(runId);
      if (!entry) return;
      store.setRunStatus(runId, 'completed', null, NOW + 1000);
      active.delete(runId);
      entry.resolve();
    },
  };
}

function setup() {
  const store = new Store(':memory:');
  const hash = planHash(PLAN_TEXT);
  store.storeApprovedPlan({ hash, text: PLAN_TEXT, approvedAt: NOW });
  const runController = makeFakeController(store);
  const probeController = makeFakeController(store);
  const app = createApp({
    store,
    config,
    verifyTurnstile: async () => ({ ok: true }),
    client: new InferenceClient({ config: config.inference, store }),
    runController,
    probeController,
    now: () => NOW,
  });
  return { store, hash, runController, probeController, app };
}

async function startRun(app: ReturnType<typeof createApp>, hash: string, ip: string): Promise<Response> {
  return app.fetch(
    new Request('http://macro.test/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ planHash: hash, turnstileToken: 'ok' }),
    }),
  );
}

async function startProbe(app: ReturnType<typeof createApp>, ip: string): Promise<Response> {
  return app.fetch(
    new Request('http://macro.test/api/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ turnstileToken: 'ok' }),
    }),
  );
}

describe('FIFO run queue', () => {
  test('drains queued runs and probes in strict FIFO order', async () => {
    const { store, hash, runController, probeController, app } = setup();

    const r1 = (await (await startRun(app, hash, '203.0.113.1')).json()) as StartResponse;
    const r2 = (await (await startRun(app, hash, '203.0.113.2')).json()) as StartResponse;
    const p3 = (await (await startProbe(app, '203.0.113.3')).json()) as StartResponse;

    expect(r1.status).toBe('running');
    expect(r1.queuePosition).toBeNull();
    expect(r2.status).toBe('queued');
    expect(r2.queuePosition).toBe(1);
    expect(p3.status).toBe('queued');
    expect(p3.queuePosition).toBe(2);
    expect(runController.started).toEqual([r1.runId]);
    expect(probeController.started).toEqual([]);

    // Complete r1 -> r2 should start automatically.
    runController.complete(r1.runId);
    await new Promise((r) => setTimeout(r, 10));

    expect(runController.started).toEqual([r1.runId, r2.runId]);
    expect(store.getRun(r2.runId)?.status).toBe('running');
    expect(store.getQueuePosition(p3.runId)).toBe(1);

    // Complete r2 -> p3 should start automatically.
    runController.complete(r2.runId);
    await new Promise((r) => setTimeout(r, 10));

    expect(probeController.started).toEqual([p3.runId]);
    expect(store.getRun(p3.runId)?.status).toBe('running');
    store.close();
  });

  test('POST /api/runs/:id/stop cancels a queued run and shifts later positions', async () => {
    const { store, hash, runController, app } = setup();

    const r1 = (await (await startRun(app, hash, '203.0.113.1')).json()) as StartResponse;
    const r2 = (await (await startRun(app, hash, '203.0.113.2')).json()) as StartResponse;
    const r3 = (await (await startRun(app, hash, '203.0.113.3')).json()) as StartResponse;

    const snapBefore = (await (await app.fetch(new Request(`http://macro.test/api/runs/${r3.runId}`))).json()) as RunSnapshot;
    expect(snapBefore.run.status).toBe('queued');
    expect(snapBefore.run.queuePosition).toBe(2);

    const stopRes = await app.fetch(new Request(`http://macro.test/api/runs/${r2.runId}/stop`, { method: 'POST' }));
    expect(stopRes.status).toBe(200);
    expect(((await stopRes.json()) as StopResponse).status).toBe('stopped');

    const snapAfter = (await (await app.fetch(new Request(`http://macro.test/api/runs/${r3.runId}`))).json()) as RunSnapshot;
    expect(snapAfter.run.queuePosition).toBe(1);

    // Completing r1 should skip stopped r2 and start r3.
    runController.complete(r1.runId);
    await new Promise((r) => setTimeout(r, 10));
    expect(runController.started).toEqual([r1.runId, r3.runId]);
    store.close();
  });

  test('rejects with 429 queue_full once MAX_QUEUED_RUNS are waiting', async () => {
    const { store, hash, app } = setup();

    await startRun(app, hash, '203.0.113.1'); // active
    for (let i = 0; i < MAX_QUEUED_RUNS; i++) {
      const res = await startRun(app, hash, `198.51.100.${i + 10}`);
      expect(res.status).toBe(200);
    }

    const overflow = await startRun(app, hash, '198.51.100.250');
    expect(overflow.status).toBe(429);
    expect(((await overflow.json()) as ApiErrorBody).error.code).toBe('queue_full');
    store.close();
  });
});
