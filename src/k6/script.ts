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
import { Counter } from 'k6/metrics';

`;

function templateBody(substituteProduct: boolean): string {
  const pathLine = substituteProduct
    ? "  const path = entry.path.replace('{productId}', pick(CFG.productIds));"
    : '  const path = entry.path;';
  return `

const macro429 = new Counter('macro_429');
const EXPECTED = http.expectedStatuses({ min: 200, max: 399 });

// Always-true thresholds: they make k6 emit a sub-metric per route tag in the summary.
const thresholds = {};
for (const id of Object.keys(CFG.routes)) {
  thresholds['http_req_duration{route:' + id + '}'] = ['max>=0'];
  thresholds['http_req_failed{route:' + id + '}'] = ['rate>=0'];
  thresholds['http_reqs{route:' + id + '}'] = ['count>=0'];
  thresholds['macro_429{route:' + id + '}'] = ['count>=0'];
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
}

export default function () {
  for (const step of CFG.journey) {
    if (Math.random() * 100 < step.probability) {
      send(step.route);
    }
    sleep(step.thinkMs / 1000);
  }
}

export function handleSummary(data) {
  return { '${K6_SUMMARY_PATH}': JSON.stringify(data) };
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
