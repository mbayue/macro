import { z } from 'zod';
import type { PlanOutcome } from '../../agents/planner.ts';
import type {
  ConfigResponse,
  DecisionView,
  DemoTrendsResponse,
  DiscoverResponse,
  EventView,
  GateDemoResponse,
  GateDemoScenario,
  GateView,
  PlanResponse,
  RunListItem,
  RunListResponse,
  RunSnapshot,
  StopResponse,
} from '../../api-types.ts';
import { formatDemoBaselineContext } from '../../metrics/tiger.ts';
import { ROUTE_CATALOG } from '../../plan/catalog.ts';
import { discoverOwnSite, type DiscoveredRoute } from '../../plan/discover.ts';
import { parsePlan } from '../../plan/parser.ts';
import { evaluatePlan } from '../../plan/policy.ts';
import { planHash as hashPlanText, printPlan } from '../../plan/printer.ts';
import { attachAi } from '../../report/build.ts';
import type { AiSection, CapacityReport } from '../../report/build.ts';
import { compareRuns } from '../../report/compare.ts';
import type { CompareInput } from '../../report/compare.ts';
import { formatUtc, isPlanHash } from '../../run/admission.ts';
import { toStageViewPayload } from '../../run/controller.ts';
import { PLANNING_LIMIT, rollingCheck } from '../../run/limits.ts';
import { isPublicHost } from '../../security/public-host.ts';
import type { RunVisibility } from '../../store/db.ts';
import type { TestPlan } from '../../types.ts';
import type { Ctx, Handler, RouteDef, ServerContext } from '../context.ts';
import {
  EXAMPLES,
  GATE_DEMO_LIMIT,
  ID_RE,
  MSG,
  TRAFFIC_EVENT_MAX,
  TRAFFIC_EVENT_MIN,
  apiError,
  isRecord,
  json,
  notFound,
  readJsonBody,
  retryAfter,
  rollingLimiter,
  safeDecode,
  toEventView,
  toModelCallView,
  toParseErrorView,
  toRunView,
} from '../http.ts';

const TargetModeFields = {
  targetMode: z.enum(['demo', 'own']).optional(),
  targetOrigin: z.string().min(1).max(253).optional(),
};
const DiscoverBody = z.object({
  targetOrigin: z.string().min(1).max(253).optional(),
});
const PlanBody = z.object({
  trafficEvent: z.unknown().optional(),
  turnstileToken: z.unknown().optional(),
  routeIds: z.array(z.string().min(1).max(16)).max(128).optional(),
  ...TargetModeFields,
});
const ApproveBody = z.object({
  planText: z.string().min(1),
  turnstileToken: z.unknown().optional(),
  draftId: z.string().min(1).max(64).optional(),
  ...TargetModeFields,
});
const RerunBody = z.object({ planHash: z.string(), turnstileToken: z.unknown().optional() });
const ProbeBody = z.object({ turnstileToken: z.unknown().optional() });
const StopBody = z.object({ turnstileToken: z.unknown().optional() });
const GateDemoBody = z.object({ scenario: z.enum(['other_host', 'too_big', 'unknown_route']) });

function pickRoutes(
  routes: readonly DiscoveredRoute[] | null,
  ids: readonly string[],
): { stored: DiscoveredRoute[]; selected: DiscoveredRoute[] } | null {
  if (routes === null || ids.length < 1 || ids.length > 32) return null;
  if (new Set(ids).size !== ids.length || !ids.includes('r1')) return null;
  const known = new Set(routes.map((row) => row.id));
  if (!ids.every((id) => known.has(id))) return null;
  const want = new Set(ids);
  const stored = routes.map((row) => ({ ...row, defaultOn: want.has(row.id) }));
  return { stored, selected: stored.filter((row) => row.defaultOn) };
}

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

function runIdParam(c: Ctx): string | null {
  const id = safeDecode(c.params[0] ?? '');
  return id !== null && ID_RE.test(id) ? id : null;
}

