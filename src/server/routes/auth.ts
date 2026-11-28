import { z } from 'zod';
import type { ClaimResponse, MagicLinkResponse, MeResponse } from '../../api-types.ts';
import { exchangeGithubCode, fetchGithubIdentity, githubAuthorizeUrl } from '../../auth/github.ts';
import { exchangeGoogleCode, fetchGoogleIdentity, googleAuthorizeUrl } from '../../auth/google.ts';
import { generateMagicToken, hashMagicToken, MAGIC_LINK_TTL_MS } from '../../auth/magic-link.ts';
import { parseSessionId, serializeClearSessionCookie, serializeSessionCookie, SESSION_TTL_MS } from '../../auth/session.ts';
import type { OAuthProviderConfig } from '../../auth/types.ts';
import type { Handler, RouteDef, ServerContext } from '../context.ts';
import {
  MAGIC_LINK_COOLDOWN,
  MAGIC_LINK_EMAIL_LIMIT,
  MAGIC_LINK_IP_LIMIT,
  MSG,
  OAUTH_STATE_COOKIE,
  apiError,
  clearOauthStateCookie,
  json,
  normaliseEmail,
  parseCookieValue,
  readJsonBody,
  retryAfter,
  rollingLimiter,
  safeReturnTo,
  serializeOauthStateCookie,
} from '../http.ts';

const MagicLinkBody = z.object({
  email: z.string().max(320),
  returnTo: z.string().max(500).optional(),
});

const ClaimBody = z.object({
  runIds: z.array(z.string().min(1).max(64)).max(10),
});

interface OAuthProviderSpec {
  readonly provider: 'github' | 'google';
  readonly providerConfig: OAuthProviderConfig | undefined;
  readonly authorizeUrl: (cfg: OAuthProviderConfig, state: string) => string;
  readonly exchangeCode: (
    cfg: OAuthProviderConfig,
    code: string,
    fetchImpl: typeof fetch,
  ) => Promise<{ accessToken: string } | { error: 'oauth_failed' }>;
  readonly fetchIdentity: (
    accessToken: string,
    fetchImpl: typeof fetch,
  ) => Promise<{ subject: string; email: string; login?: string } | { error: 'oauth_failed' | 'no_email' }>;
  readonly fetchImpl: typeof fetch;
  readonly noEmailError: 'github_email' | 'google_email';
  readonly failedMessage: string;
}

