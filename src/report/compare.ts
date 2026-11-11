/**
 * Run comparison (requirements 13.3-13.5, Property 25).
 *
 * Pure and deterministic. Differences are computed on the DISPLAYED (rounded)
 * values, not on raw metrics, so the numbers a reader sees always add up.
 */

import { ROUTE_CATALOG } from '../plan/catalog.ts';
import { fmtMs, fmtPct, fmtRps, roundHalfAway } from '../run/format.ts';
import type { CapacityReport, MetricsView, StageView } from './build.ts';

export const HEADLINE_NONE = 'none';
export const HEADLINE_NOT_REACHED = 'not reached';
export const NOT_RUN = 'not run';
export const NOT_AVAILABLE = 'n/a';
export const DIFFERENT_PLAN_MESSAGE = 'Only Runs of the same approved Test_Plan can be compared.';

/** Safe_Capacity display (13.2): "none" when no Safe_Capacity was found. */
export function displaySafeCapacity(v: number | null): string {
  return v === null ? HEADLINE_NONE : String(v);
}

/** Breaking_Point display (13.2): "not reached" when no Stage failed. */
export function displayBreakingPoint(v: number | null): string {
  return v === null ? HEADLINE_NOT_REACHED : String(v);
}

/** First_Degraded_Route display: "none" when no route exceeded a threshold. */
export function displayFirstDegradedRoute(v: string | null): string {
  return v === null ? HEADLINE_NONE : v;
}

// ---------------------------------------------------------------- types ----

export interface CompareInput {
  runId: string;
  planHash: string;
  startedAt: number;
  report: CapacityReport;
}

export interface RunSummary {
  runId: string;
  startedAt: number;
  safeCapacity: number | null;
  breakingPoint: number | null;
  firstDegradedRoute: string | null;
  /** `"none"` when null. */
  safeCapacityDisplay: string;
  /** `"not reached"` when null. */
  breakingPointDisplay: string;
  /** `"none"` when null. */
  firstDegradedRouteDisplay: string;
}

export interface HeadlineValue {
  baseline: string;
  later: string;
}

/**
 * One numeric value in both Runs. `baseline`/`later` are display strings, or
 * `"not run"`. `difference` and `percentChange` are `null` when the row exists
 * in only one Run (13.5), `"n/a"` when a value is missing or the baseline is 0.
 */
export interface ValueComparison {
  baseline: string;
  later: string;
  difference: string | null;
  percentChange: string | null;
}

export interface MetricsComparison {
  p95Ms: ValueComparison;
  errorRatePct: ValueComparison;
  rps: ValueComparison;
}

export interface RouteComparison extends MetricsComparison {
  route: string;
}

export interface StageComparison {
  /** Stage index as stored (same convention as StageView.index). */
  index: number;
  displayIndex: number;
  vus: number;
  overall: MetricsComparison;
  /** Routes in ROUTE_CATALOG order, only those with metrics in at least one Run. */
  routes: RouteComparison[];
}

export type Comparison =
  | { kind: 'different_plan'; message: string }
  | {
      kind: 'ok';
      baseline: RunSummary;
      later: RunSummary;
      headline: {
        safeCapacity: HeadlineValue;
        breakingPoint: HeadlineValue;
        firstDegradedRoute: HeadlineValue;
      };
      stages: StageComparison[];
    };

// -------------------------------------------------------------- helpers ----

interface Spec {
  decimals: 0 | 1;
  fmt: (x: number) => string;
  pick: (m: MetricsView) => { display: string; raw: number };
}

const P95: Spec = { decimals: 0, fmt: fmtMs, pick: (m) => ({ display: m.display.p95, raw: m.raw.p95 }) };
const ERR: Spec = {
  decimals: 1,
  fmt: fmtPct,
  pick: (m) => ({ display: m.display.errorRatePct, raw: m.raw.errorRatePct }),
};
const RPS: Spec = { decimals: 1, fmt: fmtRps, pick: (m) => ({ display: m.display.rps, raw: m.raw.rps }) };

function signed(x: number, text: string): string {
  return x > 0 ? `+${text}` : text;
}

