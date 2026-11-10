/** Auth client helpers for /api/me, magic link, sign-out, verify, claim. */
import type {
  MagicLinkResponse,
  MeResponse,
  VerifyCheckResponse,
  VerifyClearResponse,
  VerifyStartResponse,
} from '../../../../../src/api-types.ts';
import { type ApiError, type ApiResult, INTERNAL_ERROR, NETWORK_ERROR } from './api.ts';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function apiErrorFromBody(body: unknown): ApiError {
  const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    code: (e?.code as ApiError['code']) ?? 'internal',
    message: e?.message ?? INTERNAL_ERROR.message,
  };
}

export async function getMe(): Promise<ApiResult<MeResponse | null>> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) return { ok: true, data: null };
    if (!res.ok) return { ok: false, error: INTERNAL_ERROR };
    const body = await readJson(res);
    return { ok: true, data: body as MeResponse };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function postMagicLink(email: string, returnTo?: string): Promise<ApiResult<MagicLinkResponse>> {
  try {
    const res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...(returnTo !== undefined ? { returnTo } : {}) }),
    });
    if (!res.ok) {
      return { ok: false, error: apiErrorFromBody(await readJson(res)) };
    }
    return { ok: true, data: (await readJson(res)) as MagicLinkResponse };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function postSignOut(): Promise<ApiResult<null>> {
  try {
    const res = await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok && res.status !== 204) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export function githubStartHref(): string {
  return '/api/auth/github/start';
}

export async function postVerifyStart(host: string): Promise<ApiResult<VerifyStartResponse>> {
  try {
    const res = await fetch('/api/verify/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host }),
    });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, error: apiErrorFromBody(body) };
    return { ok: true, data: body as VerifyStartResponse };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function postVerifyCheck(): Promise<ApiResult<VerifyCheckResponse>> {
  try {
    const res = await fetch('/api/verify/check', { method: 'POST', credentials: 'same-origin' });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, error: apiErrorFromBody(body) };
    return { ok: true, data: body as VerifyCheckResponse };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function postVerifyClear(): Promise<ApiResult<VerifyClearResponse>> {
  try {
    const res = await fetch('/api/verify/clear', { method: 'POST', credentials: 'same-origin' });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, error: apiErrorFromBody(body) };
    return { ok: true, data: (body as VerifyClearResponse | null) ?? { ok: true } };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}
