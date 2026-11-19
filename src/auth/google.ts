/** Google OAuth URL, code exchange, and verified-email identity resolution (injectable fetch). */

export interface GoogleAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** Builds the Google OAuth 2.0 authorization URL for OpenID email sign-in. */
export function googleAuthorizeUrl(cfg: GoogleAuthConfig, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Exchanges an authorization code for a Google access token. */
export async function exchangeGoogleCode(
  cfg: GoogleAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string } | { error: 'oauth_failed' }> {
  try {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) return { error: 'oauth_failed' };
    const data = (await res.json()) as { access_token?: unknown };
    if (typeof data.access_token !== 'string' || data.access_token === '') {
      return { error: 'oauth_failed' };
    }
    return { accessToken: data.access_token };
  } catch {
    return { error: 'oauth_failed' };
  }
}

/** Fetches the Google OpenID userinfo and requires a verified email address. */
export async function fetchGoogleIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ subject: string; email: string } | { error: 'oauth_failed' | 'no_email' }> {
  try {
    const res = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return { error: 'oauth_failed' };
    const user = (await res.json()) as { sub?: unknown; email?: unknown; email_verified?: unknown };
    if (typeof user.sub !== 'string' || user.sub === '') return { error: 'oauth_failed' };
    if (user.email_verified !== true || typeof user.email !== 'string' || user.email.trim() === '') {
      return { error: 'no_email' };
    }
    return { subject: user.sub, email: user.email.trim().toLowerCase() };
  } catch {
    return { error: 'oauth_failed' };
  }
}
