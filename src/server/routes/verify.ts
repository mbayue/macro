import { z } from 'zod';
import type { VerifyCheckResponse, VerifyClearResponse, VerifyStartResponse } from '../../api-types.ts';
import { ContestedOriginError } from '../../auth/types.ts';
import {
  checkDnsTxt,
  checkWellKnown,
  detectDnsProvider,
  generateVerifyToken,
  normalizeVerifyHost,
  txtNameForHost,
  wellKnownUrlForOrigin,
} from '../../auth/verify-origin.ts';
import type { Handler, RouteDef, ServerContext } from '../context.ts';
import { MSG, apiError, json, readJsonBody } from '../http.ts';

const VerifyStartBody = z.object({
  host: z.string().min(1).max(253),
});

/** Own-site verification routes (`/api/verify/*`). */
export function verifyRoutes(ctx: ServerContext): RouteDef[] {
  const { store, config, deps, now, logInternal, requireAuth } = ctx;

  async function buildVerifyStartResponse(origin: string, host: string, token: string): Promise<VerifyStartResponse> {
    const detection = await detectDnsProvider(host, deps.resolveNs, {
      // Pass the injected resolvers so discovery never falls back to real DNS
      // when a caller (tests) supplied stubs.
      resolveTxt: deps.resolveTxt,
      resolveCname: deps.resolveCname,
      fetchFn: deps.fetchImpl as typeof fetch | undefined,
      verifyToken: token,
      redirectUri: config.auth ? `${config.auth.publicBaseUrl}/app/#/domains?domainConnect=done` : undefined,
      privateKeyPem: config.domainConnect?.privateKey,
      keyId: config.domainConnect?.keyId,
    });
    return {
      token,
      txtName: txtNameForHost(host),
      txtValue: token,
      wellKnownUrl: wellKnownUrlForOrigin(origin),
      isCloudflare: detection.isCloudflare,
      cloudFlareDirectUrl: detection.cloudFlareDirectUrl,
      domainConnectUrl: detection.domainConnectUrl,
      domainConnectProviderName: detection.domainConnectProviderName,
    };
  }

  const postVerifyStart: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const read = await readJsonBody(req);
    if (!read.ok) return read.res;
    const parsed = VerifyStartBody.safeParse(read.value);
    if (!parsed.success) return apiError(400, 'invalid_input', MSG.invalid);
    const norm = normalizeVerifyHost(parsed.data.host);
    if (!norm.ok) return apiError(400, 'invalid_input', MSG.invalid);

    const token = generateVerifyToken();
    const at = now();
    try {
      store.setPendingOriginVerification(auth.user.id, norm.origin, norm.host, token, at);
    } catch (err) {
      logInternal('verify.start', err);
      return apiError(500, 'internal', MSG.internal);
    }
    return json(200, await buildVerifyStartResponse(norm.origin, norm.host, token));
  };

  const getVerifyPending: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const pending = store.getPendingOriginVerification(auth.user.id);
    if (pending === null) return apiError(404, 'not_found', MSG.notFound);
    return json(200, await buildVerifyStartResponse(pending.origin, pending.host, pending.token));
  };

  const postVerifyCancel: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    try {
      store.clearPendingOriginVerification(auth.user.id);
    } catch (err) {
      logInternal('verify.cancel', err);
      return apiError(500, 'internal', MSG.internal);
    }
    const body: VerifyClearResponse = { ok: true };
    return json(200, body);
  };

  const postVerifyCheck: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const pending = store.getPendingOriginVerification(auth.user.id);
    if (pending === null) return apiError(400, 'invalid_input', MSG.verifyPending);

    const resolveTxt =
      deps.resolveTxt ??
      (async (hostname: string) => {
        const dns = await import('node:dns/promises');
        return dns.resolveTxt(hostname);
      });
    const fetchImpl = deps.fetchImpl ?? fetch;

    // Resolvers cache the negative answer for a while, so a check fired
    // immediately after the record is added can flake. One retry absorbs it.
    let dnsOk = await checkDnsTxt(pending.host, pending.token, resolveTxt);
    if (!dnsOk) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      dnsOk = await checkDnsTxt(pending.host, pending.token, resolveTxt);
    }
    const wellKnownOk = dnsOk ? false : await checkWellKnown(pending.origin, pending.token, fetchImpl);
    if (!dnsOk && !wellKnownOk) {
      return apiError(400, 'invalid_input', MSG.verifyFailed);
    }

    const at = now();
    try {
      store.setVerifiedOrigin(auth.user.id, pending.origin, pending.host, pending.token, at);
      store.clearPendingOriginVerification(auth.user.id);
    } catch (err) {
      if (err instanceof ContestedOriginError) {
        return apiError(409, 'contested_origin', MSG.contestedOrigin);
      }
      logInternal('verify.check', err);
      return apiError(500, 'internal', MSG.internal);
    }
    const body: VerifyCheckResponse = {
      verifiedOrigin: { origin: pending.origin, host: pending.host },
    };
    return json(200, body);
  };

  const postVerifyClear: Handler = async ({ req }) => {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    try {
      store.clearVerifiedOrigin(auth.user.id);
      store.clearPendingOriginVerification(auth.user.id);
    } catch (err) {
      logInternal('verify.clear', err);
      return apiError(500, 'internal', MSG.internal);
    }
    const body: VerifyClearResponse = { ok: true };
    return json(200, body);
  };

  return [
    { method: 'POST', re: /^\/api\/verify\/start$/, name: 'verify_start', handler: postVerifyStart },
    { method: 'GET', re: /^\/api\/verify\/pending$/, name: 'verify_pending', handler: getVerifyPending },
    { method: 'POST', re: /^\/api\/verify\/cancel$/, name: 'verify_cancel', handler: postVerifyCancel },
    { method: 'POST', re: /^\/api\/verify\/check$/, name: 'verify_check', handler: postVerifyCheck },
    { method: 'POST', re: /^\/api\/verify\/clear$/, name: 'verify_clear', handler: postVerifyClear },
  ];
}
