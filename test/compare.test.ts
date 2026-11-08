import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { DIFFERENT_PLAN_MESSAGE, NOT_AVAILABLE, NOT_RUN, compareRuns } from '../src/report/compare.ts';
import type { CompareInput, MetricsComparison, ValueComparison } from '../src/report/compare.ts';
import { buildReport } from '../src/report/build.ts';
import type { MetricsView, ReportStageRow } from '../src/report/build.ts';
import { ROUTES, arbStageRows, metricsOf, reportInputOf, stageMetricsOf } from './arb-agents.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function input(runId: string, startedAt: number, rows: readonly ReportStageRow[], planHash = HASH_A): CompareInput {
  return { runId, planHash, startedAt, report: buildReport(reportInputOf(rows, { runId, planHash })) };
}

// ---- independent reference: integer arithmetic on the DISPLAYED strings ------------

type Kind = 'p95' | 'err' | 'rps';

/** Displayed text → integer in display units (whole ms, or tenths). */
function units(display: string): number {
  return Number(display.replace('%', '').replace('.', ''));
}

function unitText(u: number, kind: Kind): string {
  const abs = Math.abs(u);
  const body = kind === 'p95' ? String(abs) : `${Math.floor(abs / 10)}.${abs % 10}`;
  return kind === 'err' ? `${body}%` : body;
}

const signOf = (n: number): string => (n > 0 ? '+' : n < 0 ? '-' : '');

function refValue(kind: Kind, base: string | undefined, later: string | undefined): ValueComparison {
  const baseline = base ?? NOT_RUN;
  const laterText = later ?? NOT_RUN;
  if (base === undefined || later === undefined) return { baseline, later: laterText, difference: null, percentChange: null };
  const b = units(base);
  const l = units(later);
  if (b === 0) return { baseline, later: laterText, difference: NOT_AVAILABLE, percentChange: NOT_AVAILABLE };
  const diff = l - b;
  // percent*10 = diff/b*1000, rounded half away from zero, in exact integer arithmetic (b > 0).
  const pctTenths = Math.sign(diff) * Math.floor((2 * Math.abs(diff) * 1000 + b) / (2 * b));
  return {
    baseline,
    later: laterText,
    difference: `${signOf(diff)}${unitText(diff, kind)}`,
    percentChange: `${signOf(pctTenths)}${Math.floor(Math.abs(pctTenths) / 10)}.${Math.abs(pctTenths) % 10}%`,
  };
}

function refMetrics(base: MetricsView | null | undefined, later: MetricsView | null | undefined): MetricsComparison {
  return {
    p95Ms: refValue('p95', base?.display.p95, later?.display.p95),
    errorRatePct: refValue('err', base?.display.errorRatePct, later?.display.errorRatePct),
    rps: refValue('rps', base?.display.rps, later?.display.rps),
  };
}

// ---- generators --------------------------------------------------------------------

const arbRun = fc.record({
  rows: arbStageRows,
  startedAt: fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
});

