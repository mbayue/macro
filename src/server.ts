/**
 * Macro_API HTTP surface (design "HTTP API", "Run sequence", "Turnstile and client IP").
 *
 * `createApp(deps)` is pure and injectable: it opens no socket, reads no environment and starts no
 * Sandbox by itself. `src/main.ts` wires the real dependencies and calls `Bun.serve`.
 *
 * Rules kept here:
 * - Every error body is an `ApiErrorBody` with a FIXED message. User input and internal error text
 *   are never echoed; internal errors are logged with a fixed code only.
 * - Order for the Turnstile-protected POSTs: body size/shape (and the Traffic_Event length for
 *   /api/plan) -> Turnstile -> limits/admission. Invalid input never reaches Turnstile or inference.
 */

import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type {
  ApiErrorBody,
  ApiErrorCode,
  ConfigResponse,
  DecisionView,
  EventView,
  GateDemoResponse,
  GateDemoScenario,
  GateView,
  ModelCallView,
  ParseErrorView,
  PlanResponse,
  RunListItem,
  RunListResponse,
  RunSnapshot,
  RunView,
  StartResponse,
  StopResponse,
} from './api-types.ts';
import { planTrafficEvent } from './agents/planner.ts';
import type { PlanOutcome } from './agents/planner.ts';
import type { InferenceClient } from './agents/inference.ts';
import type { Config } from './config.ts';
import { ROUTE_CATALOG } from './plan/catalog.ts';
import { parsePlan } from './plan/parser.ts';
import type { ParseError } from './plan/parser.ts';
import { evaluatePlan } from './plan/policy.ts';
import { planHash as hashPlanText, printPlan } from './plan/printer.ts';
import { attachAi } from './report/build.ts';
import type { AiSection, CapacityReport } from './report/build.ts';
import { compareRuns } from './report/compare.ts';
import type { CompareInput } from './report/compare.ts';
import { admitStart, formatUtc, isPlanHash } from './run/admission.ts';
import type { AdmissionResult } from './run/admission.ts';
import { toStageViewPayload } from './run/controller.ts';
import { PLANNING_LIMIT, rollingCheck } from './run/limits.ts';
import { clientIp } from './security/client-ip.ts';
import type { ModelCallRow, RunRow, StoredEvent, Store } from './store/db.ts';
import type { RunKind, TestPlan } from './types.ts';

// ------------------------------------------------------------------ constants

export const MAX_BODY_BYTES = 64 * 1024;
export const TRAFFIC_EVENT_MIN = 10;
export const TRAFFIC_EVENT_MAX = 1000;

export const CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const SSE_POLL_MS = 500;
export const SSE_HEARTBEAT_MS = 3000;
/** A terminal Run whose controller task is still busy (AI report) keeps its streams open this long. */
export const SSE_TERMINAL_GRACE_MS = 180_000;
export const SSE_MAX_LIFETIME_MS = 30 * 60_000;

export const EXAMPLES: readonly { label: string; text: string }[] = [
  {
    label: 'Gacha banner launch',
    text: 'A new Uma Musume banner drops tonight; 500 players open the store, browse the catalog, check the ledger, 10% place an order.',
  },
  {
    label: 'Streamer shout-out',
    text: 'A streamer with 20,000 viewers mentions the shop on a live stream. Expect a burst of about 200 visitors over ten minutes who open the store, browse the catalog and look at a few product pages. Almost nobody orders.',
  },
  {
    label: 'Weekend sale',
    text: 'The weekend Fate/Grand Order sale starts at noon. Around 300 shoppers check the catalog and several product pages in a row, then about 5% of them place an order.',
  },
];

/** Fixed, user-facing sentences. None of them contains request data. */
const MSG = {
  invalid: 'The request is not valid.',
  invalidJson: 'The request body is not valid JSON.',
  tooLarge: 'The request body is larger than 64 KiB.',
  trafficEvent: `The Traffic_Event must be text of ${TRAFFIC_EVENT_MIN} to 1,000 characters after leading and trailing spaces are removed.`,
  turnstile: 'Human verification failed. Please try again.',
  inferenceNotConfigured: 'AI planning is not configured on this server.',
  planningFailed: 'The planning model could not produce a usable plan. Please try again.',
  planRejected: 'The Test_Plan was rejected. Nothing was stored and no Run was started.',
  notFound: 'Not found.',
  methodNotAllowed: 'This endpoint does not accept that HTTP method.',
  internal: 'Something went wrong on the server. Please try again.',
} as const;