/** Discovery, planning, approval, run/probe execution, compare, gate-demo, config, and health routes. */
export function runsRoutes(ctx: ServerContext): RouteDef[] {
  const {
    store,
    config,
    deps,
    now,
    planner,
    controllerFor,
    logInternal,
    turnstileGate,
    resolveSession,
    requireSession,
    turnstileUnlessSignedIn,
    resolvePlanTarget,
    admitAndStart,
    canViewRun,
    planFromStore,
    toRunListItem,
  } = ctx;

  // Per-IP rolling limit for /api/gate-demo. Memory only; never touches the store.
  const gateDemoAllow = rollingLimiter(GATE_DEMO_LIMIT);

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
      sampleRunId: store.getLatestPublicCompletedRunId(),
      firebase: config.firebase ?? null,
      githubSignIn: config.auth !== undefined && config.githubAuth !== undefined,
      googleSignIn: config.auth !== undefined && config.googleAuth !== undefined,
    };
    return json(200, body, { 'cache-control': 'no-cache' });
  };

  const getDemoTrends: Handler = async () => {
    const body: DemoTrendsResponse =
      deps.getDemoTrends === undefined
        ? { available: false, windowDays: 30, routes: [] }
        : await deps.getDemoTrends().catch(() => ({ available: false, windowDays: 30 as const, routes: [] }));
    return json(200, body, { 'cache-control': 'no-cache' });
  };

  const postDiscover: Handler = async ({ req }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = DiscoverBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const auth = requireSession(req);
    if (auth instanceof Response) return auth;

    const targetResolved = resolvePlanTarget('own', parsed.data.targetOrigin, auth.user);
    if (!targetResolved.ok) return targetResolved.res;

    const fetchFn = deps.fetchImpl ?? fetch;
    if (fetchFn === fetch && !(await isPublicHost(new URL(targetResolved.target.webOrigin).hostname))) {
      return apiError(
        422,
        'discover_failed',
        `Could not read ${targetResolved.target.webOrigin}/. Nothing was sent to the planner.`,
      );
    }
    const found = await discoverOwnSite(targetResolved.target.webOrigin, fetchFn);
    if (!found.ok) {
      logInternal('discover', new Error(found.reason));
      return apiError(
        422,
        'discover_failed',
        `Could not read ${targetResolved.target.webOrigin}/. Nothing was sent to the planner.`,
      );
    }

    const draftId = crypto.randomUUID();
    store.createDraft({ id: draftId, trafficEvent: '', createdAt: now() });
    store.setDraftDiscovery(draftId, targetResolved.target.webOrigin, found.routes);

    const body: DiscoverResponse = {
      origin: targetResolved.target.webOrigin,
      routes: found.routes.map((r) => ({
        id: r.id,
        path: r.path,
        method: r.method,
        kind: r.kind,
        defaultOn: r.defaultOn,
      })),
    };
    return json(200, body);
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

    const authGate = await turnstileUnlessSignedIn(req, parsed.data.turnstileToken, ip);
    if (authGate.denied !== null) return authGate.denied; // 9.8: does not count toward any limit
    const subject = authGate.subject;

    const targetResolved = resolvePlanTarget(parsed.data.targetMode, parsed.data.targetOrigin, authGate.user);
    if (!targetResolved.ok) return targetResolved.res;

    // 9.4: rolling per-IP (or per-account) planning limit; recorded with the check.
    const at = now();
    const limit = store.transaction(() => {
      const check = rollingCheck({
        timestamps: store.planningRequestTimestamps(subject, at - PLANNING_LIMIT.windowMs),
        now: at,
        windowMs: PLANNING_LIMIT.windowMs,
        max: PLANNING_LIMIT.max,
      });
      if (check.allowed) store.recordPlanningRequest(subject, at);
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

    const ownPlan = (parsed.data.targetMode ?? 'demo') === 'own';
    const routeMismatch = 'Those routes do not match the pages read from the site.';
    let stored: DiscoveredRoute[] | undefined;
    let forPlanner: DiscoveredRoute[] | undefined;
    if (ownPlan && parsed.data.routeIds !== undefined) {
      const prior = store.latestDiscovery(targetResolved.target.webOrigin);
      const picked = pickRoutes(prior?.routes ?? null, parsed.data.routeIds);
      if (prior === null || prior.routes === null || picked === null) return apiError(400, 'invalid_input', routeMismatch);
      stored = picked.stored;
      forPlanner = picked.selected;
    } else if (ownPlan) {
      const fetchFn = deps.fetchImpl ?? fetch;
      if (fetchFn === fetch && !(await isPublicHost(new URL(targetResolved.target.webOrigin).hostname))) {
        return apiError(
          422,
          'discover_failed',
          `Could not read ${targetResolved.target.webOrigin}/. Nothing was sent to the planner.`,
        );
      }
      const found = await discoverOwnSite(targetResolved.target.webOrigin, fetchFn);
      if (!found.ok) {
        logInternal('discover', new Error(found.reason));
        return apiError(
          422,
          'discover_failed',
          `Could not read ${targetResolved.target.webOrigin}/. Nothing was sent to the planner.`,
        );
      }
      stored = found.routes;
      forPlanner = found.routes.filter((row) => row.defaultOn);
    }

    // The planner may take up to four model attempts; do not let Bun's idle timeout cut the response.
    server?.timeout(req, 0);

    const draftId = crypto.randomUUID();
    store.createDraft({ id: draftId, trafficEvent, createdAt: at });
    if (stored !== undefined) store.setDraftDiscovery(draftId, targetResolved.target.webOrigin, stored);

    let baselineNote: string | undefined;
    if (parsed.data.targetMode !== 'own' && deps.getDemoTrends !== undefined) {
      const trends = await Promise.race([
        deps.getDemoTrends(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
      ]).catch(() => null);
      if (trends !== null) baselineNote = formatDemoBaselineContext(trends);
    }

    let outcome: PlanOutcome;
    try {
      outcome = await planner(trafficEvent, draftId, targetResolved.target, forPlanner, baselineNote);
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
        routes: stored ?? [],
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
      routes: stored ?? [],
    };
    return json(200, body);
  };

  const postApprove: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = ApproveBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const authGate = await turnstileUnlessSignedIn(req, parsed.data.turnstileToken, ip);
    if (authGate.denied !== null) return authGate.denied;

    const targetResolved = resolvePlanTarget(parsed.data.targetMode, parsed.data.targetOrigin, authGate.user);
    if (!targetResolved.ok) return targetResolved.res;

    // 4.9, 5.6: parse and gate the exact text the user approved; reject without storing anything.
    const result = parsePlan(parsed.data.planText);
    if (!result.ok) {
      return apiError(422, 'plan_rejected', MSG.planRejected, { parseError: toParseErrorView(result.error) });
    }
    const ownSite = (parsed.data.targetMode ?? 'demo') === 'own';
    const routeMismatch = "This plan's routes do not match the routes read from the site.";
    let ownRoutes: DiscoveredRoute[] | undefined;
    if (ownSite) {
      if (parsed.data.draftId === undefined) return apiError(400, 'invalid_input', MSG.invalid);
      const draft = store.getDraft(parsed.data.draftId);
      const verified = authGate.user === null ? null : store.getVerifiedOrigin(authGate.user.id);
      const ids = new Set(draft?.selectedIds ?? []);
      const routesMatch = result.plan.journey.every((step) => ids.has(step.route));
      const originOk =
        draft !== null &&
        draft.origin !== null &&
        draft.routes !== null &&
        verified !== null &&
        draft.origin === verified.origin &&
        result.plan.target === draft.origin &&
        result.plan.target === verified.origin;
      if (!originOk || !routesMatch) return apiError(422, 'plan_rejected', routeMismatch);
      ownRoutes = (draft.routes ?? []).filter((row) => ids.has(row.id));
    }
    const gate = evaluatePlan(result.plan, targetResolved.target.allowlist, ownRoutes);
    if (gate.status === 'rejected') {
      return apiError(422, 'plan_rejected', MSG.planRejected, {
        violations: gate.violations.map((v) => ({ rule: v.rule, path: v.path, message: v.message })),
      });
    }

    const text = printPlan(result.plan);
    const hash = hashPlanText(text);
    store.storeApprovedPlan({ hash, text, approvedAt: now() });
    if (ownSite && ownRoutes !== undefined) {
      const origin = result.plan.target;
      store.storePlanTarget({ planHash: hash, webOrigin: origin, apiOrigin: origin, routes: ownRoutes });
    }
    return admitAndStart('run', hash, authGate.subject, {
      ownerUserId: authGate.user?.id ?? null,
      visibility: ownSite ? 'private' : 'public',
    });
  };

  const postRuns: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = RerunBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const authGate = await turnstileUnlessSignedIn(req, parsed.data.turnstileToken, ip);
    if (authGate.denied !== null) return authGate.denied;
    // Reruns inherit privacy from prior runs of the same plan when any were private for this user.
    let visibility: RunVisibility = 'public';
    if (authGate.user !== null) {
      const prior = store.listRunsForPlan(parsed.data.planHash, 5);
      if (prior.some((r) => r.visibility === 'private' && r.ownerUserId === authGate.user!.id)) {
        visibility = 'private';
      }
    }
    return admitAndStart('run', parsed.data.planHash, authGate.subject, {
      ownerUserId: authGate.user?.id ?? null,
      visibility,
    });
  };

  const postProbe: Handler = async ({ req, ip }) => {
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = ProbeBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);

    const authGate = await turnstileUnlessSignedIn(req, parsed.data.turnstileToken, ip);
    if (authGate.denied !== null) return authGate.denied;
    return admitAndStart('probe', undefined, authGate.subject, {
      ownerUserId: authGate.user?.id ?? null,
      visibility: 'public',
    });
  };

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

  const postStop: Handler = async (c) => {
    const id = runIdParam(c);
    if (id === null) return notFound();
    const run = store.getRun(id);
    if (run === null || !canViewRun(run, c.req)) return notFound();
    if (run.visibility === 'public' && resolveSession(c.req) === null) {
      const read = await readJsonBody(c.req);
      if (!read.ok) return read.res;
      const parsed = StopBody.safeParse(read.value);
      if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
      const denied = await turnstileGate(parsed.data.turnstileToken, c.ip);
      if (denied !== null) return denied;
    }
    // Queued runs cancel immediately; running runs stop via their controller.
    if (run.status === 'queued') {
      const stoppedAt = now();
      if (store.stopQueuedRun(id, stoppedAt)) {
        store.appendEvent({ type: 'status', runId: id, payload: { status: 'stopped' }, ts: stoppedAt });
      }
    } else if (run.status === 'running') {
      controllerFor(run.kind).stop(id);
    }
    const status = store.getRun(id)?.status ?? run.status;
    const body: StopResponse = { runId: id, status };
    return json(200, body);
  };

  const getRunSnapshot: Handler = (c) => {
    const id = runIdParam(c);
    if (id === null) return notFound();
    const run = store.getRun(id);
    if (run === null || !canViewRun(run, c.req)) return notFound();

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
    const storedTarget = run.planHash === null ? null : store.getPlanTarget(run.planHash);
    const queuePosition = run.status === 'queued' ? store.getQueuePosition(id) : null;
    const snapshot: RunSnapshot = {
      run: toRunView(run, queuePosition),
      plan: planFromStore(run.planHash),
      stages: store.getStages(id).map((s) => {
        const rows = store.readStageSamples(id, s.idx);
        const view = toStageViewPayload(s);
        if (rows.length === 0) return view;
        return {
          ...view,
          samples: rows.map((r) => ({
            second: r.second,
            route: r.route,
            requests: r.requests,
            errors: r.errors,
            avgMs: r.requests > 0 ? r.latencySumMs / r.requests : 0,
            maxMs: r.latencyMaxMs,
          })),
        };
      }),
      decisions,
      events: allEvents(id),
      report,
      modelCalls: store.listModelCallsForRun(id).map(toModelCallView),
      routes:
        storedTarget === null
          ? []
          : storedTarget.routes.map((r) => ({ id: r.id, path: r.path, method: r.method, kind: r.kind })),
    };
    return json(200, snapshot);
  };

  const getRunsForPlan: Handler = (c) => {
    const hash = safeDecode(c.params[0] ?? '');
    if (hash === null || !isPlanHash(hash) || !store.hasApprovedPlan(hash)) return notFound();
    const runs: RunListItem[] = store
      .listRunsForPlan(hash, 20)
      .filter((r) => canViewRun(r, c.req))
      .map(toRunListItem);
    const body: RunListResponse = { planHash: hash, runs };
    return json(200, body);
  };

  const getCompare: Handler = ({ req, url }) => {
    const a = url.searchParams.get('a');
    const b = url.searchParams.get('b');
    if (a === null || b === null || !ID_RE.test(a) || !ID_RE.test(b)) return apiError(400, 'invalid_input', MSG.invalid);
    const load = (id: string): CompareInput | null => {
      const run = store.getRun(id);
      if (run === null || run.planHash === null || !canViewRun(run, req)) return null;
      const row = store.getReport(id);
      if (row === null || !isRecord(row.body)) return null;
      return { runId: id, planHash: run.planHash, startedAt: run.startedAt, report: row.body as unknown as CapacityReport };
    };
    const left = load(a);
    const right = load(b);
    if (left === null || right === null) return notFound();
    return json(200, { result: compareRuns(left, right) });
  };

  return [
    { method: 'GET', re: /^\/healthz$/, name: 'healthz', handler: health },
    { method: 'GET', re: /^\/api\/config$/, name: 'config', handler: getConfig },
    { method: 'GET', re: /^\/api\/trends\/demo$/, name: 'demo_trends', handler: getDemoTrends },
    { method: 'POST', re: /^\/api\/discover$/, name: 'discover', handler: postDiscover },
    { method: 'POST', re: /^\/api\/plan$/, name: 'plan', handler: postPlan },
    { method: 'POST', re: /^\/api\/approve$/, name: 'approve', handler: postApprove },
    { method: 'POST', re: /^\/api\/runs$/, name: 'runs', handler: postRuns },
    { method: 'POST', re: /^\/api\/probe$/, name: 'probe', handler: postProbe },
    { method: 'POST', re: /^\/api\/gate-demo$/, name: 'gate_demo', handler: postGateDemo },
    { method: 'POST', re: /^\/api\/runs\/([^/]+)\/stop$/, name: 'stop', handler: postStop },
    { method: 'GET', re: /^\/api\/runs\/([^/]+)$/, name: 'run', handler: getRunSnapshot },
    { method: 'GET', re: /^\/api\/plans\/([^/]+)\/runs$/, name: 'plan_runs', handler: getRunsForPlan },
    { method: 'GET', re: /^\/api\/compare$/, name: 'compare', handler: getCompare },
  ];
}
