/**
 * HTTP API contract between src/server.ts and the Web_UI (web/*).
 * Types only: no runtime code, so the web bundle can import it freely.
 * Mirrors the "HTTP API" table in .kiro/specs/macro/design.md.
 * Changing a shape here means changing both sides.
 */
import type { CapacityReport } from './report/build.ts';
import type {
  ContainmentType,
  DecisionSource,
  DecisionValue,
  EventType,
  RouteId,
  RunKind,
  RunStatus,
  SandboxRuntime,
  StageMetrics,
  StageVerdict,
  TestPlan,
} from './types.ts';

// ---- Errors ---------------------------------------------------------------

export type ApiErrorCode =
  | 'invalid_input' // body failed validation, Traffic_Event length, etc.
  | 'turnstile_failed' // missing/rejected Turnstile token (or Siteverify unreachable)
  | 'rate_limited' // per-IP rolling limit (retryAt set)
  | 'daily_limit' // 50 Runs per UTC day (resetAt set)
  | 'run_active' // another Run/probe is running (activeRunId set)
  | 'plan_not_approved' // unknown / malformed Plan_Hash
  | 'plan_rejected' // parse error or Policy_Gate violations (see parseError / violations)
  | 'runtime_unavailable' // SANDBOX_RUNTIME problem (requirement 6.13)
  | 'inference_not_configured' // no Vultr inference key (requirement 2.9)
  | 'planning_failed' // both model attempts failed (requirement 2.3)
  | 'not_found'
  | 'auth_unavailable' // auth env not configured on this server
  | 'auth_required' // signed-in action attempted while signed out
  | 'verification_required' // own-site action needs a verified origin
  | 'contested_origin' // another account already holds this verified host
  | 'internal';

export interface PolicyViolationView {
  rule: '4.2' | '4.3' | '4.4' | '4.5' | '4.6';
  path: string;
  message: string;
}

export interface ParseErrorView {
  reason: string;
  path?: string;
  offset?: number;
}

/** Every non-2xx response has this body. `message` is a fixed, human-readable sentence. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryAt?: number; // epoch ms
    resetAt?: number; // epoch ms
    activeRunId?: string;
    violations?: PolicyViolationView[];
    parseError?: ParseErrorView;
  };
}

// ---- GET /api/config ------------------------------------------------------

export interface CatalogRouteView {
  id: RouteId;
  role: 'web' | 'api';
  method: 'GET' | 'POST';
  path: string;
}

export interface ConfigResponse {
  webOrigin: string;
  apiOrigin: string;
  turnstileSiteKey: string;
  runtime: SandboxRuntime;
  runtimeError: string | null;
  examples: { label: string; text: string }[];
  catalog: CatalogRouteView[];
  trafficEventMin: 10;
  trafficEventMax: 1000;
}

// ---- Model calls (requirement 2.6) ----------------------------------------

export interface ModelCallView {
  agent: 'planner' | 'supervisor' | 'reporter';
  model: string;
  outcome: 'success' | 'error' | 'timeout';
  latencyMs: number;
  /** null renders as "not reported". */
  promptTokens: number | null;
  completionTokens: number | null;
}

// ---- POST /api/plan -------------------------------------------------------

export interface PlanRequest {
  trafficEvent: string;
  turnstileToken: string;
  /** Demo shop (default) or the account's verified origin. */
  targetMode?: 'demo' | 'own';
  /** Required when `targetMode` is `own`; must match the verified origin. */
  targetOrigin?: string;
}

export type GateView =
  | { status: 'accepted' }
  | { status: 'rejected'; violations: PolicyViolationView[] };

export interface PlanResponse {
  draftId: string;
  /** null when parsing failed (then `parseError` is set). */
  plan: TestPlan | null;
  /** Canonical Plan_Printer text of `plan`; what the user approves. */
  planText: string | null;
  planHash: string | null;
  rationale: string | null;
  gate: GateView | null;
  parseError: ParseErrorView | null;
  modelCalls: ModelCallView[];
}

// ---- POST /api/approve, /api/runs, /api/probe -----------------------------

export interface ApproveRequest {
  planText: string;
  turnstileToken: string;
  targetMode?: 'demo' | 'own';
  targetOrigin?: string;
}

export interface RerunRequest {
  planHash: string;
  turnstileToken: string;
}