// ---------------------------------------------------------------------- types

/** What `createApp` needs from RunController and ProbeController. */
export interface RunStarter {
  start(runId: string): void;
  stop(runId: string): boolean;
  isRunning(runId: string): boolean;
}

export type TurnstileVerifier = (token: string | undefined, ip: string) => Promise<{ ok: boolean }>;
export type PlannerFn = (trafficEvent: string, draftId: string) => Promise<PlanOutcome>;

/** The part of `Bun.Server` this module uses. */
export interface ServerLike {
  timeout(req: Request, seconds: number): void;
}

export interface Clock {
  /** Runs `fn` every `ms`; returns the function that cancels it. */
  every(fn: () => void, ms: number): () => void;
}

export interface AppDeps {
  store: Store;
  /** The EFFECTIVE config (`sandbox.runtimeError` already set when the runtime is unusable). */
  config: Config;
  verifyTurnstile: TurnstileVerifier;
  client: InferenceClient;
  /** Defaults to `planTrafficEvent({ client, target: config.target }, ...)`. */
  planner?: PlannerFn;
  runController: RunStarter;
  probeController: RunStarter;
  now?: () => number;
  clock?: Clock;
  /** Directory served as the Web_UI. Defaults to `<repo>/web/dist`. */
  webDist?: string;
  sse?: {
    pollMs?: number;
    heartbeatMs?: number;
    terminalGraceMs?: number;
    maxLifetimeMs?: number;
  };
  /** Receives one JSON line per internal error. Defaults to `console.error`. */
  log?: (line: string) => void;
}

export interface App {
  fetch(req: Request, server?: ServerLike): Promise<Response>;
}

const defaultClock: Clock = {
  every(fn, ms) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

// ------------------------------------------------------------------- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } as const;

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

type ErrorExtras = Omit<ApiErrorBody['error'], 'code' | 'message'>;

function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  extras: ErrorExtras = {},
  headers?: Record<string, string>,
): Response {
  const body: ApiErrorBody = { error: { code, message, ...extras } };
  return json(status, body, headers);
}

function retryAfter(targetMs: number, now: number): Record<string, string> {
  return { 'retry-after': String(Math.max(1, Math.ceil((targetMs - now) / 1000))) };
}

function withSecurityHeaders(res: Response): Response {
  const apply = (h: Headers): void => {
    h.set('Content-Security-Policy', CSP);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
  };
  try {
    apply(res.headers);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    apply(headers);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

type BodyRead = { ok: true; value: unknown } | { ok: false; res: Response };

/** Reads a JSON body of at most 64 KiB. An empty body is `{}`. */
async function readJsonBody(req: Request): Promise<BodyRead> {
  const tooLarge = (): BodyRead => ({ ok: false, res: apiError(413, 'invalid_input', MSG.tooLarge) });
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) return tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body !== null) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return tooLarge();
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, res: apiError(400, 'invalid_input', MSG.invalid) };
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, res: apiError(400, 'invalid_input', MSG.invalidJson) };
  }
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, res: apiError(400, 'invalid_input', MSG.invalidJson) };
  }
}

const PlanBody = z.object({ trafficEvent: z.unknown().optional(), turnstileToken: z.unknown().optional() });
const ApproveBody = z.object({ planText: z.string().min(1), turnstileToken: z.unknown().optional() });
const RerunBody = z.object({ planHash: z.string(), turnstileToken: z.unknown().optional() });
const ProbeBody = z.object({ turnstileToken: z.unknown().optional() });

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ------------------------------------------------------------------ gate demo

const GateDemoBody = z.object({ scenario: z.enum(['other_host', 'too_big', 'unknown_route']) });

/** At most this many gate-demo requests per client IP in any rolling minute (in memory only). */
export const GATE_DEMO_LIMIT = { max: 30, windowMs: 60_000 } as const;

interface GateDemoCase {
  title: string;
  description: string;
  plan: TestPlan;
}

