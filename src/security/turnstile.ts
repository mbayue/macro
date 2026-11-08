// Cloudflare Turnstile server-side verification (requirements 9.7, 9.8). Never throws.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 10_000;

export type TurnstileFailure =
  | 'missing_token'
  | 'token_too_long'
  | 'rejected'
  | 'http_error'
  | 'bad_response'
  | 'network_error'
  | 'timeout';

export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure };

export interface TurnstileDeps {
  secretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string | undefined,
  deps: TurnstileDeps,
): Promise<TurnstileResult> {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing_token' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'token_too_long' };

  const form = new FormData();
  form.append('secret', deps.secretKey);
  form.append('response', token);
  if (ip !== undefined && ip !== '' && ip !== 'unknown') form.append('remoteip', ip);

  const doFetch = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
  }

  if (response.status < 200 || response.status > 299) return { ok: false, reason: 'http_error' };

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'bad_response' };
  }
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'bad_response' };
  return (body as Record<string, unknown>)['success'] === true ? { ok: true } : { ok: false, reason: 'rejected' };
}
