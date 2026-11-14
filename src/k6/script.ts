/**
 * Script_Generator (requirements 6.1, 7.1, 7.3, 14.8; design "Script_Generator").
 *
 * Produces the k6 script for one Stage from a FIXED template. The only injected
 * text is `const CFG = <JSON>;`, and that JSON is built from a zod-validated
 * object holding numbers, Route_Catalog entries, the two configured origins,
 * slug-safe product IDs and the Run ID. Pure: no I/O, no clock, no randomness.
 */

import { z } from 'zod';
import { isRouteId, orderBody, ROUTE_CATALOG } from '../plan/catalog.ts';
import type { OrderBody } from '../plan/catalog.ts';
import { parseHttpsOrigin } from '../config.ts';
import type { RouteId, TestPlan } from '../types.ts';

/** Where the generated script writes the k6 end-of-test summary inside the Sandbox. */
export const K6_SUMMARY_PATH = '/out/summary.json';

export interface StageScriptRoute {
  id: string;
  role: 'web' | 'api';
  method: 'GET' | 'POST';
  path: string;
}

export interface StageScriptInput {
  runId: string;
  stageIndex: number;
  vus: number;
  durationSec: number;
  journey: TestPlan['journey'];
  origins: { web: string; api: string };
  productIds: readonly string[];
  orderProductId: string;
  /** When set, these rows replace Route_Catalog for this script. */
  routes?: readonly StageScriptRoute[];
}

/** Shape of the `CFG` constant in the generated script. */
export interface StageScriptCfg {
  runId: string;
  stageIndex: number;
  vus: number;
  durationSec: number;
  origins: { web: string; api: string };
  productIds: string[];
  /** Catalog entries for the routes used by the journey, keyed by route ID. */
  routes: Partial<
    Record<string, { id: string; role: 'web' | 'api'; method: 'GET' | 'POST'; path: string; body?: 'order' }>
  >;
  journey: { route: string; probability: number; thinkMs: number }[];
  /** Body for `order_create`; null when the journey has no `order_create` step. */
  orderBody: OrderBody | null;
}

const RUN_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

const originSchema = z
  .string()
  .max(255)
  .refine((v) => parseHttpsOrigin(v) === v, 'must be a lowercase origin of the form https://host[:port]');

const slugSchema = z.string().regex(SLUG_RE, 'must match /^[a-z0-9-]{1,40}$/');

