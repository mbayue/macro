import type {
  ApiErrorBody,
  ApiErrorCode,
  EventView,
  ModelCallView,
  ParseErrorView,
  RunView,
} from '../api-types.ts';
import type { ParseError } from '../plan/parser.ts';
import type { ModelCallRow, RunRow, StoredEvent } from '../store/db.ts';

export const MAX_BODY_BYTES = 64 * 1024;
export const TRAFFIC_EVENT_MIN = 10;
export const TRAFFIC_EVENT_MAX = 1000;

export const CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://challenges.cloudflare.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; connect-src 'self' https://cloudflareinsights.com https://firebasevertexai.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebaseappcheck.googleapis.com https://firebaseremoteconfig.googleapis.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://www.google.com; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const EXAMPLES: readonly { label: string; text: string }[] = [
  {
    label: 'Campaign spike',
    text: 'A marketing campaign brings 300 visitors to the home page over ten minutes. They browse a few pages and about 5% of them sign up or place an order.',
  },
  {
    label: 'Live mention',
    text: 'A streamer with 2,000 viewers mentions the site on a live stream. Expect a burst of about 200 visitors over ten minutes who open the home page and browse a few pages. Almost nobody orders.',
  },
  {
    label: 'Weekend sale',
    text: 'The weekend sale starts at noon. Around 300 shoppers check the catalog and several product pages in a row, then about 5% of them place an order.',
  },
];

/** Fixed, user-facing sentences. None of them contains request data. */
export const MSG = {
  invalid: 'The request is not valid.',
  invalidJson: 'The request body is not valid JSON.',
  tooLarge: 'The request body is larger than 64 KiB.',
  trafficEvent: `The Traffic_Event must be text of ${TRAFFIC_EVENT_MIN} to 1,000 characters after leading and trailing spaces are removed.`,
  turnstile: 'Human verification failed. Please try again.',
  email: 'Enter a valid email address.',
  inferenceNotConfigured: 'AI planning is not configured on this server.',
  planningFailed: 'The planning model could not produce a usable plan. Please try again.',
  planRejected: 'The Test_Plan was rejected. Nothing was stored and no Run was started.',
  notFound: 'Not found.',
  methodNotAllowed: 'This endpoint does not accept that HTTP method.',
  authUnavailable: 'Sign-in is not configured on this server.',
  authRequired: 'Sign in to continue.',
  magicLinkInvalid: 'This sign-in link is invalid or has already been used.',
  githubOauthFailed: 'GitHub sign-in failed. Please try again.',
  googleOauthFailed: 'Google sign-in failed. Please try again.',
  verifyPending: 'Start verification for a host before checking.',
  verifyFailed: 'Macro could not find the verification token on that host yet. Try again after the DNS or file is in place.',
  contestedOrigin: 'That site is already verified by another Macro account.',
  verificationRequired: 'Verify your site before drafting or approving an own-site plan.',
  internal: 'Something went wrong on the server. Please try again.',
} as const;

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** At most this many gate-demo requests per client IP in any rolling minute (in memory only). */
export const GATE_DEMO_LIMIT = { max: 30, windowMs: 60_000 } as const;

/** At most this many waitlist sign-ups per client IP in any rolling hour (in memory only). */
export const WAITLIST_LIMIT = { max: 5, windowMs: 3_600_000 } as const;
/** At most this many magic-link emails per client IP, and per address, in any rolling hour. */
export const MAGIC_LINK_IP_LIMIT = { max: 5, windowMs: 3_600_000 } as const;
export const MAGIC_LINK_EMAIL_LIMIT = { max: 3, windowMs: 3_600_000 } as const;
/** One send, then 60 seconds before the next, per connection and per address. */
export const MAGIC_LINK_COOLDOWN = { max: 1, windowMs: 60_000 } as const;

export const OAUTH_STATE_COOKIE = 'macro_oauth_state';
const OAUTH_STATE_TTL_SEC = 600;

