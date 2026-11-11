import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ROUTE_CATALOG } from '../src/plan/catalog.ts';
import { breakingPoint, firstDegradedRoute, safeCapacity, stageVerdict } from '../src/run/verdict.ts';
import type { Metrics, RouteId, StageMetrics, StageResult, StageVerdict } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Reference model, written from the requirements and glossary (7.4, 7.5, 10.3, 10.4, 10.11).
//
// All values are generated as integer THOUSANDTHS so that rounding is done in exact integer
// arithmetic: nothing here depends on binary floating point. The system under test receives
// the closest double to each decimal value (t / 1000), which is what k6 JSON would carry.
//
//   latency shown      = round half away from zero to whole ms
//   error rate shown   = round half away from zero to one decimal
//   a Stage fails when shown p95 > p95Ms threshold OR shown error rate > errorRatePct threshold
// ---------------------------------------------------------------------------

interface RefMetrics {
  p95Milli: number; // thousandths of a millisecond
  errMilli: number; // thousandths of a percent
}

interface RefThresholds {
  p95Ms: number; // whole ms
  errMilli: number; // thousandths of a percent
}

/** Whole ms, round half away from zero (inputs are non-negative). */
const shownMs = (milli: number): number => Math.floor((milli + 500) / 1000);
/** Tenths of a percent, round half away from zero. */
const shownTenths = (milli: number): number => Math.floor((milli + 50) / 100);

function refExceeds(m: RefMetrics, t: RefThresholds): boolean {
  // shown error rate in thousandths = tenths * 100
  return shownMs(m.p95Milli) > t.p95Ms || shownTenths(m.errMilli) * 100 > t.errMilli;
}

interface RefStage {
  vus: number;
  overall: RefMetrics;
  routes: Partial<Record<RouteId, RefMetrics>>;
}

function refSafeCapacity(verdicts: readonly boolean[], vus: readonly number[]): number | null {
  let last: number | null = null;
  for (let i = 0; i < verdicts.length; i++) {
    if (verdicts[i] === true) break; // true = fail
    last = vus[i] ?? null;
  }
  return last;
}

function refBreakingPoint(verdicts: readonly boolean[], vus: readonly number[]): number | null {
  const i = verdicts.findIndex((failed) => failed);
  return i < 0 ? null : (vus[i] ?? null);
}

function refFirstDegraded(stages: readonly RefStage[], t: RefThresholds): RouteId | null {
  for (const stage of stages) {
    const over: { id: RouteId; p95: number; order: number }[] = [];
    ROUTE_CATALOG.forEach((entry, order) => {
      const m = stage.routes[entry.id];
      if (m !== undefined && refExceeds(m, t)) over.push({ id: entry.id, p95: shownMs(m.p95Milli), order });
    });
    if (over.length === 0) continue;
    over.sort((x, y) => y.p95 - x.p95 || x.order - y.order);
    return over[0]?.id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const toMetrics = (m: RefMetrics, salt: number): Metrics => ({
  requests: 100 + salt,
  rps: 5 + salt / 10,
  errorRatePct: m.errMilli / 1000,
  http429: 0,
  p50: m.p95Milli / 2000,
  p95: m.p95Milli / 1000,
  p99: m.p95Milli / 1000 + 1,
});

const ROUTE_IDS: readonly RouteId[] = ROUTE_CATALOG.map((r) => r.id);

const arbThresholds: fc.Arbitrary<RefThresholds> = fc.record({
  p95Ms: fc.oneof(fc.integer({ min: 100, max: 5000 }), fc.constantFrom(100, 101, 500, 5000)),
  errMilli: fc.oneof(fc.integer({ min: 100, max: 20_000 }), fc.constantFrom(100, 150, 5000, 5050, 20_000)),
});

/** Thousandths clustered around a rounding boundary of the threshold, plus wide random values. */
function arbNear(boundaryMilli: number, unitMilli: number, max: number): fc.Arbitrary<number> {
  const edge = fc
    .tuple(fc.integer({ min: -2, max: 2 }), fc.constantFrom(-501, -500, -499, -1, 0, 1, 499, 500, 501))
    .map(([k, off]) => Math.max(0, Math.min(max, boundaryMilli + k * unitMilli + off)));
  return fc.oneof(edge, edge, fc.integer({ min: 0, max }));
}

function arbRefMetrics(t: RefThresholds): fc.Arbitrary<RefMetrics> {
  return fc.record({
    p95Milli: arbNear(t.p95Ms * 1000, 1000, 10_000_000),
    errMilli: arbNear(t.errMilli, 100, 100_000),
  });
}

/** Route metrics drawn from a small pool so that rounded p95 ties are common. */
function arbRouteMetrics(t: RefThresholds): fc.Arbitrary<RefMetrics> {
  const pool = [t.p95Ms - 1, t.p95Ms, t.p95Ms + 1, t.p95Ms + 7, 3 * t.p95Ms];
  return fc.oneof(
    arbRefMetrics(t),
    fc.record({
      p95Milli: fc.constantFrom(...pool).chain((ms) => fc.constantFrom(ms * 1000 - 499, ms * 1000, ms * 1000 + 499)),
      errMilli: fc.constantFrom(0, 100, t.errMilli, t.errMilli + 50, t.errMilli + 100, 99_000),
    }),
  );
}

interface Scenario {
  t: RefThresholds;
  stages: RefStage[];
}

/** Values that the verdict rules accept, up to and including the rounding edge of the threshold. */
function arbCalm(t: RefThresholds): fc.Arbitrary<RefMetrics> {
  return fc.record({
    p95Milli: fc.integer({ min: 0, max: t.p95Ms * 1000 + 499 }),
    errMilli: fc.integer({ min: 0, max: Math.floor(t.errMilli / 100) * 100 + 49 }),
  });
}

/** Per-metric mix: mostly calm, some on the rounding edge, some far over. */
function arbMixed(t: RefThresholds): fc.Arbitrary<RefMetrics> {
  return fc.oneof(
    { weight: 4, arbitrary: arbCalm(t) },
    { weight: 2, arbitrary: arbRefMetrics(t) },
    { weight: 1, arbitrary: arbRouteMetrics(t) },
  );
}

const arbScenario: fc.Arbitrary<Scenario> = fc.tuple(arbThresholds, fc.constantFrom('calm', 'mixed', 'mixed')).chain(([t, mode]) => {
  const arbOne = mode === 'calm' ? arbCalm(t) : arbMixed(t);
  const arbRoute = mode === 'calm' ? arbCalm(t) : arbMixed(t);
  return fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 6 }),
      fc.array(
        fc.record({
          overall: arbOne,
          routes: fc.tuple(...ROUTE_IDS.map(() => fc.option(arbRoute, { nil: undefined }))),
        }),
        { minLength: 6, maxLength: 6 },
      ),
    )
    .map(([vus, raw]) => ({
      t,
      stages: [...vus]
        .sort((a, b) => a - b)
        .map((v, i): RefStage => {
          const r = raw[i];
          const routes: Partial<Record<RouteId, RefMetrics>> = {};
          ROUTE_IDS.forEach((id, k) => {
            const m = r?.routes[k];
            if (m !== undefined) routes[id] = m;
          });
          return { vus: v, overall: r?.overall ?? { p95Milli: 0, errMilli: 0 }, routes };
        }),
    }));
});
function toStageMetrics(s: RefStage, salt: number): StageMetrics {
  const routes: Partial<Record<RouteId, Metrics>> = {};
  for (const id of ROUTE_IDS) {
    const m = s.routes[id];
    if (m !== undefined) routes[id] = toMetrics(m, salt);
  }
  return { overall: toMetrics(s.overall, salt), routes };
}

