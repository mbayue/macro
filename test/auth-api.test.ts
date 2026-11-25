import { afterEach, describe, expect, test } from 'bun:test';
import type { AccountDraft, AccountRunsResponse, MeResponse, VerifyStartResponse } from '../src/api-types.ts';
import { getCompare, INTERNAL_ERROR, NETWORK_ERROR } from '../web/landing/src/app/lib/api.ts';
import {
  deleteAccount,
  getAccountRuns,
  getDraft,
  getMe,
  getVerifyPending,
  postClaim,
  postMagicLink,
  postSignOut,
  postVerifyCancel,
  postVerifyCheck,
  postVerifyClear,
  postVerifyStart,
  putDraft,
} from '../web/landing/src/app/lib/auth-api.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
): { calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return await handler(input, init);
  }) as unknown as typeof fetch;
  return { calls };
}

describe('consolidated auth-api HTTP client', () => {
  test('getAccountRuns sends GET /api/account/runs with no-store, same-origin credentials, and AbortSignal', async () => {
    const payload: AccountRunsResponse = {
      runs: [
        {
          runId: 'run_acct_1',
          kind: 'run',
          startedAt: 1_700_000_000_000,
          status: 'completed',
          safeCapacity: 100,
          breakingPoint: null,
          title: 'Checkout spike',
        },
      ],
    };
    const { calls } = stubFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
    const ac = new AbortController();

    const res = await getAccountRuns(ac.signal);

    expect(res).toEqual({ ok: true, data: payload });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/account/runs');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.cache).toBe('no-store');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect(calls[0]?.init?.signal).toBe(ac.signal);
  });

  test('getAccountRuns surfaces auth_required on 401 and NETWORK_ERROR on fetch failure', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in first.' } }), { status: 401 }),
    );
    expect(await getAccountRuns()).toEqual({
      ok: false,
      error: { code: 'auth_required', message: 'Sign in first.' },
    });

    stubFetch(() => {
      throw new Error('offline');
    });
    expect(await getAccountRuns()).toEqual({ ok: false, error: NETWORK_ERROR });
  });

  test('getMe maps 401 to null, preserves 200 payload, and validates error codes', async () => {
    stubFetch(() => new Response(null, { status: 401 }));
    expect(await getMe()).toEqual({ ok: true, data: null });

    const me: MeResponse = {
      user: { id: 'u1', email: 'a@example.com', githubLogin: 'alice' },
      verifiedOrigin: null,
      pendingVerification: null,
    };
    const ac = new AbortController();
    const { calls } = stubFetch(() => new Response(JSON.stringify(me), { status: 200 }));
    expect(await getMe(ac.signal)).toEqual({ ok: true, data: me });
    expect(calls[0]?.init?.signal).toBe(ac.signal);

    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'auth_unavailable', message: 'Auth off.' } }), { status: 503 }),
    );
    expect(await getMe()).toEqual({ ok: false, error: { code: 'auth_unavailable', message: 'Auth off.' } });
  });

  test('getVerifyPending maps 401 and 404 to null and preserves 200 payload', async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await getVerifyPending()).toEqual({ ok: true, data: null });

    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in.' } }), { status: 401 }),
    );
    expect(await getVerifyPending()).toEqual({ ok: true, data: null });

    const pending: VerifyStartResponse = {
      token: 'tok_123',
      txtName: '_macro.example.com',
      txtValue: 'tok_123',
      wellKnownUrl: 'https://example.com/.well-known/macro.txt',
    };
    stubFetch(() => new Response(JSON.stringify(pending), { status: 200 }));
    expect(await getVerifyPending()).toEqual({ ok: true, data: pending });
  });

  test('postMagicLink preserves retryAt and validates error codes against KNOWN_CODES', async () => {
    const retryAt = 1_700_000_060_000;
    const ac = new AbortController();
    const { calls } = stubFetch(() =>
      new Response(
        JSON.stringify({ error: { code: 'rate_limited', message: 'Wait a minute.', retryAt } }),
        { status: 429 },
      ),
    );

    const limited = await postMagicLink('a@example.com', '/app/#/', ac.signal);
    expect(limited).toEqual({
      ok: false,
      error: { code: 'rate_limited', message: 'Wait a minute.', retryAt },
    });
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.signal).toBe(ac.signal);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: 'a@example.com', returnTo: '/app/#/' });

    // Unknown error code is coerced to 'internal' rather than leaking through.
    stubFetch(() =>
      new Response(
        JSON.stringify({ error: { code: 'totally_unknown_code', message: 'Unexpected.', resetAt: 9999 } }),
        { status: 400 },
      ),
    );
    expect(await postMagicLink('a@example.com')).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Unexpected.', resetAt: 9999 },
    });
  });

  test('postSignOut and deleteAccount handle 204 No Content and uniform error bodies', async () => {
    const signOutCalls = stubFetch(() => new Response(null, { status: 204 })).calls;
    expect(await postSignOut()).toEqual({ ok: true, data: null });
    expect(signOutCalls[0]?.init?.method).toBe('POST');

    const delCalls = stubFetch(() => new Response(null, { status: 204 })).calls;
    expect(await deleteAccount()).toEqual({ ok: true, data: null });
    expect(delCalls[0]?.url).toBe('/api/me');
    expect(delCalls[0]?.init?.method).toBe('DELETE');

    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'daily_limit', message: 'Limit reached.', resetAt: 123456 } }), {
        status: 429,
      }),
    );
    expect(await deleteAccount()).toEqual({
      ok: false,
      error: { code: 'daily_limit', message: 'Limit reached.', resetAt: 123456 },
    });

    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    expect(await postSignOut()).toEqual({ ok: false, error: INTERNAL_ERROR });
  });

  test('putDraft uses PUT and preserves 409 conflict winner shape', async () => {
    const localDraft: AccountDraft = {
      trafficEvent: 'Local draft text',
      targetMode: 'demo',
      targetOrigin: null,
      lastEditedAt: 100,
    };
    const winner: AccountDraft = {
      trafficEvent: 'Newer server draft text',
      targetMode: 'own',
      targetOrigin: 'https://example.com',
      lastEditedAt: 200,
    };

    const { calls } = stubFetch(() => new Response(JSON.stringify({ draft: winner }), { status: 409 }));
    const conflictRes = await putDraft(localDraft);
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(conflictRes).toEqual({ ok: true, data: winner, conflict: winner });

    stubFetch(() => new Response(JSON.stringify(localDraft), { status: 200 }));
    const okRes = await putDraft(localDraft);
    expect(okRes).toEqual({ ok: true, data: localDraft });
    expect(okRes.conflict).toBeUndefined();

    stubFetch(() => new Response(JSON.stringify({}), { status: 409 }));
    expect(await putDraft(localDraft)).toEqual({ ok: false, error: INTERNAL_ERROR });
  });

  test('verify, draft, and claim endpoints delegate cleanly through request<T>', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await postVerifyClear()).toEqual({ ok: true, data: { ok: true } });
    expect(await postVerifyCancel()).toEqual({ ok: true, data: { ok: true } });

    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'contested_origin', message: 'Already verified.' } }), {
        status: 409,
      }),
    );
    expect(await postVerifyCheck()).toEqual({
      ok: false,
      error: { code: 'contested_origin', message: 'Already verified.' },
    });

    const draft: AccountDraft = { trafficEvent: 'Hi', targetMode: 'demo', targetOrigin: null, lastEditedAt: 1 };
    stubFetch(() => new Response(JSON.stringify(draft), { status: 200 }));
    expect(await getDraft()).toEqual({ ok: true, data: draft });

    const claimCalls = stubFetch(() => new Response(JSON.stringify({ claimed: ['r1'] }), { status: 200 })).calls;
    expect(await postClaim(Array.from({ length: 12 }, (_, i) => `r${i}`))).toEqual({
      ok: true,
      data: { claimed: ['r1'] },
    });
    expect(JSON.parse(String(claimCalls[0]?.init?.body))).toEqual({
      runIds: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'],
    });

    stubFetch(() =>
      new Response(JSON.stringify({ error: { code: 'invalid_input', message: 'Bad host.' } }), { status: 400 }),
    );
    expect(await postVerifyStart('bad host')).toEqual({
      ok: false,
      error: { code: 'invalid_input', message: 'Bad host.' },
    });
  });

  test('getCompare continues to return raw JSON as ApiResult<unknown>', async () => {
    const raw = { result: { custom: true } };
    stubFetch(() => new Response(JSON.stringify(raw), { status: 200 }));
    expect(await getCompare('run_a', 'run_b')).toEqual({ ok: true, data: raw });
  });
});
