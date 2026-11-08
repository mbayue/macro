/**
 * Capacity_Report builder (requirements 10.1-10.4, 10.6, 10.11, 10.12).
 *
 * Pure: takes a plain data object, returns a plain JSON-safe object. Every
 * number comes from stored Stage_Metrics and the approved Test_Plan. No AI
 * text is produced here; the optional `ai` slot is filled later (task 10.9)
 * and is kept apart from the headline values and tables.
 *
 * Index convention: `index` is the Stage index exactly as supplied in the
 * input (the Run_Store value); `displayIndex` is `index + 1` ("Stage 1").
 * Both are in the Allowed_Numbers.
 */

import { ROUTE_CATALOG } from '../plan/catalog.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../run/format.ts';
import { breakingPoint, exceedsThresholds, firstDegradedRoute, safeCapacity, stageVerdict } from '../run/verdict.ts';
import type {
  ContainmentType,
  DecisionSource,
  DecisionValue,
  Metrics,
  RouteId,
  RunStatus,
  SandboxRuntime,
  StageMetrics,
  StageVerdict,
  TestPlan,
} from '../types.ts';

// ---------------------------------------------------------------- input ----

export interface ReportStageRow {
  index: number;
  vus: number;
  durationSec: number;
  status: 'done' | 'error';
  errorReason?: string;
  metrics?: StageMetrics;
  verdict?: StageVerdict;
}

export interface ReportDecision {
  stageIdx: number;
  decision: DecisionValue;
  source: DecisionSource;
  reason: string;
  reasonWithheld: boolean;
}

export interface ReportEvent {
  type: ContainmentType;
  /** `null` for Run-level events not tied to a Stage. */
  stageIdx: number | null;
  /** Passed through unchanged (epoch ms or ISO string, whatever the store holds). */
  ts: number | string;
  host?: string;
  port?: number;
}

export interface ReportInput {
  runId: string;
  planHash: string;
  status: RunStatus;
  runtime: SandboxRuntime;
  /** The approved Test_Plan (source of Stop_Thresholds, name, target). */
  plan: TestPlan;
  stages: readonly ReportStageRow[];
  decisions: readonly ReportDecision[];
  events: readonly ReportEvent[];
}

// --------------------------------------------------------------- output ----

export interface MetricsDisplay {
  requests: string;
  rps: string;
  errorRatePct: string;
  http429: string;
  p50: string;
  p95: string;
  p99: string;
}

export interface MetricsView {
  raw: Metrics;
  display: MetricsDisplay;
}

export interface RouteRowView extends MetricsView {
  route: RouteId;
  /** True when the rounded p95 or error rate exceeds a Stop_Thresholds value. */
  exceedsThresholds: boolean;
}

export interface StageView {
  index: number;
  displayIndex: number;
  vus: number;
  durationSec: number;
  status: 'done' | 'error';
  errorReason: string | null;
  verdict: StageVerdict | null;
  /** `null` when the Stage has no Stage_Metrics. */
  overall: MetricsView | null;
  /** Per-route rows in ROUTE_CATALOG order; empty without Stage_Metrics. */
  routes: RouteRowView[];
}

export interface AiSection {
  status: 'ok' | 'unavailable' | 'withheld';
  explanation?: string;
  suggestions?: string[];
  notes?: string[];
}

export interface CapacityReport {
  runId: string;
  planHash: string;
  planName: string;
  target: string;
  runtime: SandboxRuntime;
  thresholds: { p95Ms: number; errorRatePct: number };

  /** Headline values; `null` means "show no value". */
  headline: {
    status: RunStatus;
    safeCapacity: number | null;
    breakingPoint: number | null;
    firstDegradedRoute: RouteId | null;
  };

  /** 10.12: no Stage produced metrics. */
  noStageMetrics: { text: string } | null;
  /** 10.3: no failing Stage; breaking point not reached up to `highestVus`. */
  breakingPointNotReached: { highestVus: number; text: string } | null;
  /** 10.4: first Stage with metrics failed; no safe capacity at or above `firstStageVus`. */
  noSafeCapacity: { firstStageVus: number; text: string } | null;
  /** 10.11: metrics exist but no route exceeded either Stop_Thresholds value. */
  noRouteExceeded: { text: string } | null;

