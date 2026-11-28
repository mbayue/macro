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

import { join, resolve } from 'node:path';
import { planTrafficEvent } from './agents/planner.ts';
import type { RunListItem, StartResponse } from './api-types.ts';
import { parseSessionId, SESSION_TTL_MS } from './auth/session.ts';
import type { SessionRow, UserRow } from './auth/types.ts';
import { normalizeVerifyHost } from './auth/verify-origin.ts';
import type { Config } from './config.ts';
import { parsePlan } from './plan/parser.ts';
import { admitStart } from './run/admission.ts';
import type { AdmissionResult } from './run/admission.ts';
import { LOAD_TEST_TITLE, PROBE_TITLE, normalizeRunTitle } from './run/title.ts';
import { clientIp } from './security/client-ip.ts';
import type { RunRow, RunVisibility } from './store/db.ts';
import type { RunKind, TestPlan } from './types.ts';
import type {
  App,
  AppDeps,
  Clock,
  Ctx,
  PlannerFn,
  RouteDef,
  RunStarter,
  ServerContext,
  ServerLike,
} from './server/context.ts';
import {
  CSP,
  EXAMPLES,
  GATE_DEMO_LIMIT,
  MAGIC_LINK_COOLDOWN,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
  MAX_BODY_BYTES,
  MSG,
  TRAFFIC_EVENT_MAX,
  TRAFFIC_EVENT_MIN,
  WAITLIST_LIMIT,
  apiError,
  headlineValue,
  json,
  normaliseEmail,
  notFound,
  retryAfter,
  withSecurityHeaders,
  type ErrorExtras,
} from './server/http.ts';
import { accountRoutes } from './server/routes/account.ts';
import { authRoutes } from './server/routes/auth.ts';
import { runsRoutes } from './server/routes/runs.ts';
import { verifyRoutes } from './server/routes/verify.ts';
import {
  SSE_HEARTBEAT_MS,
  SSE_MAX_LIFETIME_MS,
  SSE_MAX_PER_IP,
  SSE_MAX_TOTAL,
  SSE_POLL_MS,
  SSE_TERMINAL_GRACE_MS,
  createSseHandler,
} from './server/sse.ts';
import { createStaticHandler } from './server/static.ts';

export {
  CSP,
  EXAMPLES,
  GATE_DEMO_LIMIT,
  MAGIC_LINK_COOLDOWN,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
  MAX_BODY_BYTES,
  SSE_HEARTBEAT_MS,
  SSE_MAX_LIFETIME_MS,
  SSE_MAX_PER_IP,
  SSE_MAX_TOTAL,
  SSE_POLL_MS,
  SSE_TERMINAL_GRACE_MS,
  TRAFFIC_EVENT_MAX,
  TRAFFIC_EVENT_MIN,
  WAITLIST_LIMIT,
  normaliseEmail,
};
export type { App, AppDeps, Clock, PlannerFn, RunStarter, ServerLike, TurnstileVerifier } from './server/context.ts';