/** Auth, OAuth, magic-link, session, and account-claim routes. */
export function authRoutes(ctx: ServerContext): RouteDef[] {
  const { store, config, deps, now, cookieSecure, controllerFor, logInternal, requireSession, requireAuth } = ctx;

  const magicLinkLimits = [
    {
      limit: rollingLimiter(MAGIC_LINK_COOLDOWN),
      key: (ip: string, _email: string) => ip,
      message: 'Wait a minute before sending another sign-in email.',
    },
    {
      limit: rollingLimiter(MAGIC_LINK_COOLDOWN),
      key: (_ip: string, email: string) => email,
      message: 'Wait a minute before sending another sign-in email to that address.',
    },
    {
      limit: rollingLimiter(MAGIC_LINK_IP_LIMIT),
      key: (ip: string, _email: string) => ip,
      message: 'Too many sign-in emails from this connection. Try again later.',
    },
    {
      limit: rollingLimiter(MAGIC_LINK_EMAIL_LIMIT),
      key: (_ip: string, email: string) => email,
      message: 'Too many sign-in emails for that address. Try again later.',
    },
  ] as const;

  function checkMagicLinkRateLimits(ip: string, email: string, at: number): Response | null {
    for (const rule of magicLinkLimits) {
      const check = rule.limit(rule.key(ip, email), at, false);
      if (!check.ok) {
        return apiError(429, 'rate_limited', rule.message, { retryAt: check.retryAt }, retryAfter(check.retryAt, at));
      }
    }
    for (const rule of magicLinkLimits) {
      rule.limit(rule.key(ip, email), at);
    }
    return null;
  }

  const postMagicLink: Handler = async ({ req, ip }) => {
    if (config.auth === undefined) {
      return apiError(503, 'auth_unavailable', MSG.authUnavailable);
    }
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = MagicLinkBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
    const email = normaliseEmail(parsed.data.email);
    if (email === null) return apiError(400, 'invalid_input', MSG.email);

    const at = now();
    const limited = checkMagicLinkRateLimits(ip, email, at);
    if (limited !== null) return limited;
    const body: MagicLinkResponse = { ok: true };
    const mailer = deps.mailer;
    if (mailer === undefined) {
      logInternal('magic_link.mailer_missing', new Error('mailer not wired'));
      return json(200, body);
    }

    const existing = store.findUserByEmail(email) ?? store.findUserByIdentity('email', email);
    const token = generateMagicToken();
    const tokenHash = hashMagicToken(token);
    try {
      store.createMagicLinkToken(existing?.id ?? null, email, tokenHash, at, MAGIC_LINK_TTL_MS);
    } catch (err) {
      logInternal('magic_link.store', err);
      return apiError(500, 'internal', MSG.internal);
    }

    const returnTo = safeReturnTo(parsed.data.returnTo);
    const url = new URL('/api/auth/magic-link/consume', config.auth.publicBaseUrl);
    url.searchParams.set('token', token);
    if (returnTo !== '/app/#/') url.searchParams.set('returnTo', returnTo);
    const sent = await mailer.sendMagicLink({ to: email, url: url.toString() });
    if (!sent.ok) logInternal('magic_link.send', new Error('send failed'));
    return json(200, body);
  };

  const getMagicLinkConsume: Handler = async ({ url }) => {
    if (config.auth === undefined) {
      return apiError(503, 'auth_unavailable', MSG.authUnavailable);
    }
    const token = url.searchParams.get('token') ?? '';
    if (token === '') return apiError(400, 'invalid_input', MSG.magicLinkInvalid);
    const at = now();
    const consumed = store.consumeMagicLinkToken(hashMagicToken(token), at);
    if (consumed === null) return apiError(400, 'invalid_input', MSG.magicLinkInvalid);

    let user =
      (consumed.userId !== null ? store.findUserByIdentity('email', consumed.email) : null) ??
      store.findUserByEmail(consumed.email);
    if (user === null) {
      user = store.createUser(consumed.email, at);
    }
    store.linkIdentity(user.id, 'email', consumed.email);
    const session = store.createSession(user.id, at, SESSION_TTL_MS);
    store.markWaitlistJoined(consumed.email, at);
    const location = safeReturnTo(url.searchParams.get('returnTo'));
    return new Response(null, {
      status: 303,
      headers: {
        Location: location,
        'Set-Cookie': serializeSessionCookie(session.id, session.expiresAt, cookieSecure),
        'cache-control': 'no-store',
      },
    });
  };

  const startOauthRedirect = (location: string, state: string): Response =>
    new Response(null, {
      status: 302,
      headers: {
        Location: location,
        'Set-Cookie': serializeOauthStateCookie(state, cookieSecure),
        'cache-control': 'no-store',
      },
    });

  const completeOauthLogin = (opts: {
    provider: 'github' | 'google';
    subject: string;
    email: string;
    githubLogin?: string;
  }): Response => {
    const at = now();
    let user = store.findUserByIdentity(opts.provider, opts.subject) ?? store.findUserByEmail(opts.email);
    if (user === null) {
      user = store.createUser(opts.email, at);
    }
    store.linkIdentity(user.id, opts.provider, opts.subject);
    store.linkIdentity(user.id, 'email', opts.email);
    if (opts.githubLogin !== undefined) {
      store.setUserGithubLogin(user.id, opts.githubLogin);
    }
    const session = store.createSession(user.id, at, SESSION_TTL_MS);
    store.markWaitlistJoined(opts.email, at);
    const headers = new Headers({
      Location: '/app/#/',
      'cache-control': 'no-store',
    });
    headers.append('Set-Cookie', clearOauthStateCookie(cookieSecure));
    headers.append('Set-Cookie', serializeSessionCookie(session.id, session.expiresAt, cookieSecure));
    return new Response(null, { status: 303, headers });
  };

  function oauthStart(spec: OAuthProviderSpec): Handler {
    return async () => {
      if (config.auth === undefined || spec.providerConfig === undefined) {
        return apiError(503, 'auth_unavailable', MSG.authUnavailable);
      }
      const state = generateMagicToken();
      return startOauthRedirect(spec.authorizeUrl(spec.providerConfig, state), state);
    };
  }

  function oauthCallback(spec: OAuthProviderSpec): Handler {
    return async ({ req, url }) => {
      if (config.auth === undefined || spec.providerConfig === undefined) {
        return apiError(503, 'auth_unavailable', MSG.authUnavailable);
      }
      const clearHeaders = { 'Set-Cookie': clearOauthStateCookie(cookieSecure) };
      const failOauth = () => apiError(400, 'invalid_input', spec.failedMessage, {}, clearHeaders);
      const expected = parseCookieValue(req.headers.get('cookie'), OAUTH_STATE_COOKIE);
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code') ?? '';
      if (expected === null || state === '' || state !== expected || code === '') {
        return failOauth();
      }
      const token = await spec.exchangeCode(spec.providerConfig, code, spec.fetchImpl);
      if ('error' in token) return failOauth();
      const identity = await spec.fetchIdentity(token.accessToken, spec.fetchImpl);
      if ('error' in identity) {
        if (identity.error === 'no_email') {
          return new Response(null, {
            status: 303,
            headers: {
              Location: `/app/#/sign-in?error=${spec.noEmailError}`,
              'Set-Cookie': clearOauthStateCookie(cookieSecure),
              'cache-control': 'no-store',
            },
          });
        }
        return failOauth();
      }
      return completeOauthLogin({
        provider: spec.provider,
        subject: identity.subject,
        email: identity.email,
        ...(identity.login !== undefined ? { githubLogin: identity.login } : {}),
      });
    };
  }

  const githubSpec: OAuthProviderSpec = {
    provider: 'github',
    providerConfig: config.githubAuth,
    authorizeUrl: githubAuthorizeUrl,
    exchangeCode: exchangeGithubCode,
    fetchIdentity: fetchGithubIdentity,
    fetchImpl: deps.githubFetch ?? fetch,
    noEmailError: 'github_email',
    failedMessage: MSG.githubOauthFailed,
  };
  const googleSpec: OAuthProviderSpec = {
    provider: 'google',
    providerConfig: config.googleAuth,
    authorizeUrl: googleAuthorizeUrl,
    exchangeCode: exchangeGoogleCode,
    fetchIdentity: fetchGoogleIdentity,
    fetchImpl: deps.googleFetch ?? fetch,
    noEmailError: 'google_email',
    failedMessage: MSG.googleOauthFailed,
  };

  const getGithubStart = oauthStart(githubSpec);
  const getGithubCallback = oauthCallback(githubSpec);
  const getGoogleStart = oauthStart(googleSpec);
  const getGoogleCallback = oauthCallback(googleSpec);

  const getMe: Handler = async ({ req }) => {
    const auth = requireSession(req);
    if (auth instanceof Response) return auth;
    const verified = store.getVerifiedOrigin(auth.user.id, now());
    const pending = store.getPendingOriginVerification(auth.user.id);
    const body: MeResponse = {
      user: {
        id: auth.user.id,
        email: auth.user.primaryEmail,
        githubLogin: auth.user.githubLogin,
      },
      verifiedOrigin: verified === null ? null : { origin: verified.origin, host: verified.host },
      pendingVerification: pending === null ? null : { origin: pending.origin, host: pending.host },
    };
    return json(200, body);
  };

  const deleteMe: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    try {
      for (const r of store.listRunsForOwner(auth.user.id, 50)) {
        if (r.visibility === 'private' && r.status === 'running') {
          controllerFor(r.kind).stop(r.id);
        }
      }
      store.deleteUser(auth.user.id);
    } catch (err) {
      logInternal('me.delete', err);
      return apiError(500, 'internal', MSG.internal);
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': serializeClearSessionCookie(cookieSecure),
        'cache-control': 'no-store',
      },
    });
  };

  const postSignOut: Handler = async ({ req }) => {
    const sid = parseSessionId(req.headers.get('cookie'));
    if (sid !== null) store.deleteSession(sid);
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': serializeClearSessionCookie(cookieSecure),
        'cache-control': 'no-store',
      },
    });
  };

  const postClaim: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = ClaimBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
    try {
      const claimed = store.claimPublicRuns(auth.user.id, parsed.data.runIds);
      const body: ClaimResponse = { claimed };
      return json(200, body);
    } catch (err) {
      logInternal('auth.claim', err);
      return apiError(500, 'internal', MSG.internal);
    }
  };

  return [
    { method: 'POST', re: /^\/api\/auth\/magic-link$/, name: 'magic_link', handler: postMagicLink },
    { method: 'GET', re: /^\/api\/auth\/magic-link\/consume$/, name: 'magic_link_consume', handler: getMagicLinkConsume },
    { method: 'GET', re: /^\/api\/auth\/github\/start$/, name: 'github_start', handler: getGithubStart },
    { method: 'GET', re: /^\/api\/auth\/github\/callback$/, name: 'github_callback', handler: getGithubCallback },
    { method: 'GET', re: /^\/api\/auth\/google\/start$/, name: 'google_start', handler: getGoogleStart },
    { method: 'GET', re: /^\/api\/auth\/google\/callback$/, name: 'google_callback', handler: getGoogleCallback },
    { method: 'GET', re: /^\/api\/me$/, name: 'me', handler: getMe },
    { method: 'DELETE', re: /^\/api\/me$/, name: 'me_delete', handler: deleteMe },
    { method: 'POST', re: /^\/api\/auth\/sign-out$/, name: 'sign_out', handler: postSignOut },
    { method: 'POST', re: /^\/api\/auth\/claim$/, name: 'auth_claim', handler: postClaim },
  ];
}