  stages: StageView[];
  decisions: ReportDecision[];
  events: ReportEvent[];

  /** AI-generated section (task 10.9). Separate from everything above. */
  ai?: AiSection | undefined;
}

// -------------------------------------------------------------- builder ----

function metricsView(m: Metrics): MetricsView {
  return {
    raw: { ...m },
    display: {
      requests: fmtCount(m.requests),
      rps: fmtRps(m.rps),
      errorRatePct: fmtPct(m.errorRatePct),
      http429: fmtCount(m.http429),
      p50: fmtMs(m.p50),
      p95: fmtMs(m.p95),
      p99: fmtMs(m.p99),
    },
  };
}

export function buildReport(run: ReportInput): CapacityReport {
  const t = { p95Ms: run.plan.stopThresholds.p95Ms, errorRatePct: run.plan.stopThresholds.errorRatePct };
  const ordered = [...run.stages].sort((a, b) => a.index - b.index);

  const stages: StageView[] = ordered.map((s) => {
    const m = s.metrics;
    const verdict: StageVerdict | null = m === undefined ? null : (s.verdict ?? stageVerdict(m.overall, t));
    const routes: RouteRowView[] = [];
    if (m !== undefined) {
      for (const entry of ROUTE_CATALOG) {
        const rm = m.routes[entry.id];
        if (rm === undefined) continue;
        routes.push({ route: entry.id, ...metricsView(rm), exceedsThresholds: exceedsThresholds(rm, t) });
      }
    }
    return {
      index: s.index,
      displayIndex: s.index + 1,
      vus: s.vus,
      durationSec: s.durationSec,
      status: s.status,
      errorReason: s.errorReason ?? null,
      verdict,
      overall: m === undefined ? null : metricsView(m.overall),
      routes,
    };
  });

  // Only Stages with Stage_Metrics feed the capacity math (10.1).
  const measured = ordered.flatMap((s, i) => {
    const view = stages[i];
    if (s.metrics === undefined || view === undefined || view.verdict === null) return [];
    return [{ vus: s.vus, verdict: view.verdict, metrics: s.metrics }];
  });

  const safe = safeCapacity(measured);
  const breaking = breakingPoint(measured);
  const degraded = firstDegradedRoute(measured, t);

  const first = measured[0];
  const hasMetrics = first !== undefined;
  const highestVus = hasMetrics ? Math.max(...measured.map((s) => s.vus)) : undefined;

  const noStageMetrics = hasMetrics ? null : { text: 'No Stage produced metrics.' };

  const breakingPointNotReached =
    hasMetrics && breaking === undefined && highestVus !== undefined
      ? {
          highestVus,
          text: `Breaking point not reached up to ${fmtCount(highestVus)} VUs, the highest tested VU count.`,
        }
      : null;

  const noSafeCapacity =
    first !== undefined && first.verdict === 'fail'
      ? {
          firstStageVus: first.vus,
          text: `No safe capacity found at or above the first Stage's VU count (${fmtCount(first.vus)}).`,
        }
      : null;

  const noRouteExceeded =
    hasMetrics && degraded === undefined ? { text: 'No route exceeded the Stop_Thresholds.' } : null;

  return {
    runId: run.runId,
    planHash: run.planHash,
    planName: run.plan.name,
    target: run.plan.target,
    runtime: run.runtime,
    thresholds: t,
    headline: {
      status: run.status,
      safeCapacity: safe ?? null,
      breakingPoint: breaking ?? null,
      firstDegradedRoute: degraded ?? null,
    },
    noStageMetrics,
    breakingPointNotReached,
    noSafeCapacity,
    noRouteExceeded,
    stages,
    decisions: run.decisions.map((d) => ({ ...d })),
    events: run.events.map((e) => ({ ...e })),
  };
}

// ------------------------------------------------------------ AI section ----

/** Returns a new report with the AI section set. Touches no headline value or table. */
export function attachAi(report: CapacityReport, ai: AiSection): CapacityReport {
  return {
    ...report,
    ai: {
      status: ai.status,
      ...(ai.explanation !== undefined ? { explanation: ai.explanation } : {}),
      ...(ai.suggestions !== undefined ? { suggestions: [...ai.suggestions] } : {}),
      ...(ai.notes !== undefined ? { notes: [...ai.notes] } : {}),
    },
  };
}
