/**
 * Stage_Verdict, Safe_Capacity, Breaking_Point, First_Degraded_Route
 * (requirements 7.5, 10.2, 10.3, 10.4, 10.11). Pure functions.
 */

import { ROUTE_CATALOG } from '../plan/catalog.ts';
import type { Metrics, RouteId, StageMetrics, StageVerdict } from '../types.ts';
import { roundHalfAway } from './format.ts';

export interface StopThresholds {
  p95Ms: number;
  errorRatePct: number;
}

/** Minimal Stage shape for the capacity math; `StageResult` satisfies it. */
export interface VerdictStage {
  vus: number;
  verdict: StageVerdict;
}

/** Stage shape for First_Degraded_Route; `StageResult` satisfies it. */
export interface MetricsStage {
  metrics: StageMetrics;
}

/** True when the rounded (as displayed) p95 or error rate exceeds a threshold. */
export function exceedsThresholds(m: Metrics, t: StopThresholds): boolean {
  return roundHalfAway(m.p95, 0) > t.p95Ms || roundHalfAway(m.errorRatePct, 1) > t.errorRatePct;
}

/** `pass` when rounded overall p95 <= p95Ms and rounded error rate <= errorRatePct. */
export function stageVerdict(overall: Metrics, t: StopThresholds): StageVerdict {
  return exceedsThresholds(overall, t) ? 'fail' : 'pass';
}

/**
 * VU count of the last Stage that passes and is preceded only by passes.
 * `stages` must be in Stage order. `undefined` if empty or the first fails.
 */
export function safeCapacity(stages: readonly VerdictStage[]): number | undefined {
  let last: number | undefined;
  for (const s of stages) {
    if (s.verdict !== 'pass') break;
    last = s.vus;
  }
  return last;
}

/** VU count of the first failing Stage, `undefined` when none fails. */
export function breakingPoint(stages: readonly VerdictStage[]): number | undefined {
  for (const s of stages) {
    if (s.verdict === 'fail') return s.vus;
  }
  return undefined;
}

/**
 * Earliest Stage where any route exceeds a threshold (rounded as displayed);
 * within it, the exceeding route with the highest rounded p95, ties broken by
 * ROUTE_CATALOG order. `stages` must be in Stage order.
 */
export function firstDegradedRoute(
  stages: readonly MetricsStage[],
  t: StopThresholds,
): RouteId | undefined {
  for (const stage of stages) {
    let best: RouteId | undefined;
    let bestP95 = -Infinity;
    for (const entry of ROUTE_CATALOG) {
      const m = stage.metrics.routes[entry.id];
      if (m === undefined || !exceedsThresholds(m, t)) continue;
      const p95 = roundHalfAway(m.p95, 0);
      if (p95 > bestP95) {
        best = entry.id;
        bestP95 = p95;
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}
