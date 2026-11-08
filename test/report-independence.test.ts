import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { attachAi, buildReport } from '../src/report/build.ts';
import type { AiSection, CapacityReport, ReportDecision } from '../src/report/build.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../src/run/format.ts';
import { ROUTES, arbStageRows, reportInputOf } from './arb-agents.ts';

const arbText = fc.string({ maxLength: 120 });
const arbAi: fc.Arbitrary<AiSection> = fc.oneof(
  fc.constant<AiSection>({ status: 'unavailable', notes: ['AI explanation unavailable'] }),
  fc.constant<AiSection>({ status: 'unavailable' }),
  fc.record({
    status: fc.constantFrom('ok' as const, 'withheld' as const),
    explanation: arbText,
    suggestions: fc.array(arbText, { maxLength: 5 }),
    notes: fc.array(arbText, { maxLength: 2 }),
  }),
  // Text full of numbers that appear nowhere in the stored metrics.
  fc.record({
    status: fc.constant('ok' as const),
    explanation: fc.integer({ min: 100_000, max: 999_999 }).map((n) => `Safe capacity ${n} VUs, breaking point ${n + 1}`),
    suggestions: fc.array(fc.integer({ min: 100_000, max: 999_999 }).map((n) => `Cache for ${n} ms`), { maxLength: 5 }),
  }),
);

const arbDecisions: fc.Arbitrary<ReportDecision[]> = fc.array(
  fc.record({
    stageIdx: fc.integer({ min: 0, max: 4 }),
    decision: fc.constantFrom('continue' as const, 'stop' as const),
    source: fc.constantFrom('agent' as const, 'fallback' as const),
    reason: arbText,
    reasonWithheld: fc.boolean(),
  }),
  { maxLength: 5 },
);

/** The report without its AI slot. */
function core(report: CapacityReport): Omit<CapacityReport, 'ai'> {
  const { ai: _ai, ...rest } = report;
  return rest;
}

/** Everything a reader sees outside the AI section and the decision list. */
function tablesAndHeadline(report: CapacityReport): unknown {
  const { ai: _ai, decisions: _decisions, ...rest } = report;
  return rest;
}

