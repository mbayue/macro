/**
 * Stage_Metrics extraction from the k6 `handleSummary` JSON (requirements 7.1-7.3).
 *
 * Pure: takes the summary text, returns either the metrics or a short fixed
 * failure reason. Never throws. Latencies are returned unrounded (rounding is
 * a display concern, see run/format.ts).
 */

import { z } from 'zod';
import { ROUTE_CATALOG } from '../plan/catalog.ts';
import type { Metrics, RouteId, StageMetrics } from '../types.ts';

export type ReadSummaryResult = { ok: true; metrics: StageMetrics } | { ok: false; reason: string };

const MetricEntry = z.object({ values: z.record(z.string(), z.unknown()).optional() }).passthrough();

const SummarySchema = z
  .object({
    state: z.object({ testRunDurationMs: z.unknown().optional() }).passthrough().optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

type Values = Record<string, unknown>;

class Fail extends Error {}

function fail(reason: string): never {
  throw new Fail(reason);
}

function isNonNegative(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** The `values` object of a named metric, or `undefined` if absent or malformed. */
function valuesOf(metrics: Record<string, unknown>, name: string): Values | undefined {
  if (!Object.hasOwn(metrics, name)) return undefined;
  const parsed = MetricEntry.safeParse(metrics[name]);
  if (!parsed.success) return undefined;
  return parsed.data.values;
}

function required(v: unknown, reason: string): number {
  if (!isNonNegative(v)) fail(reason);
  return v;
}

/**
 * Build one Metrics block from the metric names carrying `suffix`
 * (`''` for overall, `{route:X}` for a route). Returns `undefined` for a
 * per-route block with no requests; fails for an overall block with none.
 */
function block(
  metrics: Record<string, unknown>,
  suffix: string,
  durationSec: number,
  overall: boolean,
): Metrics | undefined {
  const reqs = valuesOf(metrics, `http_reqs${suffix}`);
  if (reqs === undefined) {
    if (overall) fail('summary has no http_reqs metric');
    return undefined;
  }
  const count = required(reqs['count'], 'http_reqs count is not a finite number >= 0');
  if (count === 0) {
    if (overall) fail('summary reports 0 requests');
    return undefined;
  }

  const dur = valuesOf(metrics, `http_req_duration${suffix}`);
  if (dur === undefined) fail('summary has no http_req_duration metric');
  const bad = 'a latency value is not a finite number >= 0';
  const p50 = required(dur['med'] ?? dur['p(50)'], bad);
  const p95 = required(dur['p(95)'], bad);
  const p99 = required(dur['p(99)'], bad);

  const failed = valuesOf(metrics, `http_req_failed${suffix}`);
  if (failed === undefined) fail('summary has no http_req_failed metric');
  const passes = failed['passes'];
  const fails = failed['fails'];
  const rate = failed['rate'];
  const passesUsable =
    isNonNegative(passes) &&
    passes <= count &&
    (fails === undefined || (isNonNegative(fails) && passes + fails === count));
  let errorRatePct: number;
  if (passesUsable) {
    errorRatePct = (passes / count) * 100;
  } else {
    errorRatePct = required(rate, 'http_req_failed rate is not a finite number >= 0') * 100;
  }

  const m429 = valuesOf(metrics, `macro_429${suffix}`);
  let http429 = 0;
  if (m429 !== undefined && m429['count'] !== undefined) {
    http429 = required(m429['count'], 'macro_429 count is not a finite number >= 0');
  }

  const rps = count / durationSec;
  if (!Number.isFinite(rps) || !Number.isFinite(errorRatePct)) {
    fail('a derived value is not a finite number');
  }

  return {
    requests: count,
    rps,
    errorRatePct,
    http429,
    p50,
    p95,
    p99,
  };
}

/** Extract Stage_Metrics from the k6 summary JSON text. Never throws. */
export function readSummary(summaryJson: string): ReadSummaryResult {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(summaryJson);
    } catch {
      return { ok: false, reason: 'summary is not valid JSON' };
    }
    const parsed = SummarySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'summary is not a JSON object' };
    const { metrics, state } = parsed.data;
    if (metrics === undefined) return { ok: false, reason: 'summary has no metrics' };

    const durMs = state?.testRunDurationMs;
    if (typeof durMs !== 'number' || !Number.isFinite(durMs) || durMs <= 0) {
      return { ok: false, reason: 'summary has no valid state.testRunDurationMs' };
    }
    const durationSec = durMs / 1000;

    const overall = block(metrics, '', durationSec, true);
    if (overall === undefined) return { ok: false, reason: 'summary has no http_reqs metric' };

    const routes: Partial<Record<RouteId, Metrics>> = {};
    for (const entry of ROUTE_CATALOG) {
      const m = block(metrics, `{route:${entry.id}}`, durationSec, false);
      if (m !== undefined) routes[entry.id] = m;
    }
    return { ok: true, metrics: { overall, routes } };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, reason: e.message };
    return { ok: false, reason: 'summary could not be read' };
  }
}