describe('Property 25: Run comparison', () => {
  test('Runs with different Plan_Hashes show no values', () => {
    // Feature: macro, Property 25: Run comparison
    fc.assert(
      fc.property(arbRun, arbRun, (a, b) => {
        const result = compareRuns(input('run-a', a.startedAt, a.rows, HASH_A), input('run-b', b.startedAt, b.rows, HASH_B));
        expect(result).toEqual({ kind: 'different_plan', message: DIFFERENT_PLAN_MESSAGE });
        expect(DIFFERENT_PLAN_MESSAGE).toContain('same approved Test_Plan');
      }),
      { numRuns: 100 },
    );
  });

  test('baseline is the earlier Run; differences and percent changes match the reference on displayed values', () => {
    // Feature: macro, Property 25: Run comparison
    fc.assert(
      fc.property(arbRun, arbRun, fc.boolean(), (a, b, swap) => {
        fc.pre(a.startedAt !== b.startedAt);
        const runA = input('run-a', a.startedAt, a.rows);
        const runB = input('run-b', b.startedAt, b.rows);
        const result = swap ? compareRuns(runB, runA) : compareRuns(runA, runB);
        if (result.kind !== 'ok') throw new Error('same plan must compare');

        const [early, late] = a.startedAt < b.startedAt ? [runA, runB] : [runB, runA];
        expect(result.baseline.runId).toBe(early.runId);
        expect(result.later.runId).toBe(late.runId);

        // Headline display rules.
        const h = (r: CompareInput) => ({
          safe: r.report.headline.safeCapacity === null ? 'none' : String(r.report.headline.safeCapacity),
          breaking: r.report.headline.breakingPoint === null ? 'not reached' : String(r.report.headline.breakingPoint),
          route: r.report.headline.firstDegradedRoute ?? 'none',
        });
        expect(result.headline.safeCapacity).toEqual({ baseline: h(early).safe, later: h(late).safe });
        expect(result.headline.breakingPoint).toEqual({ baseline: h(early).breaking, later: h(late).breaking });
        expect(result.headline.firstDegradedRoute).toEqual({ baseline: h(early).route, later: h(late).route });

        // Stage coverage: the union of indexes, ascending.
        const idx = (r: CompareInput): number[] => r.report.stages.map((s) => s.index);
        const union = [...new Set([...idx(early), ...idx(late)])].sort((x, y) => x - y);
        expect(result.stages.map((s) => s.index)).toEqual(union);

        for (const stage of result.stages) {
          const bs = early.report.stages.find((s) => s.index === stage.index);
          const ls = late.report.stages.find((s) => s.index === stage.index);
          expect(stage.vus).toBe((bs ?? ls)?.vus as number);
          expect(stage.displayIndex).toBe(stage.index + 1);
          expect(stage.overall).toEqual(refMetrics(bs?.overall, ls?.overall));

          // Routes: catalog order, those with metrics in at least one Run.
          const expectedRoutes = ROUTES.filter(
            (id) => bs?.routes.some((r) => r.route === id) === true || ls?.routes.some((r) => r.route === id) === true,
          );
          expect(stage.routes.map((r) => r.route)).toEqual(expectedRoutes);
          for (const row of stage.routes) {
            const br = bs?.routes.find((r) => r.route === row.route);
            const lr = ls?.routes.find((r) => r.route === row.route);
            const { route: _route, ...values } = row;
            expect(values).toEqual(refMetrics(br, lr));
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  test('one-sided rows show not run and no difference or percent change', () => {
    // Feature: macro, Property 25: Run comparison
    fc.assert(
      fc.property(arbRun, arbRun, (a, b) => {
        fc.pre(a.startedAt < b.startedAt);
        const result = compareRuns(input('run-a', a.startedAt, a.rows), input('run-b', b.startedAt, b.rows));
        if (result.kind !== 'ok') throw new Error('same plan must compare');
        const rows = result.stages.flatMap((s) => [s.overall, ...s.routes]);
        for (const row of rows) {
          for (const v of [row.p95Ms, row.errorRatePct, row.rps]) {
            const oneSided = v.baseline === NOT_RUN || v.later === NOT_RUN;
            if (oneSided) {
              expect(v.difference).toBeNull();
              expect(v.percentChange).toBeNull();
            } else {
              expect(v.difference).not.toBeNull();
              expect(v.percentChange).not.toBeNull();
            }
            // "n/a" only ever appears when both sides have a value and the baseline reads zero.
            if (v.difference === NOT_AVAILABLE) {
              expect(v.percentChange).toBe(NOT_AVAILABLE);
              expect(units(v.baseline)).toBe(0);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('compareRuns examples', () => {
  const stage = (index: number, p95: number, err: number, rps: number, routes = {}): ReportStageRow => ({
    index,
    vus: (index + 1) * 10,
    durationSec: 30,
    status: 'done',
    metrics: stageMetricsOf(metricsOf(p95, err, { rps }), routes),
  });

  test('differences use the rounded displayed values, signed, with one-decimal percent change', () => {
    const base = input('r1', 1000, [stage(0, 100.4, 1.04, 10.04)]); // shows 100, 1.0%, 10.0
    const later = input('r2', 2000, [stage(0, 149.5, 1.96, 12.55)]); // shows 150, 2.0%, 12.6 (half away)
    const result = compareRuns(base, later);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const o = result.stages[0]?.overall as MetricsComparison;
    expect(o.p95Ms).toEqual({ baseline: '100', later: '150', difference: '+50', percentChange: '+50.0%' });
    expect(o.errorRatePct).toEqual({ baseline: '1.0%', later: '2.0%', difference: '+1.0%', percentChange: '+100.0%' });
    expect(o.rps).toEqual({ baseline: '10.0', later: '12.6', difference: '+2.6', percentChange: '+26.0%' });
  });

  test('a decrease is negative and an unchanged value reads 0 and 0.0%', () => {
    const base = input('r1', 1000, [stage(0, 200, 4, 20)]);
    const later = input('r2', 2000, [stage(0, 150, 4, 20)]);
    const result = compareRuns(base, later);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const o = result.stages[0]?.overall as MetricsComparison;
    expect(o.p95Ms).toMatchObject({ difference: '-50', percentChange: '-25.0%' });
    expect(o.errorRatePct).toMatchObject({ difference: '0.0%', percentChange: '0.0%' });
    expect(o.rps).toMatchObject({ difference: '0.0', percentChange: '0.0%' });
  });

  test('a baseline of zero gives n/a for both difference and percent change', () => {
    const base = input('r1', 1000, [stage(0, 100, 0, 10)]);
    const later = input('r2', 2000, [stage(0, 100, 3, 10)]);
    const result = compareRuns(base, later);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const o = result.stages[0]?.overall as MetricsComparison;
    expect(o.errorRatePct).toEqual({ baseline: '0.0%', later: '3.0%', difference: 'n/a', percentChange: 'n/a' });
    expect(o.p95Ms.difference).toBe('0');
  });

  test('a baseline that rounds to zero is n/a even when the raw value is not', () => {
    const base = input('r1', 1000, [stage(0, 100, 0.04, 10)]); // shows 0.0%
    const later = input('r2', 2000, [stage(0, 100, 1, 10)]);
    const result = compareRuns(base, later);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect((result.stages[0]?.overall as MetricsComparison).errorRatePct).toMatchObject({ baseline: '0.0%', difference: 'n/a', percentChange: 'n/a' });
  });

  test('stages and routes present in one Run only are not run, with no difference', () => {
    const base = input('r1', 1000, [stage(0, 100, 1, 10, { store_home: metricsOf(90) }), stage(1, 200, 1, 20)]);
    const later = input('r2', 2000, [stage(0, 110, 1, 10, { ledger: metricsOf(95) })]);
    const result = compareRuns(base, later);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.stages.map((s) => s.index)).toEqual([0, 1]);
    const s0 = result.stages[0];
    expect(s0?.routes.map((r) => r.route)).toEqual(['store_home', 'ledger']);
    expect(s0?.routes[0]?.p95Ms).toEqual({ baseline: '90', later: NOT_RUN, difference: null, percentChange: null });
    expect(s0?.routes[1]?.p95Ms).toEqual({ baseline: NOT_RUN, later: '95', difference: null, percentChange: null });
    expect(result.stages[1]?.overall.p95Ms).toEqual({ baseline: '200', later: NOT_RUN, difference: null, percentChange: null });
    expect(result.stages[1]?.vus).toBe(20);
  });

  test('a Stage that errored in one Run has no Stage_Metrics there and reads not run', () => {
    const errored: ReportStageRow = { index: 0, vus: 10, durationSec: 30, status: 'error', errorReason: 'boom' };
    const result = compareRuns(input('r1', 1000, [errored]), input('r2', 2000, [stage(0, 120, 1, 10)]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.stages[0]?.overall.p95Ms).toEqual({ baseline: NOT_RUN, later: '120', difference: null, percentChange: null });
  });

  test('the result does not depend on argument order; equal start times break ties on run id', () => {
    const x = input('run-x', 5000, [stage(0, 100, 1, 10)]);
    const y = input('run-y', 5000, [stage(0, 120, 1, 10)]);
    expect(compareRuns(x, y)).toEqual(compareRuns(y, x));
    const forward = compareRuns(x, y);
    if (forward.kind !== 'ok') throw new Error('expected ok');
    expect(forward.baseline.runId).toBe('run-x');
  });

  test('headline displays: none, not reached, and the first degraded route', () => {
    const healthy = input('r1', 1000, [stage(0, 100, 0, 10), stage(1, 120, 0, 20)]);
    const broken = input('r2', 2000, [stage(0, 9000, 0, 10, { catalog_list: metricsOf(9500) })]);
    const result = compareRuns(healthy, broken);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.headline.safeCapacity).toEqual({ baseline: '20', later: 'none' });
    expect(result.headline.breakingPoint).toEqual({ baseline: 'not reached', later: '10' });
    expect(result.headline.firstDegradedRoute).toEqual({ baseline: 'none', later: 'catalog_list' });
  });
});