describe('Property 23: Report numbers do not depend on AI output', () => {
  test('attachAi changes nothing but the ai slot, whatever the AI says', () => {
    // Feature: macro, Property 23: Report numbers do not depend on AI output
    fc.assert(
      fc.property(arbStageRows, arbAi, arbAi, (rows, aiA, aiB) => {
        const base = buildReport(reportInputOf(rows));
        const snapshot = JSON.stringify(base);

        const a = attachAi(base, aiA);
        const b = attachAi(base, aiB);

        // The input report is not touched.
        expect(JSON.stringify(base)).toBe(snapshot);
        expect('ai' in base && base.ai !== undefined).toBe(false);

        // Identical headline values, tables, decisions, and events.
        expect(JSON.stringify(core(a))).toBe(snapshot);
        expect(JSON.stringify(core(b))).toBe(snapshot);
        expect(core(a)).toEqual(core(b));
        expect(a.headline).toEqual(b.headline);
        expect(a.stages).toEqual(b.stages);

        // The AI text lives only in `ai`.
        expect(a.ai?.status).toBe(aiA.status);
        expect(a.ai?.explanation).toBe(aiA.explanation);
        expect(a.ai?.suggestions).toEqual(aiA.suggestions);
        const outside = JSON.stringify(core(a));
        for (const text of [aiA.explanation, ...(aiA.suggestions ?? [])]) {
          if (text !== undefined && text.length >= 8) expect(outside).not.toContain(JSON.stringify(text).slice(1, -1));
        }
      }),
      { numRuns: 200 },
    );
  });

  test('Supervisor decisions and their reasons do not change the headline values or tables', () => {
    // Feature: macro, Property 23: Report numbers do not depend on AI output
    fc.assert(
      fc.property(arbStageRows, arbDecisions, arbDecisions, (rows, decisionsA, decisionsB) => {
        const a = buildReport(reportInputOf(rows, { decisions: decisionsA }));
        const b = buildReport(reportInputOf(rows, { decisions: decisionsB }));
        expect(tablesAndHeadline(a)).toEqual(tablesAndHeadline(b));
        expect(a.decisions).toEqual(decisionsA);
      }),
      { numRuns: 150 },
    );
  });

  test('every displayed number equals a value computed from the stored metrics and the approved plan', () => {
    // Feature: macro, Property 23: Report numbers do not depend on AI output
    fc.assert(
      fc.property(arbStageRows, (rows) => {
        const report = buildReport(reportInputOf(rows));
        const plan = reportInputOf(rows).plan;

        expect(report.thresholds).toEqual(plan.stopThresholds);
        expect(report.stages).toHaveLength(rows.length);
        report.stages.forEach((view, i) => {
          const row = rows[i];
          if (row === undefined) throw new Error('row missing');
          expect([view.index, view.displayIndex, view.vus, view.durationSec]).toEqual([row.index, row.index + 1, row.vus, row.durationSec]);
          if (row.metrics === undefined) {
            expect(view.overall).toBeNull();
            expect(view.routes).toEqual([]);
            return;
          }
          expect(view.overall?.raw).toEqual(row.metrics.overall);
          const o = row.metrics.overall;
          expect(view.overall?.display).toEqual({
            requests: fmtCount(o.requests),
            rps: fmtRps(o.rps),
            errorRatePct: fmtPct(o.errorRatePct),
            http429: fmtCount(o.http429),
            p50: fmtMs(o.p50),
            p95: fmtMs(o.p95),
            p99: fmtMs(o.p99),
          });
          // Route rows: exactly the routes with stored metrics, in catalog order, values unchanged.
          expect(view.routes.map((r) => r.route)).toEqual(ROUTES.filter((id) => row.metrics?.routes[id] !== undefined));
          for (const r of view.routes) {
            const stored = row.metrics.routes[r.route];
            expect(r.raw).toEqual(stored as NonNullable<typeof stored>);
            expect(r.display.p95).toBe(fmtMs((stored as NonNullable<typeof stored>).p95));
          }
        });

        // Headline VU counts are VU counts of measured Stages; the route is a route with stored metrics.
        const measuredVus = rows.filter((r) => r.metrics !== undefined).map((r) => r.vus);
        const { safeCapacity, breakingPoint, firstDegradedRoute } = report.headline;
        if (safeCapacity !== null) expect(measuredVus).toContain(safeCapacity);
        if (breakingPoint !== null) expect(measuredVus).toContain(breakingPoint);
        if (firstDegradedRoute !== null) {
          expect(rows.some((r) => r.metrics?.routes[firstDegradedRoute] !== undefined)).toBe(true);
        }
        // Safe capacity and breaking point agree with the verdicts the report itself shows.
        const measured = report.stages.filter((s) => s.verdict !== null);
        const failing = measured.find((s) => s.verdict === 'fail');
        expect(breakingPoint).toBe(failing?.vus ?? null);
        let safe: number | null = null;
        for (const s of measured) {
          if (s.verdict !== 'pass') break;
          safe = s.vus;
        }
        expect(safeCapacity).toBe(safe);
      }),
      { numRuns: 200 },
    );
  });
});

describe('attachAi unit checks', () => {
  test('copies the AI arrays so later edits do not leak into the report', () => {
    const base = buildReport(reportInputOf([]));
    const ai: AiSection = { status: 'ok', explanation: 'x', suggestions: ['a'], notes: ['n'] };
    const out = attachAi(base, ai);
    ai.suggestions?.push('b');
    ai.notes?.push('m');
    expect(out.ai?.suggestions).toEqual(['a']);
    expect(out.ai?.notes).toEqual(['n']);
  });

  test('an unavailable section carries no explanation key', () => {
    const out = attachAi(buildReport(reportInputOf([])), { status: 'unavailable', notes: ['AI explanation unavailable'] });
    expect(out.ai).toEqual({ status: 'unavailable', notes: ['AI explanation unavailable'] });
    expect('explanation' in (out.ai ?? {})).toBe(false);
  });
});
