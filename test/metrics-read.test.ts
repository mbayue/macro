import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { readSummary } from '../src/k6/metrics.ts';
import type { RouteId } from '../src/types.ts';
import { arbGenSummary, buildSummary, expectedMetrics, ROUTE_IDS } from './arb-run.ts';

function read(summary: unknown): ReturnType<typeof readSummary> {
  return readSummary(JSON.stringify(summary));
}

describe('Property 11: Metrics_Reader recovers generated summary values', () => {
  test('counts, latencies, error rate, rps, per-route entries and the 429 count are recovered', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, (g) => {
        const got = read(buildSummary(g));
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        const want = expectedMetrics(g);

        expect(got.metrics.overall).toEqual(want.overall);
        // Per-route entries exist exactly for routes with a positive request count.
        const expectedRoutes = ROUTE_IDS.filter((id) => (g.routes[id]?.count ?? 0) > 0);
        expect(Object.keys(got.metrics.routes).sort()).toEqual([...expectedRoutes].sort());
        for (const id of expectedRoutes) expect(got.metrics.routes[id]).toEqual(want.routes[id]);

        // The statements of the property, spelled out.
        expect(got.metrics.overall.requests).toBe(g.overall.count);
        expect(got.metrics.overall.errorRatePct).toBe((g.overall.failed / g.overall.count) * 100);
        expect(got.metrics.overall.rps).toBe(g.overall.count / (g.durationMs / 1000));
        expect(got.metrics.overall.http429).toBe(g.overall.m429 ?? 0);
        expect(got.metrics.overall.p50).toBe(g.overall.p50);
        expect(got.metrics.overall.p95).toBe(g.overall.p95);
        expect(got.metrics.overall.p99).toBe(g.overall.p99);
      }),
      { numRuns: 500 },
    );
  });

  test('every recovered value is a finite number >= 0', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, (g) => {
        const got = read(buildSummary(g));
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        for (const m of [got.metrics.overall, ...Object.values(got.metrics.routes)]) {
          if (m === undefined) continue;
          for (const v of Object.values(m)) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
          expect(m.requests).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('an absent macro_429 counter reads as 0, overall and per route', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, (g) => {
        const stripped = {
          ...g,
          overall: { ...g.overall, m429: undefined },
          routes: Object.fromEntries(Object.entries(g.routes).map(([id, b]) => [id, { ...b, m429: undefined }])),
        };
        const got = read(buildSummary(stripped));
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        expect(got.metrics.overall.http429).toBe(0);
        for (const m of Object.values(got.metrics.routes)) {
          if (m === undefined) continue;
          expect(m.http429).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('per-route values come only from the route-tagged metrics', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, fc.constantFrom(...ROUTE_IDS), (g, id) => {
        // Give one route a count of its own and make sure the overall values do not leak into it.
        const routeBlock = { ...g.overall, count: g.overall.count + 7, failed: 0, p50: 1.25, p95: 2.5, p99: 3.75, m429: 3 };
        const got = read(buildSummary({ ...g, routes: { ...g.routes, [id]: routeBlock } }));
        expect(got.ok).toBe(true);
        if (!got.ok) return;
        const m = got.metrics.routes[id as RouteId];
        expect(m?.requests).toBe(routeBlock.count);
        expect(m?.errorRatePct).toBe(0);
        expect(m?.p95).toBe(2.5);
        expect(m?.http429).toBe(3);
        expect(got.metrics.overall.p95).toBe(g.overall.p95);
      }),
      { numRuns: 100 },
    );
  });

  test('a route sub-metric with a zero count is omitted', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, fc.constantFrom(...ROUTE_IDS), (g, id) => {
        const zero = { ...g.overall, count: 0, failed: 0 };
        const got = read(buildSummary({ ...g, routes: { ...g.routes, [id]: zero } }));
        expect(got.ok).toBe(true);
        if (got.ok) expect(id in got.metrics.routes).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  test('real k6 v2 summary shape: a hand-written example reads to known values', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    const summary = {
      state: { isStdOutTTY: false, isStdErrTTY: false, testRunDurationMs: 60_250.5 },
      options: { summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'] },
      root_group: { name: '', path: '', id: 'd41d8cd98f00b204e9800998ecf8427e', groups: [], checks: [] },
      metrics: {
        http_reqs: { type: 'counter', contains: 'default', values: { count: 1205, rate: 20 } },
        http_req_duration: { type: 'trend', contains: 'time', values: { avg: 120, min: 10, med: 90.5, max: 900, 'p(95)': 321.4, 'p(99)': 640 } },
        http_req_failed: { type: 'rate', contains: 'default', values: { rate: 0.05, passes: 60, fails: 1145 } },
        macro_429: { type: 'counter', contains: 'default', values: { count: 4, rate: 0 } },
        'http_reqs{route:health}': { type: 'counter', contains: 'default', values: { count: 200, rate: 3 } },
        'http_req_duration{route:health}': { type: 'trend', contains: 'time', values: { med: 20, 'p(95)': 30, 'p(99)': 40 } },
        'http_req_failed{route:health}': { type: 'rate', contains: 'default', values: { rate: 0, passes: 0, fails: 200 } },
      },
    };
    const got = read(summary);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.metrics.overall).toEqual({
      requests: 1205,
      rps: 1205 / 60.2505,
      errorRatePct: (60 / 1205) * 100,
      http429: 4,
      p50: 90.5,
      p95: 321.4,
      p99: 640,
    });
    expect(Object.keys(got.metrics.routes)).toEqual(['health']);
    expect(got.metrics.routes.health).toEqual({
      requests: 200,
      rps: 200 / 60.2505,
      errorRatePct: 0,
      http429: 0,
      p50: 20,
      p95: 30,
      p99: 40,
    });
  });

  test('unknown routes, unrelated metrics, and extra fields are ignored', () => {
    // Feature: macro, Property 11: Metrics_Reader recovers generated summary values
    fc.assert(
      fc.property(arbGenSummary, (g) => {
        const withNoise = read(buildSummary({ ...g, noise: true }));
        const without = read(buildSummary({ ...g, noise: false }));
        expect(withNoise).toEqual(without);
        expect(withNoise.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
