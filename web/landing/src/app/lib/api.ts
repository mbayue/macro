/**
 * Typed fetch client for the HTTP API in src/api-types.ts.
 *
 * Every function resolves (never rejects) to
 *   { ok: true, data } | { ok: false, error }
 * Network failures, non-JSON bodies and 5xx responses without the uniform error
 * body become a synthetic `internal` error with a fixed message.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  ApproveRequest,
  ConfigResponse,
  GateDemoRequest,
  GateDemoResponse,
  ParseErrorView,
  PlanRequest,
  PlanResponse,
  PolicyViolationView,
  ProbeRequest,
  RerunRequest,
  RunListResponse,
  RunSnapshot,
  StartResponse,
  StopResponse,
} from '../../../../../src/api-types.ts';

export type ApiError = ApiErrorBody['error'];
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const INTERNAL_ERROR: ApiError = {
  code: 'internal',
  message: 'Something went wrong on the server. Please try again.',
};
export const NETWORK_ERROR: ApiError = {
  code: 'internal',
  message: 'Could not reach the server. Check your connection and try again.',
};
/** Used by views when the Turnstile widget fails or expires. */
export const VERIFICATION_ERROR: ApiError = {
  code: 'turnstile_failed',
  message: 'Human verification did not complete. Please try again.',
};

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'invalid_input',
  'turnstile_failed',
  'rate_limited',
  'daily_limit',
  'run_active',
  'plan_not_approved',
  'plan_rejected',
  'runtime_unavailable',
  'inference_not_configured',
  'planning_failed',
  'not_found',
  'internal',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseViolations(v: unknown): PolicyViolationView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PolicyViolationView[] = [];
  for (const item of v) {
    if (!isRecord(item)) continue;
    const { rule, path, message } = item;
    if (
      (rule === '4.2' || rule === '4.3' || rule === '4.4' || rule === '4.5' || rule === '4.6') &&
      typeof path === 'string' &&
      typeof message === 'string'
    ) {
      out.push({ rule, path, message });
    }
  }
  return out;
}

function parseParseError(v: unknown): ParseErrorView | undefined {
  if (!isRecord(v) || typeof v['reason'] !== 'string') return undefined;
  const pe: ParseErrorView = { reason: v['reason'] };
  if (typeof v['path'] === 'string') pe.path = v['path'];
  if (typeof v['offset'] === 'number') pe.offset = v['offset'];
  return pe;
}

/** Accept only a well-formed uniform error body; copy known fields only. */
function parseErrorBody(v: unknown): ApiError | null {
  if (!isRecord(v) || !isRecord(v['error'])) return null;
  const e = v['error'];
  if (typeof e['code'] !== 'string' || typeof e['message'] !== 'string') return null;
  const code = (KNOWN_CODES.has(e['code']) ? e['code'] : 'internal') as ApiErrorCode;
  const out: ApiError = { code, message: e['message'] };
  if (typeof e['retryAt'] === 'number') out.retryAt = e['retryAt'];
  if (typeof e['resetAt'] === 'number') out.resetAt = e['resetAt'];
  if (typeof e['activeRunId'] === 'string') out.activeRunId = e['activeRunId'];
  const violations = parseViolations(e['violations']);
  if (violations) out.violations = violations;
  const parseError = parseParseError(e['parseError']);
  if (parseError) out.parseError = parseError;
  return out;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, headers, cache: 'no-store', credentials: 'same-origin' };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (signal) init.signal = signal;

  let text: string;
  let okStatus: boolean;
  try {
    const res = await fetch(path, init);
    okStatus = res.ok;
    text = await res.text();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }

  if (!okStatus) {
    const parsed = parseErrorBody(json);
    if (parsed) return { ok: false, error: parsed };
    // 5xx or any other failure without the uniform body.
    return { ok: false, error: INTERNAL_ERROR };
  }
  if (json === undefined || json === null) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: json as T };
}

const enc = encodeURIComponent;

export function getConfig(signal?: AbortSignal): Promise<ApiResult<ConfigResponse>> {
  return request<ConfigResponse>('GET', '/api/config', undefined, signal);
}

export function postPlan(body: PlanRequest, signal?: AbortSignal): Promise<ApiResult<PlanResponse>> {
  return request<PlanResponse>('POST', '/api/plan', body, signal);
}

export function postApprove(body: ApproveRequest, signal?: AbortSignal): Promise<ApiResult<StartResponse>> {
  return request<StartResponse>('POST', '/api/approve', body, signal);
}

/** Re-run an approved plan by hash (POST /api/runs). */
export function postRun(body: RerunRequest, signal?: AbortSignal): Promise<ApiResult<StartResponse>> {
  return request<StartResponse>('POST', '/api/runs', body, signal);
}

export function stopRun(runId: string, signal?: AbortSignal): Promise<ApiResult<StopResponse>> {
  return request<StopResponse>('POST', `/api/runs/${enc(runId)}/stop`, undefined, signal);
}

export function getRun(runId: string, signal?: AbortSignal): Promise<ApiResult<RunSnapshot>> {
  return request<RunSnapshot>('GET', `/api/runs/${enc(runId)}`, undefined, signal);
}

export function getRunsForPlan(planHash: string, signal?: AbortSignal): Promise<ApiResult<RunListResponse>> {
  return request<RunListResponse>('GET', `/api/plans/${enc(planHash)}/runs`, undefined, signal);
}

/** Comparison payload is `{ result: Comparison }` (src/report/compare.ts); typed `unknown` for now. */
export function getCompare(a: string, b: string, signal?: AbortSignal): Promise<ApiResult<unknown>> {
  return request<unknown>('GET', `/api/compare?a=${enc(a)}&b=${enc(b)}`, undefined, signal);
}

export function postProbe(body: ProbeRequest, signal?: AbortSignal): Promise<ApiResult<StartResponse>> {
  return request<StartResponse>('POST', '/api/probe', body, signal);
}

/** Deterministic Policy_Gate demonstration (POST /api/gate-demo). No Turnstile, no side effects. */
export function postGateDemo(
  body: GateDemoRequest,
  signal?: AbortSignal,
): Promise<ApiResult<GateDemoResponse>> {
  return request<GateDemoResponse>('POST', '/api/gate-demo', body, signal);
}
