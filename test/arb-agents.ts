/**
 * Shared fixtures for the agent, controller, report, and compare tests.
 * Synthetic values only: nothing here reads the environment, the network, or Docker.
 */

import fc from 'fast-check';
import type { Config } from '../src/config.ts';
import { parseConfig } from '../src/config.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
import type { ReportInput, ReportStageRow } from '../src/report/build.ts';
import type { Metrics, RouteId, StageMetrics, TestPlan } from '../src/types.ts';

export const WEB = 'https://yue.macro.my.id';
export const API = 'https://api.yue.macro.my.id';

export const API_KEY = 'test-inference-key-SECRET-1111';

/** A Config built from synthetic settings (never `process.env`). */
export function testConfig(patch: Record<string, string | undefined> = {}): Config {
  const result = parseConfig({
    VULTR_INFERENCE_API_KEY: API_KEY,
    TURNSTILE_SECRET_KEY: 'test-turnstile-secret-2222',
    TURNSTILE_SITE_KEY: 'test-site-key-3333',
    ...patch,
  });
  if (!result.ok) throw new Error(`test config invalid: ${JSON.stringify(result.errors)}`);
  return result.config;
}

/** A Policy_Gate-accepted plan; `patch` overrides top-level fields. */
export function samplePlan(patch: Partial<TestPlan> = {}): TestPlan {
  return {
    name: 'Sample plan',
    target: WEB,
    stages: [
      { vus: 10, durationSec: 30 },
      { vus: 20, durationSec: 30 },
    ],
    journey: [
      { route: 'store_home', probability: 100, thinkMs: 500 },
      { route: 'catalog_list', probability: 80, thinkMs: 500 },
    ],
    stopThresholds: { p95Ms: 1500, errorRatePct: 2 },
    ...patch,
  };
}

export function planWithVus(vus: readonly number[], patch: Partial<TestPlan> = {}): TestPlan {
  return samplePlan({ stages: vus.map((v) => ({ vus: v, durationSec: 30 })), ...patch });
}

export function storedPlan(plan: TestPlan): { hash: string; text: string } {
  const text = printPlan(plan);
  return { hash: planHash(text), text };
}

export function metricsOf(p95: number, errorRatePct = 0, extra: Partial<Metrics> = {}): Metrics {
  return {
    requests: 1000,
    rps: 33.3,
    errorRatePct,
    http429: 0,
    p50: Math.round(p95 / 2),
    p95,
    p99: p95 + 10,
    ...extra,
  };
}

export function stageMetricsOf(overall: Metrics, routes: StageMetrics['routes'] = {}): StageMetrics {
  return { overall, routes };
}

/** A k6 `handleSummary` JSON (overall block only) that `readSummary` accepts. */
export function summaryJson(opts: { p95: number; errorRatePct?: number; count?: number; durationSec?: number }): string {
  const count = opts.count ?? 1000;
  const failedPct = opts.errorRatePct ?? 0;
  const passes = Math.round((count * failedPct) / 100);
  const dur = opts.durationSec ?? 30;
  return JSON.stringify({
    state: { testRunDurationMs: dur * 1000 },
    metrics: {
      http_reqs: { values: { count } },
      http_req_duration: { values: { med: opts.p95 / 2, 'p(95)': opts.p95, 'p(99)': opts.p95 + 10 } },
      http_req_failed: { values: { passes, fails: count - passes, rate: passes / count } },
    },
  });
}

/** `typeof fetch` also carries `preconnect`; fakes are plain functions. */
export function asFetch(fn: (input: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

export function toolCallOf(name: string, args: unknown): unknown {
  return {
    id: `call_${name}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

export function chatResponse(toolCalls: readonly unknown[] | undefined, usage?: Record<string, unknown>): Response {
  const message: Record<string, unknown> = { role: 'assistant', content: null };
  if (toolCalls !== undefined) message['tool_calls'] = toolCalls;
  const body: Record<string, unknown> = { choices: [{ index: 0, message }] };
  if (usage !== undefined) body['usage'] = usage;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A fetch that never answers on its own but rejects when its signal fires. */
export function hangUntilAborted(init: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const signal = init.signal;
    if (signal === undefined || signal === null) return;
    const fail = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Report generators (used by report-ai, report-independence, and compare tests)
// ---------------------------------------------------------------------------

export const ROUTES: readonly RouteId[] = ['store_home', 'catalog_list', 'product_detail', 'ledger', 'order_create', 'health'];

const arbLatency: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.double({ min: 0, max: 4000, noNaN: true, noDefaultInfinity: true }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 4000 }) },
  { weight: 2, arbitrary: fc.constantFrom(0, 0.5, 1.5, 2.5, 1499.5, 1500, 1500.4, 1500.5, 99.5) },
);
const arbPct: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 100 }) },
  { weight: 2, arbitrary: fc.constantFrom(0, 0.05, 0.25, 1.95, 2, 2.04, 2.05, 2.5) },
);
const arbRate: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }) },
  { weight: 2, arbitrary: fc.constantFrom(0, 0.05, 0.25, 33.35, 100.05) },
);

export const arbMetrics: fc.Arbitrary<Metrics> = fc
  .record({
    requests: fc.integer({ min: 1, max: 100_000 }),
    rps: arbRate,
    errorRatePct: arbPct,
    http429: fc.integer({ min: 0, max: 5000 }),
    p50: arbLatency,
    p95: arbLatency,
    p99: arbLatency,
  })
  .map((m) => ({ ...m }));

export const arbStageMetrics: fc.Arbitrary<StageMetrics> = fc
  .tuple(arbMetrics, fc.array(fc.tuple(fc.constantFrom(...ROUTES), arbMetrics), { maxLength: 6 }))
  .map(([overall, routeList]) => {
    const routes: StageMetrics['routes'] = {};
    for (const [id, m] of routeList) routes[id] = m;
    return { overall, routes };
  });

export const REPORT_PLAN = samplePlan({
  stages: [10, 20, 30, 40, 50].map((vus) => ({ vus, durationSec: 30 })),
});

/** Stage rows for indexes 0..n-1: mostly done with metrics, sometimes an error row. */
export const arbStageRows: fc.Arbitrary<ReportStageRow[]> = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 9 }), arbStageMetrics), { minLength: 0, maxLength: 5 })
  .map((items) =>
    items.map(([roll, metrics], i): ReportStageRow => {
      const base = { index: i, vus: (i + 1) * 10, durationSec: 30 };
      if (roll === 0) return { ...base, status: 'error', errorReason: 'Sandbox reported an error.' };
      return { ...base, status: 'done', metrics };
    }),
  );

export function reportInputOf(stages: readonly ReportStageRow[], patch: Partial<ReportInput> = {}): ReportInput {
  return {
    runId: 'run-fixture',
    planHash: 'a'.repeat(64),
    status: 'completed',
    runtime: 'runsc',
    plan: REPORT_PLAN,
    stages,
    decisions: [],
    events: [],
    ...patch,
  };
}
