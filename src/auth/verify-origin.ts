/**
 * Own-site origin verification: normalize host input, DNS TXT, and .well-known checks.
 */
import { isDenylistedHost, parseOrigin } from '../plan/policy.ts';
import {
  buildDomainConnectApplyUrl,
  discoverDomainConnectApi,
  fetchDomainConnectSettings,
  type FetchFn,
} from './domain-connect.ts';

export type NormalizeVerifyResult =
  | { ok: true; host: string; origin: string }
  | { ok: false; reason: string };

export type ResolveTxt = (hostname: string) => Promise<string[][]>;
export type ResolveNs = (hostname: string) => Promise<string[]>;

export interface DnsProviderDetection {
  isCloudflare: boolean;
  apexHost: string;
  nameservers: string[];
  cloudFlareDirectUrl?: string | undefined;
  domainConnectUrl?: string | undefined;
  domainConnectProviderName?: string | undefined;
}

const WELL_KNOWN_PATH = '/.well-known/macro-site-verification';

/** TXT record name for a host (no trailing dot). */
export function txtNameForHost(host: string): string {
  return `_macro-verify.${host}`;
}

/** HTTPS well-known URL for an origin. */
export function wellKnownUrlForOrigin(origin: string): string {
  return `${origin}${WELL_KNOWN_PATH}`;
}

/**
 * Accept a bare host or https origin URL. Always returns an https:// origin.
 * Rejects http, denylisted hosts, and IP literals (via Target_Denylist rules).
 */
export function normalizeVerifyHost(input: string): NormalizeVerifyResult {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'host is required' };

  let candidate = raw;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  const parsed = parseOrigin(candidate);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  let url: URL;
  try {
    url = new URL(parsed.origin);
  } catch {
    return { ok: false, reason: 'host is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'origin must use https' };
  }
  const host = url.hostname.toLowerCase();
  if (isDenylistedHost(host)) {
    return { ok: false, reason: `host ${host} cannot be verified` };
  }
  return { ok: true, host, origin: `https://${host}` };
}

/** True when any TXT string equals the expected token (trimmed). */
export async function checkDnsTxt(
  host: string,
  expectedValue: string,
  resolveTxt: ResolveTxt,
): Promise<boolean> {
  try {
    const records = await resolveTxt(txtNameForHost(host));
    for (const chunks of records) {
      const joined = chunks.join('');
      if (joined.trim() === expectedValue) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** True when GET well-known returns 200 and body (trimmed) equals the token. */
export async function checkWellKnown(
  origin: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  try {
    const res = await fetchImpl(wellKnownUrlForOrigin(origin), {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/plain,*/*' },
    });
    if (res.status !== 200) return false;
    const body = (await res.text()).trim();
    return body === token;
  } catch {
    return false;
  }
}

/** Cryptographically random verification token (32 bytes, hex). */
export function generateVerifyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isCloudflareNameserver(ns: string): boolean {
  return /\.ns\.cloudflare\.com$/i.test(ns.trim());
}

export interface DetectDnsOptions {
  resolveTxt?: ((hostname: string) => Promise<string[][]>) | undefined;
  resolveCname?: ((hostname: string) => Promise<string[]>) | undefined;
  fetchFn?: FetchFn | undefined;
  verifyToken?: string | undefined;
  redirectUri?: string | undefined;
  state?: string | undefined;
  privateKeyPem?: string | undefined;
  keyId?: string | undefined;
}

export function computeSubdomainPrefix(fullHost: string, apexHost: string): string {
  const full = fullHost.toLowerCase().trim();
  const apex = apexHost.toLowerCase().trim();
  if (full === apex) return '';
  if (full.endsWith(`.${apex}`)) {
    return full.slice(0, -(apex.length + 1));
  }
  return '';
}

/**
 * Walk up labels from host to find authoritative nameservers, detect if hosted on Cloudflare,
 * and discover Domain Connect template settings if available.
 */
export async function detectDnsProvider(
  host: string,
  resolveNs?: ResolveNs,
  opts?: DetectDnsOptions,
): Promise<DnsProviderDetection> {
  const nsResolver =
    resolveNs ??
    (async (hostname: string) => {
      const dns = await import('node:dns/promises');
      return dns.resolveNs(hostname);
    });

  const labels = host.toLowerCase().split('.').filter(Boolean);
  let apexHost = host;
  let nameservers: string[] = [];
  let isCloudflare = false;

  if (labels.length > 0) {
    for (let i = 0; i <= labels.length - 2; i++) {
      const candidate = labels.slice(i).join('.');
      try {
        const nsList = await nsResolver(candidate);
        if (Array.isArray(nsList) && nsList.length > 0) {
          apexHost = candidate;
          nameservers = nsList;
          isCloudflare = nsList.some(isCloudflareNameserver);
          break;
        }
      } catch {
        // Continue walking up labels
      }
    }
  }

  let domainConnectUrl: string | undefined;
  let domainConnectProviderName: string | undefined;

  try {
    const dcApiHost = await discoverDomainConnectApi(
      apexHost,
      opts?.resolveTxt,
      opts?.resolveCname,
    );
    if (dcApiHost) {
      const settings = await fetchDomainConnectSettings(
        dcApiHost,
        apexHost,
        opts?.fetchFn,
      );
      if (settings && settings.urlSyncUX) {
        domainConnectProviderName = settings.providerName;
        if (opts?.verifyToken) {
          const hostPrefix = computeSubdomainPrefix(host, apexHost);
          domainConnectUrl = buildDomainConnectApplyUrl({
            syncUxUrl: settings.urlSyncUX,
            domain: apexHost,
            host: hostPrefix,
            token: opts.verifyToken,
            redirectUri: opts.redirectUri,
            state: opts.state,
            privateKeyPem: opts.privateKeyPem,
            keyId: opts.keyId,
          });
        }
      }
    }
  } catch {
    // Gracefully ignore Domain Connect errors
  }

  return {
    isCloudflare,
    apexHost,
    nameservers,
    cloudFlareDirectUrl: isCloudflare ? 'https://dash.cloudflare.com' : undefined,
    domainConnectUrl,
    domainConnectProviderName,
  };
}