export interface ProbeRequest {
  turnstileToken: string;
}

export interface StartResponse {
  runId: string;
  planHash: string | null; // null for probes
}

export interface StopResponse {
  runId: string;
  status: RunStatus;
}

// ---- GET /api/runs/:id and SSE -------------------------------------------

export interface RunView {
  id: string;
  kind: RunKind;
  planHash: string | null;
  status: RunStatus;
  statusReason: string | null;
  runtime: SandboxRuntime;
  startedAt: number;
  endedAt: number | null;
  /** Probe runs only: see src/k6/probe-result.ts ProbeClassification. */
  probeResult: unknown;
}

export interface StageView {
  index: number;
  vus: number;
  durationSec: number;
  status: 'running' | 'done' | 'error';
  errorReason: string | null;
  verdict: StageVerdict | null;
  metrics: StageMetrics | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface DecisionView {
  stageIdx: number;
  decision: DecisionValue;
  source: DecisionSource;
  reason: string;
  reasonWithheld: boolean;
}

export interface ContainmentEventPayload {
  type: ContainmentType;
  host?: string;
  port?: number;
}

/** One row of the events table; also the `data:` of each SSE message. */
export interface EventView {
  id: number;
  type: EventType;
  runId: string;
  stageIdx: number | null;
  /** For type 'containment': ContainmentEventPayload. For 'status': { status, reason? }. For stage_*: the StageView. For 'decision': DecisionView. For 'report': { ready: true }. */
  payload: unknown;
  ts: number;
}

export interface RunSnapshot {
  run: RunView;
  plan: TestPlan | null;
  stages: StageView[];
  decisions: DecisionView[];
  events: EventView[];
  /** null until the Run has ended and the report is built. */
  report: CapacityReport | null;
  modelCalls: ModelCallView[];
}

// ---- GET /api/plans/:hash/runs --------------------------------------------

export interface RunListItem {
  runId: string;
  startedAt: number;
  status: RunStatus;
  /** null = "none" / "not reached" per requirement 13.2. */
  safeCapacity: number | null;
  breakingPoint: number | null;
}

export interface RunListResponse {
  planHash: string;
  runs: RunListItem[];
}

// ---- SSE ------------------------------------------------------------------
// GET /api/runs/:id/events: `id: <event id>`, `event: <EventType>`, `data: <EventView JSON>`.
// A comment line `: hb` every 3 s. EventSource reconnects with Last-Event-ID and the server
// replays everything after that id.

// GET /api/compare?a=&b= returns { result: Comparison } where Comparison comes from
// src/report/compare.ts (task 11.1).

// ---- POST /api/gate-demo ----------------------------------------------------
// Deterministic demonstration of the Policy_Gate: no Turnstile, no model, no sandbox, no store write.

export type GateDemoScenario = 'other_host' | 'too_big' | 'unknown_route';

export interface GateDemoRequest {
  scenario: GateDemoScenario;
}

export interface GateDemoResponse {
  scenario: GateDemoScenario;
  title: string;
  description: string;
  /** The fixed hostile Test_Plan JSON that was parsed and evaluated. */
  planText: string;
  /** The real Policy_Gate result. Always rejected: an accepted result is a 500, never a demo. */
  gate: Extract<GateView, { status: 'rejected' }>;
  requestsSent: 0;
}

// ---- POST /api/waitlist -----------------------------------------------------

export interface WaitlistRequest {
  email: string;
  turnstileToken: string;
}

/**
 * Always the same body, whether the email was new or already on the list, so the
 * endpoint never reveals who has signed up.
 */
export interface WaitlistResponse {
  ok: true;
}

// ---- Auth -----------------------------------------------------------------

export interface MagicLinkRequest {
  email: string;
  /** Optional same-origin path to return to after consume (e.g. `/app/#/`). */
  returnTo?: string;
}

export interface MagicLinkResponse {
  ok: true;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    githubLogin: string | null;
  };
  verifiedOrigin: { origin: string; host: string } | null;
}

export interface VerifyStartRequest {
  host: string;
}

export interface VerifyStartResponse {
  token: string;
  txtName: string;
  txtValue: string;
  wellKnownUrl: string;
}

export interface VerifyCheckResponse {
  verifiedOrigin: { origin: string; host: string };
}

export interface VerifyClearResponse {
  ok: true;
}