export function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (cookieHeader === null || cookieHeader === '') return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    const value = trimmed.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

export function serializeOauthStateCookie(state: string, secure: boolean): string {
  const base = `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SEC}`;
  return secure ? `${base}; Secure` : base;
}

export function clearOauthStateCookie(secure: boolean): string {
  const base = `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } as const;

export function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export type ErrorExtras = Omit<ApiErrorBody['error'], 'code' | 'message'>;

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  extras: ErrorExtras = {},
  headers?: Record<string, string>,
): Response {
  const body: ApiErrorBody = { error: { code, message, ...extras } };
  return json(status, body, headers);
}

export const notFound = (): Response => apiError(404, 'not_found', MSG.notFound);

export function retryAfter(targetMs: number, now: number): Record<string, string> {
  return { 'retry-after': String(Math.max(1, Math.ceil((targetMs - now) / 1000))) };
}

export function withSecurityHeaders(res: Response): Response {
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

export type BodyRead = { ok: true; value: unknown } | { ok: false; res: Response };

/** Reads a JSON body of at most 64 KiB. An empty body is `{}`. */
export async function readJsonBody(req: Request): Promise<BodyRead> {
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

/** Same-origin relative path for post-login redirect; rejects absolute URLs, protocol-relative, and control chars. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '/app/#/';
  if (/[\x00-\x1f\x7f]/.test(raw)) return '/app/#/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/app/#/';
  try {
    const parsed = new URL(raw, 'https://macro.invalid');
    if (parsed.origin !== 'https://macro.invalid') return '/app/#/';
  } catch {
    return '/app/#/';
  }
  return raw;
}

/** Longest address SMTP allows (RFC 5321 path limit). */
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Trimmed, lower-cased email, or null when it is not a plausible address. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > EMAIL_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>"'`,;\\]/.test(email)) return null;
  return EMAIL_RE.test(email) ? email : null;
}

/** A per-key rolling-window limiter kept in memory. */
export function rollingLimiter(limit: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return (key: string, at: number, record = true): { ok: true } | { ok: false; retryAt: number } => {
    const since = at - limit.windowMs;
    if (hits.size > 1000) {
      for (const [k, list] of hits) {
        if (list.every((t) => t <= since)) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((t) => t > since);
    const oldest = recent[0];
    if (oldest !== undefined && recent.length >= limit.max) {
      hits.set(key, recent);
      return { ok: false, retryAt: oldest + limit.windowMs };
    }
    if (!record) return { ok: true };
    recent.push(at);
    hits.set(key, recent);
    return { ok: true };
  };
}

export function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function toParseErrorView(e: ParseError): ParseErrorView {
  return {
    reason: e.reason,
    ...(e.path !== undefined ? { path: e.path } : {}),
    ...(e.offset !== undefined ? { offset: e.offset } : {}),
  };
}

export function toModelCallView(r: ModelCallRow): ModelCallView {
  return {
    agent: r.agent,
    model: r.model,
    outcome: r.outcome,
    latencyMs: r.latencyMs,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
  };
}

export function toRunView(r: RunRow, queuePosition: number | null = null): RunView {
  return {
    id: r.id,
    kind: r.kind,
    planHash: r.planHash,
    status: r.status,
    statusReason: r.statusReason,
    runtime: r.runtime,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    visibility: r.visibility,
    queuePosition,
    probeResult: r.probeResult,
  };
}

export function toEventView(e: StoredEvent): EventView {
  return { id: e.id, type: e.type, runId: e.runId, stageIdx: e.stageIdx ?? null, payload: e.payload, ts: e.ts };
}

export function headlineValue(body: unknown, key: 'safeCapacity' | 'breakingPoint'): number | null {
  if (!isRecord(body)) return null;
  const h = body['headline'];
  if (!isRecord(h)) return null;
  const v = h[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
