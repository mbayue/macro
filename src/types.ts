/**
 * Shared types for Macro. Mirrors the "Data Models" section of the design
 * (.kiro/specs/macro/design.md). Keep this file free of runtime code.
 */

export type RouteId =
  | 'store_home'
  | 'catalog_list'
  | 'product_detail'
  | 'ledger'
  | 'order_create'
  | 'health';

export interface TestPlanStage {
  vus: number;
  durationSec: number;
}

export interface TestPlanJourneyStep {
  /** Parsed as a plain string; the Policy_Gate checks it against the Route_Catalog. */
  route: string;
  /** Integer percent, 1-100 (checked by the Policy_Gate). */
  probability: number;
  /** Milliseconds, 0-10000 (checked by the Policy_Gate). */
  thinkMs: number;
}

export interface TestPlan {
  name: string;
  target: string;
  stages: TestPlanStage[];
  journey: TestPlanJourneyStep[];
  stopThresholds: { p95Ms: number; errorRatePct: number };
}

/** One overall or one per-route block. Latencies are unrounded milliseconds. */
export interface Metrics {
  requests: number;
  rps: number;
  errorRatePct: number;
  http429: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface StageMetrics {
  overall: Metrics;
  routes: Partial<Record<string, Metrics>>;
}

/** One per-second, per-route bucket measured by the k6 script (design "Sampling"). */
export interface StageSample {
  second: number;
  route: string;
  requests: number;
  errors: number;
  latencySumMs: number;
  latencyMaxMs: number;
}

export type StageStatus = 'running' | 'done' | 'error';

export type StageVerdict = 'pass' | 'fail';

export interface StageResult {
  index: number;
  vus: number;
  durationSec: number;
  metrics: StageMetrics;
  verdict: StageVerdict;
}

export type RunStatus =
  | 'running'
  | 'completed'
  | 'halted'
  | 'stopped'
  | 'timed_out'
  | 'failed'
  | 'interrupted';

export type RunKind = 'run' | 'probe';

export type ContainmentType =
  | 'sandbox_created'
  | 'egress_blocked'
  | 'memory_cap_hit'
  | 'time_cap_hit'
  | 'sandbox_killed'
  | 'sandbox_removed'
  | 'runner_created'
  | 'runner_deleted';

export type SandboxRuntime = 'runsc' | 'runc';

export type DecisionValue = 'continue' | 'stop';

export type DecisionSource = 'agent' | 'fallback';

/** Event types written to the `events` table and sent over SSE. */
export type EventType =
  | 'stage_start'
  | 'stage_end'
  | 'decision'
  | 'status'
  | 'containment'
  | 'report';