function compareValue(spec: Spec, base: MetricsView | undefined, later: MetricsView | undefined): ValueComparison {
  const b = base === undefined ? undefined : spec.pick(base);
  const l = later === undefined ? undefined : spec.pick(later);
  const baselineText = b === undefined ? NOT_RUN : b.display;
  const laterText = l === undefined ? NOT_RUN : l.display;

  // Row present in only one Run (or neither): no difference at all (13.5).
  if (b === undefined || l === undefined) {
    return { baseline: baselineText, later: laterText, difference: null, percentChange: null };
  }

  const bv = roundHalfAway(b.raw, spec.decimals);
  const lv = roundHalfAway(l.raw, spec.decimals);
  if (!Number.isFinite(bv) || !Number.isFinite(lv) || bv === 0) {
    return { baseline: baselineText, later: laterText, difference: NOT_AVAILABLE, percentChange: NOT_AVAILABLE };
  }

  const diff = roundHalfAway(lv - bv, spec.decimals);
  const pct = roundHalfAway((diff / bv) * 100, 1);
  return {
    baseline: baselineText,
    later: laterText,
    difference: signed(diff, spec.fmt(diff)),
    percentChange: signed(pct, `${pct.toFixed(1)}%`),
  };
}

function compareMetrics(base: MetricsView | null | undefined, later: MetricsView | null | undefined): MetricsComparison {
  const b = base ?? undefined;
  const l = later ?? undefined;
  return {
    p95Ms: compareValue(P95, b, l),
    errorRatePct: compareValue(ERR, b, l),
    rps: compareValue(RPS, b, l),
  };
}

function summarize(input: CompareInput): RunSummary {
  const h = input.report.headline;
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    safeCapacity: h.safeCapacity,
    breakingPoint: h.breakingPoint,
    firstDegradedRoute: h.firstDegradedRoute,
    safeCapacityDisplay: displaySafeCapacity(h.safeCapacity),
    breakingPointDisplay: displayBreakingPoint(h.breakingPoint),
    firstDegradedRouteDisplay: displayFirstDegradedRoute(h.firstDegradedRoute),
  };
}

function byIndex(report: CapacityReport): Map<number, StageView> {
  const map = new Map<number, StageView>();
  for (const s of report.stages) map.set(s.index, s);
  return map;
}

function routeView(stage: StageView | undefined, route: string): MetricsView | undefined {
  return stage?.routes.find((r) => r.route === route);
}

// -------------------------------------------------------------- compare ----

export function compareRuns(a: CompareInput, b: CompareInput): Comparison {
  if (a.planHash !== b.planHash) {
    return { kind: 'different_plan', message: DIFFERENT_PLAN_MESSAGE };
  }

  // Earlier-started Run is the baseline; ties break on runId so the result
  // does not depend on argument order.
  const aFirst = a.startedAt !== b.startedAt ? a.startedAt < b.startedAt : a.runId <= b.runId;
  const base = aFirst ? a : b;
  const later = aFirst ? b : a;

  const baseStages = byIndex(base.report);
  const laterStages = byIndex(later.report);
  const indexes = [...new Set([...baseStages.keys(), ...laterStages.keys()])].sort((x, y) => x - y);

  const stages: StageComparison[] = indexes.map((index) => {
    const bs = baseStages.get(index);
    const ls = laterStages.get(index);
    const routes: RouteComparison[] = [];
    for (const entry of ROUTE_CATALOG) {
      const br = routeView(bs, entry.id);
      const lr = routeView(ls, entry.id);
      if (br === undefined && lr === undefined) continue;
      routes.push({ route: entry.id, ...compareMetrics(br, lr) });
    }
    return {
      index,
      displayIndex: index + 1,
      vus: (bs ?? ls)?.vus ?? 0,
      overall: compareMetrics(bs?.overall, ls?.overall),
      routes,
    };
  });

  const bSum = summarize(base);
  const lSum = summarize(later);
  return {
    kind: 'ok',
    baseline: bSum,
    later: lSum,
    headline: {
      safeCapacity: { baseline: bSum.safeCapacityDisplay, later: lSum.safeCapacityDisplay },
      breakingPoint: { baseline: bSum.breakingPointDisplay, later: lSum.breakingPointDisplay },
      firstDegradedRoute: { baseline: bSum.firstDegradedRouteDisplay, later: lSum.firstDegradedRouteDisplay },
    },
    stages,
  };
}
