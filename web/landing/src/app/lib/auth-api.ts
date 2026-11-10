/** Auth client helpers for /api/me, magic link, sign-out, claim. */
import type { MagicLinkResponse, MeResponse } from '../../../../../src/api-types.ts';
import { type ApiResult, INTERNAL_ERROR, NETWORK_ERROR } from './api.ts';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
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
      const body = (await readJson(res)) as { error?: { code?: string; message?: string } } | null;
      return {
        ok: false,
        error: {
          code: (body?.error?.code as 'invalid_input') ?? 'internal',
          message: body?.error?.message ?? INTERNAL_ERROR.message,
        },
      };
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
