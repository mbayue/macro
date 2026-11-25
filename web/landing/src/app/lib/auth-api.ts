/** Auth, verification, account draft, and account runs HTTP client helpers. */
import type {
  AccountDraft,
  AccountDraftConflict,
  AccountRunsResponse,
  ClaimResponse,
  MagicLinkResponse,
  MeResponse,
  VerifyCheckResponse,
  VerifyClearResponse,
  VerifyStartResponse,
} from '../../../../../src/api-types.ts';
import { type ApiResult, INTERNAL_ERROR, request } from './api.ts';
import { loadRecentRuns } from './recent-runs.ts';

function parseConflictDraft(json: unknown): AccountDraft | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const draft = (json as Partial<AccountDraftConflict>).draft;
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) return undefined;
  return draft;
}

export function getMe(signal?: AbortSignal): Promise<ApiResult<MeResponse | null>> {
  return request<MeResponse | null>('GET', '/api/me', undefined, signal, {
    onStatus: (status) => (status === 401 ? { ok: true, data: null } : undefined),
  });
}

export function postMagicLink(
  email: string,
  returnTo?: string,
  signal?: AbortSignal,
): Promise<ApiResult<MagicLinkResponse>> {
  return request<MagicLinkResponse>(
    'POST',
    '/api/auth/magic-link',
    { email, ...(returnTo !== undefined ? { returnTo } : {}) },
    signal,
  );
}

export function postSignOut(signal?: AbortSignal): Promise<ApiResult<null>> {
  return request<null>('POST', '/api/auth/sign-out', undefined, signal, { allowEmpty204: true });
}

export function deleteAccount(signal?: AbortSignal): Promise<ApiResult<null>> {
  return request<null>('DELETE', '/api/me', undefined, signal, { allowEmpty204: true });
}

export function githubStartHref(): string {
  return '/api/auth/github/start';
}

export function googleStartHref(): string {
  return '/api/auth/google/start';
}

export function postVerifyStart(host: string, signal?: AbortSignal): Promise<ApiResult<VerifyStartResponse>> {
  return request<VerifyStartResponse>('POST', '/api/verify/start', { host }, signal);
}

export function postVerifyCheck(signal?: AbortSignal): Promise<ApiResult<VerifyCheckResponse>> {
  return request<VerifyCheckResponse>('POST', '/api/verify/check', undefined, signal);
}

export function postVerifyClear(signal?: AbortSignal): Promise<ApiResult<VerifyClearResponse>> {
  return request<VerifyClearResponse>('POST', '/api/verify/clear', undefined, signal);
}

export function getVerifyPending(signal?: AbortSignal): Promise<ApiResult<VerifyStartResponse | null>> {
  return request<VerifyStartResponse | null>('GET', '/api/verify/pending', undefined, signal, {
    onStatus: (status) => (status === 404 || status === 401 ? { ok: true, data: null } : undefined),
  });
}

export function postVerifyCancel(signal?: AbortSignal): Promise<ApiResult<VerifyClearResponse>> {
  return request<VerifyClearResponse>('POST', '/api/verify/cancel', undefined, signal);
}

export function getDraft(signal?: AbortSignal): Promise<ApiResult<AccountDraft>> {
  return request<AccountDraft>('GET', '/api/draft', undefined, signal);
}

/** PUT draft; on 409 returns ok with the winning server draft via `conflict`. */
export async function putDraft(
  draft: AccountDraft,
  signal?: AbortSignal,
): Promise<ApiResult<AccountDraft> & { conflict?: AccountDraft }> {
  let conflict: AccountDraft | undefined;
  const res = await request<AccountDraft>('PUT', '/api/draft', draft, signal, {
    onStatus(status, json) {
      if (status !== 409) return undefined;
      const winner = parseConflictDraft(json);
      if (!winner) return { ok: false, error: INTERNAL_ERROR };
      conflict = winner;
      return { ok: true, data: winner };
    },
  });
  return res.ok && conflict !== undefined ? { ok: true, data: res.data, conflict } : res;
}

export function postClaim(runIds: string[], signal?: AbortSignal): Promise<ApiResult<ClaimResponse>> {
  return request<ClaimResponse>('POST', '/api/auth/claim', { runIds: runIds.slice(0, 10) }, signal);
}

/** Claim browser-local recent demo runs for the signed-in account. */
export async function claimRecentBrowserRuns(): Promise<void> {
  const ids = loadRecentRuns().map((r) => r.id).slice(0, 10);
  if (ids.length === 0) return;
  await postClaim(ids);
}

export function getAccountRuns(signal?: AbortSignal): Promise<ApiResult<AccountRunsResponse>> {
  return request<AccountRunsResponse>('GET', '/api/account/runs', undefined, signal);
}