/** Fixed hostile plans. Every value has the right type, so the parser accepts them and only the Policy_Gate can refuse. */
function gateDemoCase(scenario: GateDemoScenario, webOrigin: string): GateDemoCase {
  const thresholds = { p95Ms: 1500, errorRatePct: 2 };
  switch (scenario) {
    case 'other_host':
      return {
        title: 'A plan that targets another site',
        description: 'The plan aims the test at https://www.tokopedia.com, a site that is not the demo store.',
        plan: {
          name: 'Flash sale stress test',
          target: 'https://www.tokopedia.com',
          stages: [
            { vus: 50, durationSec: 60 },
            { vus: 100, durationSec: 60 },
          ],
          journey: [
            { route: 'store_home', probability: 100, thinkMs: 500 },
            { route: 'catalog_list', probability: 80, thinkMs: 500 },
          ],
          stopThresholds: thresholds,
        },
      };
    case 'too_big':
      return {
        title: 'A plan that asks for far too much load',
        description: 'The plan asks for 12 stages, up to 50,000 virtual users and a single stage of 3,600 seconds.',
        plan: {
          name: 'Take the store down',
          target: webOrigin,
          stages: [
            ...Array.from({ length: 11 }, (_, i) => ({ vus: (i + 1) * 40, durationSec: 60 })),
            { vus: 50_000, durationSec: 3600 },
          ],
          journey: [
            { route: 'store_home', probability: 100, thinkMs: 200 },
            { route: 'catalog_list', probability: 100, thinkMs: 200 },
          ],
          stopThresholds: thresholds,
        },
      };
    case 'unknown_route':
      return {
        title: 'A plan that calls a route outside the catalog',
        description:
          'The plan visits the route admin_export_all_users, which does not exist in the Route_Catalog, and places an order on every visit.',
        plan: {
          name: 'Export everything and order',
          target: webOrigin,
          stages: [
            { vus: 10, durationSec: 30 },
            { vus: 20, durationSec: 30 },
          ],
          journey: [
            { route: 'store_home', probability: 100, thinkMs: 500 },
            { route: 'admin_export_all_users', probability: 100, thinkMs: 0 },
            { route: 'order_create', probability: 100, thinkMs: 500 },
          ],
          stopThresholds: thresholds,
        },
      };
  }
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function toParseErrorView(e: ParseError): ParseErrorView {
  return {
    reason: e.reason,
    ...(e.path !== undefined ? { path: e.path } : {}),
    ...(e.offset !== undefined ? { offset: e.offset } : {}),
  };
}

function toModelCallView(r: ModelCallRow): ModelCallView {
  return {
    agent: r.agent,
    model: r.model,
    outcome: r.outcome,
    latencyMs: r.latencyMs,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
  };
}

function toRunView(r: RunRow): RunView {
  return {
    id: r.id,
    kind: r.kind,
    planHash: r.planHash,
    status: r.status,
    statusReason: r.statusReason,
    runtime: r.runtime,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    probeResult: r.probeResult,
  };
}

function toEventView(e: StoredEvent): EventView {
  return { id: e.id, type: e.type, runId: e.runId, stageIdx: e.stageIdx ?? null, payload: e.payload, ts: e.ts };
}

function headlineValue(body: unknown, key: 'safeCapacity' | 'breakingPoint'): number | null {
  if (!isRecord(body)) return null;
  const h = body['headline'];
  if (!isRecord(h)) return null;
  const v = h[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ------------------------------------------------------------------- the app

interface Ctx {
  req: Request;
  url: URL;
  ip: string;
  server: ServerLike | undefined;
  params: string[];
}
type Handler = (c: Ctx) => Response | Promise<Response>;
interface RouteDef {
  method: 'GET' | 'POST';
  re: RegExp;
  name: string;
  handler: Handler;
}

export function createApp(deps: AppDeps): App {
  const { store, config } = deps;
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? ((line: string) => console.error(line));
  const webRoot = resolve(deps.webDist ?? join(import.meta.dir, '..', 'web', 'dist'));
  const sseCfg = {
    pollMs: deps.sse?.pollMs ?? SSE_POLL_MS,
    heartbeatMs: deps.sse?.heartbeatMs ?? SSE_HEARTBEAT_MS,
    terminalGraceMs: deps.sse?.terminalGraceMs ?? SSE_TERMINAL_GRACE_MS,
    maxLifetimeMs: deps.sse?.maxLifetimeMs ?? SSE_MAX_LIFETIME_MS,
  };
  const planner: PlannerFn =
    deps.planner ??
    ((trafficEvent, draftId) => planTrafficEvent({ client: deps.client, target: config.target }, trafficEvent, draftId));

  const controllerFor = (kind: RunKind): RunStarter => (kind === 'probe' ? deps.probeController : deps.runController);

  function logInternal(where: string, err: unknown): void {
    try {
      log(JSON.stringify({ level: 'error', code: 'internal_error', where, error: err instanceof Error ? err.name : 'unknown' }));
    } catch {
      // Logging must never throw into a request.
    }
  }

  // ------------------------------------------------------------ shared steps

  async function turnstileGate(token: unknown, ip: string): Promise<Response | null> {
    const t = typeof token === 'string' ? token : undefined;
    let ok = false;
    try {
      ok = (await deps.verifyTurnstile(t, ip)).ok === true;
    } catch (err) {
      logInternal('turnstile', err);
    }
    return ok ? null : apiError(403, 'turnstile_failed', MSG.turnstile);
  }

  function admissionFailure(res: Extract<AdmissionResult, { ok: false }>, at: number): Response {
    const extras: ErrorExtras = {
      ...(res.retryAt !== undefined ? { retryAt: res.retryAt } : {}),
      ...(res.resetAt !== undefined ? { resetAt: res.resetAt } : {}),
      ...(res.activeRunId !== undefined ? { activeRunId: res.activeRunId } : {}),
    };
    switch (res.code) {
      case 'rate_limited':
        return apiError(429, 'rate_limited', res.message, extras, res.retryAt !== undefined ? retryAfter(res.retryAt, at) : undefined);
      case 'daily_limit':
        return apiError(429, 'daily_limit', res.message, extras, res.resetAt !== undefined ? retryAfter(res.resetAt, at) : undefined);
      case 'run_active':
        return apiError(409, 'run_active', res.message, extras);
      case 'runtime_unavailable':
        return apiError(503, 'runtime_unavailable', res.message, extras);
      case 'plan_not_approved':
        return apiError(404, 'plan_not_approved', res.message, extras);
    }
  }

  /** Admission, then the `running` status event, then the controller. */
  function admitAndStart(kind: RunKind, planHash: string | undefined, ip: string): Response {
    const at = now();
    const admitted = admitStart(
      { store, config },
      { kind, ...(planHash !== undefined ? { planHash } : {}), ip, now: at },
    );
    if (!admitted.ok) return admissionFailure(admitted, at);
    const runId = admitted.runId;
    try {
      store.appendEvent({ type: 'status', runId, payload: { status: 'running' }, ts: at });
    } catch (err) {
      logInternal('start.status_event', err);
      try {
        store.setRunStatus(runId, 'failed', 'The Run could not be started because of an internal error.', now());
      } catch (err2) {
        logInternal('start.mark_failed', err2);
      }
      return apiError(500, 'internal', MSG.internal);
    }
    controllerFor(kind).start(runId);
    const body: StartResponse = { runId, planHash: kind === 'run' ? (planHash ?? null) : null };
    return json(200, body);
  }

  // ---------------------------------------------------------------- handlers

  const health: Handler = () => json(200, { ok: true });

  const getConfig: Handler = () => {
    const body: ConfigResponse = {
      webOrigin: config.target.webOrigin,
      apiOrigin: config.target.apiOrigin,
      turnstileSiteKey: config.turnstile.siteKey,
      runtime: config.sandbox.runtime,
      runtimeError: config.sandbox.runtimeError ?? null,
      examples: EXAMPLES.map((e) => ({ label: e.label, text: e.text })),
      catalog: ROUTE_CATALOG.map((r) => ({ id: r.id, role: r.role, method: r.method, path: r.path })),
      trafficEventMin: 10,
      trafficEventMax: 1000,
    };
    return json(200, body, { 'cache-control': 'no-cache' });
  };

  const postPlan: Handler = async ({ req, ip, server }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = PlanBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.trafficEvent);

    // 1.4: length first; no Turnstile or inference call on invalid input.
    const raw = parsed.data.trafficEvent;
    if (typeof raw !== 'string') return apiError(400, 'invalid_input', MSG.trafficEvent);
    const trafficEvent = raw.trim();
    const length = [...trafficEvent].length;
    if (length < TRAFFIC_EVENT_MIN || length > TRAFFIC_EVENT_MAX) return apiError(400, 'invalid_input', MSG.trafficEvent);

    const denied = await turnstileGate(parsed.data.turnstileToken, ip);
    if (denied !== null) return denied; // 9.8: does not count toward any limit

    // 9.4: rolling per-IP planning limit; the request is recorded in the same transaction as the check.
    const at = now();
    const limit = store.transaction(() => {
      const check = rollingCheck({
        timestamps: store.planningRequestTimestamps(ip, at - PLANNING_LIMIT.windowMs),
        now: at,
        windowMs: PLANNING_LIMIT.windowMs,
        max: PLANNING_LIMIT.max,
      });
      if (check.allowed) store.recordPlanningRequest(ip, at);
      return check;
    });
    if (!limit.allowed) {
      return apiError(
        429,
        'rate_limited',
        `Planning limit reached: at most ${PLANNING_LIMIT.max} planning requests per 60 minutes per client. Try again after ${formatUtc(limit.retryAt)}.`,
        { retryAt: limit.retryAt },
        retryAfter(limit.retryAt, at),
      );
    }

    if (!deps.client.configured) return apiError(503, 'inference_not_configured', MSG.inferenceNotConfigured);

    // The planner may take up to four model attempts; do not let Bun's idle timeout cut the response.
    server?.timeout(req, 0);

    const draftId = crypto.randomUUID();
    store.createDraft({ id: draftId, trafficEvent, createdAt: at });

    let outcome: PlanOutcome;
    try {
      outcome = await planner(trafficEvent, draftId);
    } catch (err) {
      logInternal('planner', err);
      return apiError(502, 'planning_failed', MSG.planningFailed);
    }
    if (!outcome.ok) {
      return outcome.error === 'inference_not_configured'
        ? apiError(503, 'inference_not_configured', MSG.inferenceNotConfigured)
        : apiError(502, 'planning_failed', MSG.planningFailed);
    }

    const modelCalls = store.listModelCallsForDraft(draftId).map(toModelCallView);
    if (outcome.plan === null) {
      const body: PlanResponse = {
        draftId,
        plan: null,
        planText: null,
        planHash: null,
        rationale: null,
        gate: null,
        parseError: toParseErrorView(outcome.parseError),
        modelCalls,
      };
      return json(200, body);
    }
    const gate: GateView =
      outcome.gate.status === 'accepted'
        ? { status: 'accepted' }
        : {
            status: 'rejected',
            violations: outcome.gate.violations.map((v) => ({ rule: v.rule, path: v.path, message: v.message })),
          };
    const body: PlanResponse = {
      draftId,
      plan: outcome.plan,
      planText: outcome.planText,
      planHash: outcome.planHash,
      rationale: outcome.rationale,
      gate,
      parseError: null,
      modelCalls,
    };
    return json(200, body);
  };

  const postApprove: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = ApproveBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const denied = await turnstileGate(parsed.data.turnstileToken, ip);
    if (denied !== null) return denied;

    // 4.9, 5.6: parse and gate the exact text the user approved; reject without storing anything.
    const result = parsePlan(parsed.data.planText);
    if (!result.ok) {
      return apiError(422, 'plan_rejected', MSG.planRejected, { parseError: toParseErrorView(result.error) });
    }
    const gate = evaluatePlan(result.plan, config.target.allowlist);
    if (gate.status === 'rejected') {
      return apiError(422, 'plan_rejected', MSG.planRejected, {
        violations: gate.violations.map((v) => ({ rule: v.rule, path: v.path, message: v.message })),
      });
    }

    const text = printPlan(result.plan);
    const hash = hashPlanText(text);
    store.storeApprovedPlan({ hash, text, approvedAt: now() });
    return admitAndStart('run', hash, ip);
  };

  const postRuns: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = RerunBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const denied = await turnstileGate(parsed.data.turnstileToken, ip);
    if (denied !== null) return denied;
    return admitAndStart('run', parsed.data.planHash, ip);
  };

  const postProbe: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = ProbeBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const denied = await turnstileGate(parsed.data.turnstileToken, ip);
    if (denied !== null) return denied;
    return admitAndStart('probe', undefined, ip);
  };

  // Per-IP rolling limit for /api/gate-demo. Memory only; never touches the store.
  const gateDemoHits = new Map<string, number[]>();

  function gateDemoAllow(ip: string, at: number): { ok: true } | { ok: false; retryAt: number } {
    const since = at - GATE_DEMO_LIMIT.windowMs;
    if (gateDemoHits.size > 1000) {
      for (const [key, hits] of gateDemoHits) {
        if (hits.every((t) => t <= since)) gateDemoHits.delete(key);
      }
    }
    const recent = (gateDemoHits.get(ip) ?? []).filter((t) => t > since);
    const oldest = recent[0];
    if (oldest !== undefined && recent.length >= GATE_DEMO_LIMIT.max) {
      gateDemoHits.set(ip, recent);
      return { ok: false, retryAt: oldest + GATE_DEMO_LIMIT.windowMs };
    }
    recent.push(at);
    gateDemoHits.set(ip, recent);
    return { ok: true };
  }

  const postGateDemo: Handler = async ({ req, ip }) => {
    const at = now();
    const allowed = gateDemoAllow(ip, at);
    if (!allowed.ok) {
      return apiError(
        429,
        'rate_limited',
        'Too many policy gate demos. Please wait a minute and try again.',
        { retryAt: allowed.retryAt },
        retryAfter(allowed.retryAt, at),
      );
    }
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = GateDemoBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const scenario = parsed.data.scenario;
    const demo = gateDemoCase(scenario, config.target.webOrigin);
    const planText = JSON.stringify(demo.plan, null, 2);
    // The real pipeline: the same parser and gate that guard /api/approve.
    const result = parsePlan(planText);
    if (!result.ok) {
      logInternal('gate_demo.parse', new Error('parse'));
      return apiError(500, 'internal', MSG.internal);
    }
    const gate = evaluatePlan(result.plan, config.target.allowlist);
    if (gate.status !== 'rejected') {
      // Safety net: never present a rejection that did not happen.
      logInternal('gate_demo.accepted', new Error('accepted'));
      return apiError(500, 'internal', MSG.internal);
    }
    const body: GateDemoResponse = {
      scenario,
      title: demo.title,
      description: demo.description,
      planText,
      gate: {
        status: 'rejected',
        violations: gate.violations.map((v) => ({ rule: v.rule, path: v.path, message: v.message })),
      },
      requestsSent: 0,
    };
    return json(200, body);
  };

  function runIdParam(c: Ctx): string | null {
    const id = safeDecode(c.params[0] ?? '');
    return id !== null && ID_RE.test(id) ? id : null;
  }

  const notFound = (): Response => apiError(404, 'not_found', MSG.notFound);

  const postStop: Handler = (c) => {
    const id = runIdParam(c);
    if (id === null) return notFound();
    const run = store.getRun(id);
    if (run === null) return notFound();
    // 9.2: no Turnstile. Only a running Run needs the controller; a finished one just reports its status.
    if (run.status === 'running') controllerFor(run.kind).stop(id);
    const status = store.getRun(id)?.status ?? run.status;
    const body: StopResponse = { runId: id, status };
    return json(200, body);
  };

  function allEvents(runId: string): EventView[] {
    const out: EventView[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page++) {
      const rows = store.readEventsAfter(runId, cursor, 1000);
      for (const e of rows) out.push(toEventView(e));
      const last = rows[rows.length - 1];
      if (last === undefined || rows.length < 1000) break;
      cursor = last.id;
    }
    return out;
  }

  function planFromStore(planHash: string | null): TestPlan | null {
    if (planHash === null) return null;
    const row = store.getPlan(planHash);
    if (row === null) return null;
    const parsed = parsePlan(row.text);
    return parsed.ok ? parsed.plan : null;
  }

  const getRunSnapshot: Handler = (c) => {
    const id = runIdParam(c);
    if (id === null) return notFound();
    const run = store.getRun(id);
    if (run === null) return notFound();

    const reportRow = store.getReport(id);
    let report: CapacityReport | null = null;
    if (reportRow !== null && isRecord(reportRow.body)) {
      const body = reportRow.body as unknown as CapacityReport;
      report = isRecord(reportRow.ai) ? attachAi(body, reportRow.ai as unknown as AiSection) : body;
    }
    const decisions: DecisionView[] = store.getDecisions(id).map((d) => ({
      stageIdx: d.stageIdx,
      decision: d.decision,
      source: d.source,
      reason: d.reason,
      reasonWithheld: d.reasonWithheld,
    }));
    const snapshot: RunSnapshot = {
      run: toRunView(run),
      plan: planFromStore(run.planHash),
      stages: store.getStages(id).map(toStageViewPayload),
      decisions,
      events: allEvents(id),
      report,
      modelCalls: store.listModelCallsForRun(id).map(toModelCallView),
    };
    return json(200, snapshot);
  };

  const getRunsForPlan: Handler = (c) => {
    const hash = safeDecode(c.params[0] ?? '');
    if (hash === null || !isPlanHash(hash) || !store.hasApprovedPlan(hash)) return notFound();
    const runs: RunListItem[] = store.listRunsForPlan(hash, 20).map((r) => {
      const body = store.getReport(r.id)?.body;
      return {
        runId: r.id,
        startedAt: r.startedAt,
        status: r.status,
        safeCapacity: headlineValue(body, 'safeCapacity'),
        breakingPoint: headlineValue(body, 'breakingPoint'),
      };
    });
    const body: RunListResponse = { planHash: hash, runs };
    return json(200, body);
  };

  const getCompare: Handler = ({ url }) => {
    const a = url.searchParams.get('a');
    const b = url.searchParams.get('b');
    if (a === null || b === null || !ID_RE.test(a) || !ID_RE.test(b)) return apiError(400, 'invalid_input', MSG.invalid);
    const load = (id: string): CompareInput | null => {
      const run = store.getRun(id);
      if (run === null || run.planHash === null) return null;
      const row = store.getReport(id);
      if (row === null || !isRecord(row.body)) return null;
      return { runId: id, planHash: run.planHash, startedAt: run.startedAt, report: row.body as unknown as CapacityReport };
    };
    const left = load(a);
    const right = load(b);
    if (left === null || right === null) return notFound();
    return json(200, { result: compareRuns(left, right) });
  };

  // --------------------------------------------------------------------- SSE

  const getEvents: Handler = ({ req, server, params }) => {
    const id = safeDecode(params[0] ?? '');
    if (id === null || !ID_RE.test(id)) return notFound();
    const run = store.getRun(id);
    if (run === null) return notFound();
    const controller = controllerFor(run.kind);

    server?.timeout(req, 0);

    const header = req.headers.get('last-event-id')?.trim();
    const lastId = header !== undefined && /^\d{1,15}$/.test(header) ? Number(header) : 0;

    let terminalSince: number | null = null;
    /** Terminal, its controller task (report + AI) over, or the grace period for that task is used up. */
    const isFinished = (): boolean => {
      const current = store.getRun(id);
      if (current === null) return true;
      if (current.status === 'running') {
        terminalSince = null;
        return false;
      }
      terminalSince ??= now();
      return !controller.isRunning(id) || now() - terminalSince > sseCfg.terminalGraceMs;
    };

    // A reconnect after the end of a finished Run: 204 tells EventSource to stop reconnecting.
    if (lastId > 0 && isFinished() && store.readEventsAfter(id, lastId, 1).length === 0) {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }

    const encoder = new TextEncoder();
    const startedAt = now();
    let cleanup = (): void => {};
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        let closed = false;
        const cancels: (() => void)[] = [];
        cleanup = (): void => {
          if (closed) return;
          closed = true;
          for (const c of cancels) c();
          cancels.length = 0;
          req.signal.removeEventListener('abort', cleanup);
          try {
            ctl.close();
          } catch {
            // Already closed by the client.
          }
        };
        const send = (text: string): void => {
          if (closed) return;
          try {
            ctl.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };

        let cursor = lastId;
        const tick = (): void => {
          if (closed) return;
          try {
            // Decide "finished" BEFORE reading, so rows written just before the end are still delivered.
            const finished = isFinished();
            let sent = 0;
            for (;;) {
              const rows = store.readEventsAfter(id, cursor, 200);
              for (const e of rows) {
                send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(toEventView(e))}\n\n`);
                cursor = e.id;
              }
              sent += rows.length;
              if (rows.length < 200) break;
            }
            if ((finished && sent === 0) || now() - startedAt > sseCfg.maxLifetimeMs) cleanup();
          } catch (err) {
            logInternal('sse', err);
            cleanup();
          }
        };

        req.signal.addEventListener('abort', cleanup, { once: true });
        send('retry: 3000\n\n');
        tick();
        if (closed) return;
        cancels.push(clock.every(tick, sseCfg.pollMs));
        cancels.push(clock.every(() => send(': hb\n\n'), sseCfg.heartbeatMs));
        if (req.signal.aborted) cleanup();
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  };

  // ------------------------------------------------------------ static files

  async function serveStatic(req: Request, pathname: string): Promise<Response> {
    const missing = (): Response =>
      new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    let rel = safeDecode(pathname);
    if (rel === null || rel.includes('\0') || rel.includes('\\') || !rel.startsWith('/')) return missing();
    if (rel === '/') rel = '/index.html';
    if (rel.split('/').some((seg) => seg.startsWith('.'))) return missing(); // no dotfiles, no "..", no "."
    const abs = resolve(webRoot, `.${rel}`);
    if (abs !== webRoot && !abs.startsWith(webRoot + sep)) return missing();

    let size: number;
    try {
      const st = await stat(abs);
      if (!st.isFile()) return missing();
      size = st.size;
    } catch {
      return missing();
    }

    const ext = extname(abs).toLowerCase();
    const headers: Record<string, string> = {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'content-length': String(size),
    };
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Bun.file(abs), { status: 200, headers });
  }

  // ------------------------------------------------------------------ routing

  const routes: RouteDef[] = [
    { method: 'GET', re: /^\/healthz$/, name: 'healthz', handler: health },
    { method: 'GET', re: /^\/api\/config$/, name: 'config', handler: getConfig },
    { method: 'POST', re: /^\/api\/plan$/, name: 'plan', handler: postPlan },
    { method: 'POST', re: /^\/api\/approve$/, name: 'approve', handler: postApprove },
    { method: 'POST', re: /^\/api\/runs$/, name: 'runs', handler: postRuns },
    { method: 'POST', re: /^\/api\/probe$/, name: 'probe', handler: postProbe },
    { method: 'POST', re: /^\/api\/gate-demo$/, name: 'gate_demo', handler: postGateDemo },
    { method: 'POST', re: /^\/api\/runs\/([^/]+)\/stop$/, name: 'stop', handler: postStop },
    { method: 'GET', re: /^\/api\/runs\/([^/]+)\/events$/, name: 'events', handler: getEvents },
    { method: 'GET', re: /^\/api\/runs\/([^/]+)$/, name: 'run', handler: getRunSnapshot },
    { method: 'GET', re: /^\/api\/plans\/([^/]+)\/runs$/, name: 'plan_runs', handler: getRunsForPlan },
    { method: 'GET', re: /^\/api\/compare$/, name: 'compare', handler: getCompare },
  ];

  async function handle(req: Request, server: ServerLike | undefined): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const isApi = path === '/api' || path.startsWith('/api/');

    if (!isApi && path !== '/healthz') return serveStatic(req, path);

    let methodMismatch = false;
    for (const route of routes) {
      const m = route.re.exec(path);
      if (m === null) continue;
      const method = req.method === 'HEAD' && route.name === 'healthz' ? 'GET' : req.method;
      if (method !== route.method) {
        methodMismatch = true;
        continue;
      }
      const ctx: Ctx = { req, url, ip: clientIp(req), server, params: m.slice(1) };
      try {
        const res = await route.handler(ctx);
        return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
      } catch (err) {
        logInternal(route.name, err);
        return apiError(500, 'internal', MSG.internal);
      }
    }
    if (methodMismatch) {
      const allow = routes.filter((r) => r.re.test(path)).map((r) => r.method);
      return apiError(405, 'invalid_input', MSG.methodNotAllowed, {}, { allow: [...new Set(allow)].join(', ') });
    }
    return notFound();
  }

  return {
    async fetch(req, server) {
      let res: Response;
      try {
        res = await handle(req, server);
      } catch (err) {
        logInternal('fetch', err);
        res = apiError(500, 'internal', MSG.internal);
      }
      return withSecurityHeaders(res);
    },
  };
}
