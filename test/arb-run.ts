// Generators for k6 end-of-test summaries in the shape that src/k6/metrics.ts reads
// (`handleSummary(data)`: `state.testRunDurationMs` and `metrics[name].values`).
// Used by test/metrics-read.test.ts and test/metrics-reject.test.ts.

import fc from 'fast-check';
import { ROUTE_CATALOG } from '../src/plan/catalog.ts';
import type { Metrics, RouteId, StageMetrics } from '../src/types.ts';

export const ROUTE_IDS: readonly RouteId[] = ROUTE_CATALOG.map((r) => r.id);

/** How the http_req_failed metric is written. */
export type FailedStyle = 'full' | 'rate-only';

/** Which key carries the median. */
export type MedianKey = 'med' | 'p(50)';

export interface GenBlock {
  /** Request count (integer >= 0). */
  count: number;
  /** Failed requests, 0..count. */
  failed: number;
  p50: number;
  p95: number;
  p99: number;
  /** HTTP 429 count; undefined = the macro_429 counter is absent. */
  m429: number | undefined;
  failedStyle: FailedStyle;
  medianKey: MedianKey;
}

export interface GenSummary {
  durationMs: number;
  overall: GenBlock;
  routes: Partial<Record<RouteId, GenBlock>>;
  /** Unrelated metrics, unknown routes, and unknown top-level keys that must be ignored. */
  noise: boolean;
}

const arbLatency: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  fc.integer({ min: 0, max: 100_000 }),
  fc.constantFrom(0, 0.5, 2.5, 99.5, 1e-9),
);

function arbBlock(minCount: number): fc.Arbitrary<GenBlock> {
  return fc
    .record({
      count: fc.integer({ min: minCount, max: 2_000_000 }),
      failedFrac: fc.double({ min: 0, max: 1, noNaN: true }),
      p50: arbLatency,
      p95: arbLatency,
      p99: arbLatency,
      m429: fc.option(fc.integer({ min: 0, max: 2_000_000 }), { nil: undefined }),
      failedStyle: fc.constantFrom<FailedStyle>('full', 'rate-only'),
      medianKey: fc.constantFrom<MedianKey>('med', 'p(50)'),
    })
    .map(({ failedFrac, ...rest }) => ({ ...rest, failed: Math.min(rest.count, Math.floor(failedFrac * rest.count)) }));
}

const arbRouteBlocks: fc.Arbitrary<Partial<Record<RouteId, GenBlock>>> = fc
  .tuple(...ROUTE_IDS.map(() => fc.option(arbBlock(0), { nil: undefined })))
  .map((blocks) => {
    const out: Partial<Record<RouteId, GenBlock>> = {};
    ROUTE_IDS.forEach((id, i) => {
      const b = blocks[i];
      if (b !== undefined) out[id] = b;
    });
    return out;
  });

export const arbGenSummary: fc.Arbitrary<GenSummary> = fc.record({
  durationMs: fc.oneof(fc.double({ min: 1, max: 3_600_000, noNaN: true }), fc.integer({ min: 1, max: 600_000 })),
  overall: arbBlock(1),
  routes: arbRouteBlocks,
  noise: fc.boolean(),
});

function blockMetrics(suffix: string, b: GenBlock): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out[`http_reqs${suffix}`] = { type: 'counter', contains: 'default', values: { count: b.count, rate: b.count / 60 } };
  const dur: Record<string, number> = { avg: b.p50, min: 0, max: Math.max(b.p50, b.p95, b.p99), 'p(95)': b.p95, 'p(99)': b.p99 };
  dur[b.medianKey] = b.p50;
  out[`http_req_duration${suffix}`] = { type: 'trend', contains: 'time', values: dur };
  const rate = b.count === 0 ? 0 : b.failed / b.count;
  out[`http_req_failed${suffix}`] =
    b.failedStyle === 'full'
      ? { type: 'rate', contains: 'default', values: { rate, passes: b.failed, fails: b.count - b.failed } }
      : { type: 'rate', contains: 'default', values: { rate } };
  if (b.m429 !== undefined) {
    out[`macro_429${suffix}`] = { type: 'counter', contains: 'default', values: { count: b.m429, rate: 0 } };
  }
  return out;
}

/** Build the parsed summary object (not yet serialised). */
export function buildSummary(g: GenSummary): Record<string, unknown> {
  const metrics: Record<string, unknown> = { ...blockMetrics('', g.overall) };
  for (const id of ROUTE_IDS) {
    const b = g.routes[id];
    if (b === undefined) continue;
    if (b.count === 0) {
      // k6 can emit a tagged sub-metric with a zero count.
      metrics[`http_reqs{route:${id}}`] = { type: 'counter', contains: 'default', values: { count: 0, rate: 0 } };
    } else {
      Object.assign(metrics, blockMetrics(`{route:${id}}`, b));
    }
  }
  const summary: Record<string, unknown> = { state: { testRunDurationMs: g.durationMs, isStdOutTTY: false }, metrics };
  if (g.noise) {
    metrics['vus'] = { type: 'gauge', contains: 'default', values: { value: 5, min: 1, max: 5 } };
    metrics['iterations'] = { type: 'counter', contains: 'default', values: { count: 12, rate: 0.2 } };
    metrics['http_reqs{route:not_in_catalog}'] = { type: 'counter', contains: 'default', values: { count: 99999, rate: 1 } };
    metrics['http_req_duration{route:not_in_catalog}'] = { type: 'trend', contains: 'time', values: { med: 1, 'p(95)': 2, 'p(99)': 3 } };
    metrics['http_req_failed{route:not_in_catalog}'] = { type: 'rate', contains: 'default', values: { rate: 1 } };
    summary['root_group'] = { name: '', path: '', id: 'abc', groups: [], checks: [] };
    summary['options'] = { summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'] };
  }
  return summary;
}

function expectedBlock(b: GenBlock, durationMs: number): Metrics {
  const rate = b.failed / b.count;
  return {
    requests: b.count,
    rps: b.count / (durationMs / 1000),
    errorRatePct: rate * 100,
    http429: b.m429 ?? 0,
    p50: b.p50,
    p95: b.p95,
    p99: b.p99,
  };
}

/** What readSummary must return for a generated summary. */
export function expectedMetrics(g: GenSummary): StageMetrics {
  const routes: Partial<Record<RouteId, Metrics>> = {};
  for (const id of ROUTE_IDS) {
    const b = g.routes[id];
    if (b !== undefined && b.count > 0) routes[id] = expectedBlock(b, g.durationMs);
  }
  return { overall: expectedBlock(g.overall, g.durationMs), routes };
}