const inputSchema = z.strictObject({
  runId: z.string().regex(RUN_ID_RE, 'must match /^[A-Za-z0-9-]{8,64}$/'),
  stageIndex: z.int().min(0).max(1000),
  vus: z.int().min(1).max(500),
  durationSec: z.int().min(1).max(600),
  journey: z
    .array(
      z.strictObject({
        route: z.string().min(1).max(32),
        probability: z.int().min(1).max(100),
        thinkMs: z.int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(8),
  origins: z.strictObject({ web: originSchema, api: originSchema }),
  productIds: z.array(slugSchema).min(1).max(100),
  orderProductId: slugSchema,
  routes: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(16),
        role: z.enum(['web', 'api']),
        method: z.enum(['GET', 'POST']),
        path: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(32)
    .optional(),
}).superRefine((val, ctx) => {
  if (val.routes === undefined) {
    val.journey.forEach((step, i) => {
      if (!isRouteId(step.route)) {
        ctx.addIssue({ code: 'custom', path: ['journey', i, 'route'], message: 'is not a Route_Catalog route ID' });
      }
    });
    return;
  }
  const ids = new Set(val.routes.map((r) => r.id));
  val.journey.forEach((step, i) => {
    if (!ids.has(step.route)) {
      ctx.addIssue({ code: 'custom', path: ['journey', i, 'route'], message: 'is not a discovered route ID' });
    }
  });
});

/**
 * Serialise for embedding as a JS expression. JSON.stringify output is valid JS
 * (ES2019+); the extra escapes keep it safe if the script is ever inlined in HTML
 * and cover the pre-ES2019 U+2028 / U+2029 line-terminator hazard.
 */
function toJsLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Distinct route IDs used by the journey, in Route_Catalog order. Ignores unknown route strings. */
export function scriptSummaryRoutes(journey: TestPlan['journey']): RouteId[] {
  const used = new Set<string>(journey.map((s) => s.route));
  return ROUTE_CATALOG.filter((r) => used.has(r.id)).map((r) => r.id);
}

/** Validate the input and build the CFG object. Throws `Error` on any invalid value. */
export function buildStageScriptCfg(input: StageScriptInput): StageScriptCfg {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid stage script input: ${detail}`);
  }
  const v = parsed.data;

  const used = new Set<string>(v.journey.map((s) => s.route));
  const routes: StageScriptCfg['routes'] = {};
  if (v.routes !== undefined) {
    for (const entry of v.routes) {
      if (!used.has(entry.id)) continue;
      routes[entry.id] = { id: entry.id, role: entry.role, method: entry.method, path: entry.path };
    }
  } else {
    for (const entry of ROUTE_CATALOG) {
      if (!used.has(entry.id)) continue;
      routes[entry.id] = {
        id: entry.id,
        role: entry.role,
        method: entry.method,
        path: entry.path,
        ...(entry.body !== undefined ? { body: entry.body } : {}),
      };
    }
  }

  return {
    runId: v.runId,
    stageIndex: v.stageIndex,
    vus: v.vus,
    durationSec: v.durationSec,
    origins: { web: v.origins.web, api: v.origins.api },
    productIds: [...v.productIds],
    routes,
    journey: v.journey.map((s) => ({ route: s.route, probability: s.probability, thinkMs: s.thinkMs })),
    orderBody: used.has('order_create') ? { ...orderBody(v.runId), productId: v.orderProductId } : null,
  };
}

// Fixed template (plain ES module text for k6 v2). The only TS interpolation is the
// constant K6_SUMMARY_PATH; the only runtime-injected value is CFG.
const TEMPLATE_HEAD = `// Generated by Macro. Fixed template; the only injected value is CFG.
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

`;

function templateBody(substituteProduct: boolean): string {
  const pathLine = substituteProduct
    ? "  const path = entry.path.replace('{productId}', pick(CFG.productIds));"
    : '  const path = entry.path;';
  return `

const macro429 = new Counter('macro_429');
const sampleCount = new Counter('macro_sample_count');
const sampleErrors = new Counter('macro_sample_errors');
const sampleLatency = new Trend('macro_sample_latency', true);
const EXPECTED = http.expectedStatuses({ min: 200, max: 399 });

// Always-true thresholds: they make k6 emit a sub-metric per route tag in the summary.
const thresholds = {};
for (const id of Object.keys(CFG.routes)) {
  thresholds['http_req_duration{route:' + id + '}'] = ['max>=0'];
  thresholds['http_req_failed{route:' + id + '}'] = ['rate>=0'];
  thresholds['http_reqs{route:' + id + '}'] = ['count>=0'];
  thresholds['macro_429{route:' + id + '}'] = ['count>=0'];
  // Per-second sample sub-metrics: k6 emits a sub-metric into the summary only
  // for tag combinations named by a threshold, so every (route, second) the
  // sampler can produce is enumerated here (verified against k6 v2.3.0).
  for (let s = 0; s <= CFG.durationSec; s++) {
    thresholds['macro_sample_count{route:' + id + ',second:' + s + '}'] = ['count>=0'];
    thresholds['macro_sample_errors{route:' + id + ',second:' + s + '}'] = ['count>=0'];
    thresholds['macro_sample_latency{route:' + id + ',second:' + s + '}'] = ['max>=0'];
  }
}

export const options = {
  scenarios: {
    stage: {
      executor: 'constant-vus',
      vus: CFG.vus,
      duration: CFG.durationSec + 's',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
  thresholds: thresholds,
  noConnectionReuse: false,
  discardResponseBodies: true,
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function send(routeId) {
  const entry = CFG.routes[routeId];
  const origin = entry.role === 'api' ? CFG.origins.api : CFG.origins.web;
${pathLine}
  const params = {
    timeout: '10s',
    tags: { route: routeId },
    responseCallback: EXPECTED,
  };
  let body = null;
  if (entry.method === 'POST') {
    body = JSON.stringify(CFG.orderBody);
    params.headers = { 'Content-Type': 'application/json' };
  }
  const res = http.request(entry.method, origin + path, body, params);
  macro429.add(res.status === 429 ? 1 : 0, { route: routeId });
  sample(routeId, res);
}

// Per-second, per-route sampling: what happened during the stage, second by
// second. k6 gives every VU its own copy of module state and runs handleSummary
// in a separate init context, so in-memory buckets never reach the summary; the
// samples travel as tagged custom metrics instead, and handleSummary rebuilds
// the buckets from the data.metrics sub-metrics the thresholds emit.
const startedAt = Date.now();

function sample(routeId, res) {
  const second = Math.floor((Date.now() - startedAt) / 1000);
  const tags = { route: routeId, second: String(second) };
  sampleCount.add(1, tags);
  if (res.status < 200 || res.status >= 400) sampleErrors.add(1, tags);
  sampleLatency.add(res.timings && res.timings.duration ? res.timings.duration : 0, tags);
}

export default function () {
  for (const step of CFG.journey) {
    if (Math.random() * 100 < step.probability) {
      send(step.route);
    }
    sleep(step.thinkMs / 1000);
  }
}

// Tag-name parser: 'macro_sample_x{route:r,second:s}' -> { route: 'r', second: 's' } or null.
function sampleTags(name, metric) {
  if (!name.startsWith(metric + '{') || !name.endsWith('}')) return null;
  const tags = {};
  for (const part of name.slice(metric.length + 1, -1).split(',')) {
    const i = part.indexOf(':');
    if (i > 0) tags[part.slice(0, i)] = part.slice(i + 1);
  }
  return tags;
}

export function handleSummary(data) {
  // Latency and error values keyed route|second so the count pass can pair them.
  const latency = {};
  const errors = {};
  for (const [name, entry] of Object.entries(data.metrics)) {
    if (typeof name !== 'string' || !entry || !entry.values) continue;
    const latTags = sampleTags(name, 'macro_sample_latency');
    if (latTags !== null) latency[latTags.route + '|' + latTags.second] = entry.values;
    const errTags = sampleTags(name, 'macro_sample_errors');
    if (errTags !== null) errors[errTags.route + '|' + errTags.second] = entry.values.count;
  }
  const buckets = [];
  for (const [name, entry] of Object.entries(data.metrics)) {
    const tags = sampleTags(name, 'macro_sample_count');
    if (tags === null || !entry.values) continue;
    const second = Number(tags.second);
    const route = tags.route;
    const count = entry.values.count;
    // Empty combos (a second with no traffic for a route) are skipped: their
    // rows would be noise in the store and the chart draws nothing for them.
    if (
      !Number.isInteger(second) ||
      second < 0 ||
      typeof route !== 'string' ||
      route.length === 0 ||
      typeof count !== 'number' ||
      count <= 0
    ) {
      continue;
    }
    const lat = latency[route + '|' + tags.second] ?? {};
    // The summary exposes avg and max, not the sum; avg x count is the sum to
    // float precision, which is all the chart's per-second average needs.
    const sumMs = typeof lat.avg === 'number' ? lat.avg * count : 0;
    const maxMs = typeof lat.max === 'number' ? lat.max : 0;
    const e = errors[route + '|' + tags.second];
    buckets.push([second, route, count, typeof e === 'number' ? e : 0, sumMs, maxMs]);
  }
  buckets.sort(function (a, b) {
    return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  });
  const samples = { intervalSec: 1, buckets: buckets };
  return { '${K6_SUMMARY_PATH}': JSON.stringify(Object.assign({}, data, { macro_samples: samples })) };
}
`;
}

/** Generate the k6 script for one Stage. Throws `Error` if any input value is invalid. */
export function generateStageScript(input: StageScriptInput): string {
  const cfg = buildStageScriptCfg(input);
  const substituteProduct =
    input.routes === undefined ||
    Object.values(cfg.routes).some((entry) => entry?.path.includes('{productId}') === true);
  return `${TEMPLATE_HEAD}const CFG = ${toJsLiteral(cfg)};${templateBody(substituteProduct)}`;
}
