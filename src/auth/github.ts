/** GitHub OAuth URL, code exchange, and email resolution (injectable fetch). */

export interface GithubAuthConfig {
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly githubRedirectUri: string;
}

export function githubAuthorizeUrl(cfg: GithubAuthConfig, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', cfg.githubClientId);
  url.searchParams.set('redirect_uri', cfg.githubRedirectUri);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubCode(
  cfg: GithubAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string } | { error: 'oauth_failed' }> {
  try {
    const res = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        client_id: cfg.githubClientId,
        client_secret: cfg.githubClientSecret,
        code,
        redirect_uri: cfg.githubRedirectUri,
      }),
    });
    if (!res.ok) return { error: 'oauth_failed' };
    const body = (await res.json()) as { access_token?: unknown; error?: unknown };
    if (typeof body.access_token !== 'string' || body.access_token === '') return { error: 'oauth_failed' };
    return { accessToken: body.access_token };
  } catch {
    return { error: 'oauth_failed' };
  }
}

type GithubEmail = { email: string; primary: boolean; verified: boolean };

export async function fetchGithubIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ subject: string; login: string; email: string } | { error: 'no_email' | 'oauth_failed' }> {
  try {
    const userRes = await fetchImpl('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'macro-load-tester',
      },
    });
    if (!userRes.ok) return { error: 'oauth_failed' };
    const user = (await userRes.json()) as { id?: unknown; login?: unknown };
    if (typeof user.id !== 'number' && typeof user.id !== 'string') return { error: 'oauth_failed' };
    if (typeof user.login !== 'string' || user.login === '') return { error: 'oauth_failed' };
    const subject = String(user.id);

    const emailRes = await fetchImpl('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'macro-load-tester',
      },
    });
    if (!emailRes.ok) return { error: 'oauth_failed' };
    const emails = (await emailRes.json()) as unknown;
    if (!Array.isArray(emails)) return { error: 'no_email' };
    const verified = emails.filter(
      (e): e is GithubEmail =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as GithubEmail).email === 'string' &&
        (e as GithubEmail).verified === true,
    );
    if (verified.length === 0) return { error: 'no_email' };
    const primary = verified.find((e) => e.primary) ?? verified[0]!;
    return { subject, login: user.login, email: primary.email.trim().toLowerCase() };
  } catch {
    return { error: 'oauth_failed' };
  }
}
