import { z } from 'zod';
import type {
  AccountDraft,
  AccountRunsResponse,
  QuotaResponse,
  RunListItem,
  WaitlistResponse,
} from '../../api-types.ts';
import { DAILY_IP_MAX, DAILY_MAX, PLANNING_LIMIT } from '../../run/limits.ts';
import type { Handler, RouteDef, ServerContext } from '../context.ts';
import {
  MSG,
  TRAFFIC_EVENT_MAX,
  WAITLIST_LIMIT,
  apiError,
  json,
  normaliseEmail,
  readJsonBody,
  retryAfter,
  rollingLimiter,
} from '../http.ts';

const AccountDraftBody = z.object({
  trafficEvent: z.string().max(TRAFFIC_EVENT_MAX),
  targetMode: z.enum(['demo', 'own']),
  targetOrigin: z.string().max(253).nullable(),
  lastEditedAt: z.number().int().nonnegative(),
});

const WaitlistBody = z.object({ email: z.string().max(320), turnstileToken: z.unknown().optional() });

const EMPTY_DRAFT: AccountDraft = {
  trafficEvent: '',
  targetMode: 'demo',
  targetOrigin: null,
  lastEditedAt: 0,
};

function toAccountDraftView(row: {
  trafficEvent: string;
  targetMode: 'demo' | 'own';
  targetOrigin: string | null;
  lastEditedAt: number;
}): AccountDraft {
  return {
    trafficEvent: row.trafficEvent,
    targetMode: row.targetMode,
    targetOrigin: row.targetOrigin,
    lastEditedAt: row.lastEditedAt,
  };
}

/** Account draft, owned runs, quota, and waitlist routes. */
export function accountRoutes(ctx: ServerContext): RouteDef[] {
  const { store, now, logInternal, resolveSession, requireAuth, turnstileGate, toRunListItem } = ctx;

  // Per-IP rolling limit for /api/waitlist. Memory only.
  const waitlistAllow = rollingLimiter(WAITLIST_LIMIT);

  const getDraft: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const row = store.getAccountDraft(auth.user.id);
    return json(200, row === null ? EMPTY_DRAFT : toAccountDraftView(row));
  };

  const putDraft: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = AccountDraftBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
    const incoming = parsed.data;
    try {
      const result = store.putAccountDraft(auth.user.id, {
        trafficEvent: incoming.trafficEvent,
        targetMode: incoming.targetMode,
        targetOrigin: incoming.targetOrigin,
        lastEditedAt: incoming.lastEditedAt,
      });
      if ('conflict' in result) {
        return json(409, { draft: toAccountDraftView(result.conflict) });
      }
      return json(200, toAccountDraftView(result.stored));
    } catch (err) {
      logInternal('draft.put', err);
      return apiError(500, 'internal', MSG.internal);
    }
  };

  const getAccountRuns: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const runs: RunListItem[] = store.listRunsForOwner(auth.user.id, 50).map(toRunListItem);
    const body: AccountRunsResponse = { runs };
    return json(200, body);
  };

  const getQuota: Handler = async ({ req, ip }) => {
    const at = now();
    const auth = resolveSession(req);
    const subject = auth !== null ? `user:${auth.user.id}` : ip;
    const planningUsed = store.planningRequestTimestamps(subject, at - PLANNING_LIMIT.windowMs).length;
    const d = new Date(at);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dailyLimit = auth !== null ? DAILY_MAX : DAILY_IP_MAX;
    const dailyUsed = store.clientStartTimestamps(subject, dayStart - 1).length;
    const body: QuotaResponse = {
      scope: auth !== null ? 'account' : 'ip',
      planning: {
        used: planningUsed,
        limit: PLANNING_LIMIT.max,
        remaining: Math.max(0, PLANNING_LIMIT.max - planningUsed),
      },
      dailyRuns: {
        used: dailyUsed,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - dailyUsed),
      },
    };
    return json(200, body, { 'cache-control': 'no-store' });
  };

  const postWaitlist: Handler = async ({ req, ip }) => {
    const at = now();
    const allowed = waitlistAllow(ip, at);
    if (!allowed.ok) {
      return apiError(
        429,
        'rate_limited',
        'Too many sign-ups from this connection. Please try again later.',
        { retryAt: allowed.retryAt },
        retryAfter(allowed.retryAt, at),
      );
    }
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = WaitlistBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
    const email = normaliseEmail(parsed.data.email);
    if (email === null) return apiError(400, 'invalid_input', MSG.email);

    const denied = await turnstileGate(parsed.data.turnstileToken, ip);
    if (denied !== null) return denied;
    try {
      store.addWaitlistEmail(email, at);
    } catch (err) {
      logInternal('waitlist.add', err);
      return apiError(500, 'internal', MSG.internal);
    }
    // The address is never logged; a new and a repeated sign-up get the same answer.
    const body: WaitlistResponse = { ok: true };
    return json(200, body);
  };

  return [
    { method: 'GET', re: /^\/api\/draft$/, name: 'draft_get', handler: getDraft },
    { method: 'PUT', re: /^\/api\/draft$/, name: 'draft_put', handler: putDraft },
    { method: 'GET', re: /^\/api\/account\/runs$/, name: 'account_runs', handler: getAccountRuns },
    { method: 'GET', re: /^\/api\/quota$/, name: 'quota', handler: getQuota },
    { method: 'POST', re: /^\/api\/waitlist$/, name: 'waitlist', handler: postWaitlist },
  ];
}