const defaultClock: Clock = {
  every(fn, ms) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

export function createApp(deps: AppDeps): App {
  const { store, config } = deps;
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? defaultClock;
  const log = deps.log ?? ((line: string) => console.error(line));
  const webRoot = resolve(deps.webDist ?? join(import.meta.dir, '..', 'web', 'dist'));
  // Secure cookies only when PUBLIC_BASE_URL is https (local http smoke needs Secure off).
  const cookieSecure = config.auth === undefined || new URL(config.auth.publicBaseUrl).protocol === 'https:';
  const sseCfg = {
    pollMs: deps.sse?.pollMs ?? SSE_POLL_MS,
    heartbeatMs: deps.sse?.heartbeatMs ?? SSE_HEARTBEAT_MS,
    terminalGraceMs: deps.sse?.terminalGraceMs ?? SSE_TERMINAL_GRACE_MS,
    maxLifetimeMs: deps.sse?.maxLifetimeMs ?? SSE_MAX_LIFETIME_MS,
    maxPerIp: deps.sse?.maxPerIp ?? SSE_MAX_PER_IP,
    maxTotal: deps.sse?.maxTotal ?? SSE_MAX_TOTAL,
  };
  const planner: PlannerFn =
    deps.planner ??
    ((trafficEvent, draftId, target, discovered, baselineNote) =>
      planTrafficEvent(
        {
          client: deps.client,
          target: target ?? config.target,
          ...(discovered !== undefined ? { discovered } : {}),
          ...(baselineNote !== undefined ? { baselineNote } : {}),
        },
        trafficEvent,
        draftId,
      ));

  /** Demo allowlist, or the account's single verified origin for own-site. */
  function resolvePlanTarget(
    mode: 'demo' | 'own' | undefined,
    targetOrigin: string | undefined,
    user: UserRow | null,
  ): { ok: true; target: Config['target'] } | { ok: false; res: Response } {
    const m = mode ?? 'demo';
    if (m === 'demo') return { ok: true, target: config.target };
    if (user === null) return { ok: false, res: apiError(401, 'auth_required', MSG.authRequired) };
    const verified = store.getVerifiedOrigin(user.id, now());
    if (verified === null) {
      return { ok: false, res: apiError(403, 'verification_required', MSG.verificationRequired) };
    }
    if (targetOrigin === undefined || targetOrigin.trim() === '') {
      return { ok: false, res: apiError(400, 'invalid_input', MSG.invalid) };
    }
    const norm = normalizeVerifyHost(targetOrigin);
    if (!norm.ok || norm.origin !== verified.origin) {
      return { ok: false, res: apiError(400, 'invalid_input', MSG.invalid) };
    }
    return {
      ok: true,
      target: {
        webOrigin: verified.origin,
        apiOrigin: verified.origin,
        allowlist: [verified.origin],
      },
    };
  }

  const controllerFor = (kind: RunKind): RunStarter => (kind === 'probe' ? deps.probeController : deps.runController);

  function logInternal(where: string, err: unknown): void {
    try {
      log(JSON.stringify({ level: 'error', code: 'internal_error', where, error: err instanceof Error ? err.name : 'unknown' }));
    } catch {
      // Logging must never throw into a request.
    }
  }

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

  /** Valid non-expired session, or null. Slides expiry on success. */
  function resolveSession(req: Request): { user: UserRow; session: SessionRow } | null {
    const sid = parseSessionId(req.headers.get('cookie'));
    if (sid === null) return null;
    const session = store.getSession(sid);
    if (session === null) return null;
    const at = now();
    if (session.expiresAt < at) {
      store.deleteSession(sid);
      return null;
    }
    const user = store.getUser(session.userId);
    if (user === null) return null;
    const touched = store.touchSession(sid, at, SESSION_TTL_MS) ?? session;
    return { user, session: touched };
  }

  function requireSession(req: Request): { user: UserRow; session: SessionRow } | Response {
    const auth = resolveSession(req);
    if (auth === null) return apiError(401, 'auth_required', MSG.authRequired);
    return auth;
  }

  function requireAuth(req: Request): { user: UserRow; session: SessionRow } | Response {
    if (config.auth === undefined) {
      return apiError(503, 'auth_unavailable', MSG.authUnavailable);
    }
    return requireSession(req);
  }

  /** Skip Turnstile when a valid session is present. */
  async function turnstileUnlessSignedIn(
    req: Request,
    token: unknown,
    ip: string,
  ): Promise<{ denied: Response | null; subject: string; user: UserRow | null }> {
    const auth = resolveSession(req);
    if (auth !== null) {
      return { denied: null, subject: `user:${auth.user.id}`, user: auth.user };
    }
    return { denied: await turnstileGate(token, ip), subject: ip, user: null };
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
      case 'queue_full':
        return apiError(429, 'queue_full', res.message, extras);
      case 'runtime_unavailable':
        return apiError(503, 'runtime_unavailable', res.message, extras);
      case 'plan_not_approved':
        return apiError(404, 'plan_not_approved', res.message, extras);
    }
  }

  const isSlotBusy = (): boolean => Boolean(deps.runController.hasActive?.() || deps.probeController.hasActive?.());

  function startRunAndWatch(kind: RunKind, runId: string): void {
    const ctl = controllerFor(kind);
    ctl.start(runId);
    const done = ctl.whenDone?.(runId);
    if (done !== undefined) void done.finally(drainQueue);
  }

  function drainQueue(): void {
    if (config.sandbox.runtimeError !== undefined) return;
    if (isSlotBusy()) return;
    const next = store.claimNextQueuedRun(now());
    if (next === null) return;
    try {
      store.appendEvent({ type: 'status', runId: next.id, payload: { status: 'running' }, ts: now() });
    } catch (err) {
      logInternal('queue.status_event', err);
      try {
        store.setRunStatus(next.id, 'failed', 'The Run could not be started because of an internal error.', now());
      } catch (err2) {
        logInternal('queue.mark_failed', err2);
      }
      queueMicrotask(drainQueue);
      return;
    }
    startRunAndWatch(next.kind, next.id);
  }

  queueMicrotask(drainQueue);

  /** Admission, then `running` or `queued` status event, then the controller when active. */
  function admitAndStart(
    kind: RunKind,
    planHash: string | undefined,
    subject: string,
    ownership: { ownerUserId: string | null; visibility: RunVisibility } = {
      ownerUserId: null,
      visibility: 'public',
    },
  ): Response {
    const at = now();
    const admitted = admitStart(
      { store, config, isSlotBusy },
      {
        kind,
        ...(planHash !== undefined ? { planHash } : {}),
        ip: subject,
        now: at,
        ownerUserId: ownership.ownerUserId,
        visibility: ownership.visibility,
      },
    );
    if (!admitted.ok) return admissionFailure(admitted, at);
    const runId = admitted.runId;
    try {
      const payload =
        admitted.status === 'queued'
          ? { status: 'queued', queuePosition: admitted.queuePosition }
          : { status: 'running' };
      store.appendEvent({ type: 'status', runId, payload, ts: at });
    } catch (err) {
      logInternal('start.status_event', err);
      try {
        if (admitted.status === 'queued') {
          store.stopQueuedRun(runId, now());
        } else {
          store.setRunStatus(runId, 'failed', 'The Run could not be started because of an internal error.', now());
        }
      } catch (err2) {
        logInternal('start.mark_failed', err2);
      }
      return apiError(500, 'internal', MSG.internal);
    }
    if (admitted.status === 'running') startRunAndWatch(kind, runId);
    const body: StartResponse = {
      runId,
      planHash: kind === 'run' ? (planHash ?? null) : null,
      status: admitted.status,
      queuePosition: admitted.queuePosition,
    };
    return json(200, body);
  }

  /** Private runs are indistinguishable from missing unless the viewer owns them. */
  function canViewRun(run: { visibility: RunVisibility; ownerUserId: string | null }, req: Request): boolean {
    if (run.visibility !== 'private') return true;
    const auth = resolveSession(req);
    return auth !== null && auth.user.id === run.ownerUserId;
  }

  function planFromStore(planHash: string | null): TestPlan | null {
    if (planHash === null) return null;
    const row = store.getPlan(planHash);
    if (row === null) return null;
    const parsed = parsePlan(row.text);
    return parsed.ok ? parsed.plan : null;
  }

  function runTitle(run: RunRow): string {
    if (run.title !== null && run.title.trim() !== '') return run.title;
    if (run.kind === 'probe') return PROBE_TITLE;
    return normalizeRunTitle(planFromStore(run.planHash)?.name, LOAD_TEST_TITLE);
  }

  function toRunListItem(r: RunRow): RunListItem {
    const body = store.getReport(r.id)?.body;
    return {
      runId: r.id,
      kind: r.kind,
      startedAt: r.startedAt,
      status: r.status,
      safeCapacity: headlineValue(body, 'safeCapacity'),
      breakingPoint: headlineValue(body, 'breakingPoint'),
      title: runTitle(r),
    };
  }

  const ctx: ServerContext = {
    store,
    config,
    deps,
    now,
    clock,
    cookieSecure,
    planner,
    controllerFor,
    logInternal,
    turnstileGate,
    resolveSession,
    requireSession,
    requireAuth,
    turnstileUnlessSignedIn,
    resolvePlanTarget,
    admitAndStart,
    canViewRun,
    planFromStore,
    toRunListItem,
  };

  const serveStatic = createStaticHandler(webRoot);
  const getEvents = createSseHandler(ctx, sseCfg);

  const routes: RouteDef[] = [
    ...authRoutes(ctx),
    ...verifyRoutes(ctx),
    ...accountRoutes(ctx),
    { method: 'GET', re: /^\/api\/runs\/([^/]+)\/events$/, name: 'events', handler: getEvents },
    ...runsRoutes(ctx),
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
      const routeCtx: Ctx = { req, url, ip: clientIp(req), server, params: m.slice(1) };
      try {
        const res = await route.handler(routeCtx);
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