const sutThresholds = (t: RefThresholds): { p95Ms: number; errorRatePct: number } => ({
  p95Ms: t.p95Ms,
  errorRatePct: t.errMilli / 1000,
});

describe('Property 14: verdict and capacity values match a reference', () => {
  test('stageVerdict compares rounded overall p95 and error rate with the Stop_Thresholds', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    fc.assert(
      fc.property(arbThresholds.chain((t) => fc.tuple(fc.constant(t), arbRefMetrics(t))), ([t, m]) => {
        const got = stageVerdict(toMetrics(m, 0), sutThresholds(t));
        expect(got).toBe(refExceeds(m, t) ? 'fail' : 'pass');
      }),
      { numRuns: 2000 },
    );
  });

  test('stageVerdict, safeCapacity, breakingPoint and firstDegradedRoute equal the reference over Stage sequences', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    fc.assert(
      fc.property(arbScenario, ({ t, stages }) => {
        const thresholds = sutThresholds(t);
        const results: StageResult[] = stages.map((s, i) => {
          const metrics = toStageMetrics(s, i);
          return {
            index: i + 1,
            vus: s.vus,
            durationSec: 60,
            metrics,
            verdict: stageVerdict(metrics.overall, thresholds),
          };
        });

        const refFailed = stages.map((s) => refExceeds(s.overall, t));
        const vus = stages.map((s) => s.vus);
        expect(results.map((r) => r.verdict)).toEqual(refFailed.map((f): StageVerdict => (f ? 'fail' : 'pass')));

        expect(safeCapacity(results) ?? null).toBe(refSafeCapacity(refFailed, vus));
        expect(breakingPoint(results) ?? null).toBe(refBreakingPoint(refFailed, vus));
        expect(firstDegradedRoute(results, thresholds) ?? null).toBe(refFirstDegraded(stages, t));
      }),
      { numRuns: 1500 },
    );
  });

  test('Safe_Capacity is the last Stage of the leading run of passes; Breaking_Point is the first failure', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 0, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        (vusRaw, flags) => {
          const vus = [...vusRaw].sort((a, b) => a - b);
          const stages = vus.map((v, i) => ({ vus: v, verdict: (flags[i] ? 'fail' : 'pass') as StageVerdict }));
          const failed = vus.map((_, i) => flags[i] === true);
          expect(safeCapacity(stages) ?? null).toBe(refSafeCapacity(failed, vus));
          expect(breakingPoint(stages) ?? null).toBe(refBreakingPoint(failed, vus));
          // Statements of Requirements 10.3 and 10.4.
          if (stages[0]?.verdict === 'fail') expect(safeCapacity(stages)).toBeUndefined();
          if (stages.every((s) => s.verdict === 'pass')) {
            expect(breakingPoint(stages)).toBeUndefined();
            expect(safeCapacity(stages)).toBe(vus.at(-1));
          }
          // Safe_Capacity is always below Breaking_Point when both exist.
          const safe = safeCapacity(stages);
          const brk = breakingPoint(stages);
          if (safe !== undefined && brk !== undefined) expect(safe).toBeLessThan(brk);
        },
      ),
      { numRuns: 500 },
    );
  });

  test('a pass after a failure does not extend Safe_Capacity', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    const stages = [
      { vus: 10, verdict: 'pass' as const },
      { vus: 20, verdict: 'fail' as const },
      { vus: 40, verdict: 'pass' as const },
    ];
    expect(safeCapacity(stages)).toBe(10);
    expect(breakingPoint(stages)).toBe(20);
    expect(safeCapacity([])).toBeUndefined();
    expect(breakingPoint([])).toBeUndefined();
  });

  test('First_Degraded_Route: earliest Stage first, highest rounded p95 within it, catalog order breaks ties', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    const t = { p95Ms: 500, errorRatePct: 5 };
    const m = (p95: number, err = 0): Metrics => ({ requests: 10, rps: 1, errorRatePct: err, http429: 0, p50: 1, p95, p99: p95 });
    const stage = (routes: Partial<Record<RouteId, Metrics>>): { metrics: StageMetrics } => ({
      metrics: { overall: m(1), routes },
    });

    // None exceed.
    expect(firstDegradedRoute([stage({ health: m(500.4), ledger: m(10, 5.04) })], t)).toBeUndefined();
    // Rounded p95 500.5 -> 501 exceeds, 500.4 -> 500 does not.
    expect(firstDegradedRoute([stage({ health: m(500.5), ledger: m(500.4) })], t)).toBe('health');
    // Error rate 5.05 shows as 5.1 and exceeds; 5.04 shows 5.0 and does not.
    expect(firstDegradedRoute([stage({ ledger: m(1, 5.05) })], t)).toBe('ledger');
    expect(firstDegradedRoute([stage({ ledger: m(1, 5.04) })], t)).toBeUndefined();
    // Highest rounded p95 wins over catalog order.
    expect(firstDegradedRoute([stage({ store_home: m(600), ledger: m(900), health: m(700) })], t)).toBe('ledger');
    // Equal rounded p95 (600.4 and 599.6 both show 600): earlier catalog entry wins, whichever is larger raw.
    expect(firstDegradedRoute([stage({ health: m(600.4), catalog_list: m(599.6) })], t)).toBe('catalog_list');
    expect(firstDegradedRoute([stage({ order_create: m(700), product_detail: m(700) })], t)).toBe('product_detail');
    // The earliest Stage with an exceeding route decides, even if a later Stage has a worse route.
    expect(
      firstDegradedRoute([stage({ health: m(100) }), stage({ ledger: m(550) }), stage({ store_home: m(9000) })], t),
    ).toBe('ledger');
    // A route exceeding only by error rate counts too.
    expect(firstDegradedRoute([stage({ health: m(10, 50), ledger: m(10, 1) })], t)).toBe('health');
    expect(firstDegradedRoute([], t)).toBeUndefined();
  });

  test('stageVerdict boundary examples (rounded values, inclusive thresholds)', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    const t = { p95Ms: 500, errorRatePct: 5 };
    const m = (p95: number, err: number): Metrics => ({ requests: 10, rps: 1, errorRatePct: err, http429: 0, p50: 1, p95, p99: p95 });
    expect(stageVerdict(m(500, 5), t)).toBe('pass');
    expect(stageVerdict(m(500.49, 5.049), t)).toBe('pass');
    expect(stageVerdict(m(500.5, 5), t)).toBe('fail');
    expect(stageVerdict(m(500, 5.05), t)).toBe('fail');
    expect(stageVerdict(m(0, 0), t)).toBe('pass');
    expect(stageVerdict(m(499.5, 4.95), t)).toBe('pass');
  });

  test('the same inputs always give the same outputs (pure)', () => {
    // Feature: macro, Property 14: Verdict and capacity values match a reference
    fc.assert(
      fc.property(arbScenario, ({ t, stages }) => {
        const thresholds = sutThresholds(t);
        const sm = stages.map((s, i) => toStageMetrics(s, i));
        const once = firstDegradedRoute(sm.map((metrics) => ({ metrics })), thresholds);
        const twice = firstDegradedRoute(sm.map((metrics) => ({ metrics })), thresholds);
        expect(twice).toBe(once);
        if (once !== undefined) expect(ROUTE_IDS as readonly string[]).toContain(once);
      }),
      { numRuns: 100 },
    );
  });
});
