/**
 * Own-site origin verification: normalize host input, DNS TXT, and .well-known checks.
 */
import { isDenylistedHost, parseOrigin } from '../plan/policy.ts';

export type NormalizeVerifyResult =
  | { ok: true; host: string; origin: string }
  | { ok: false; reason: string };

export type ResolveTxt = (hostname: string) => Promise<string[][]>;
export type ResolveNs = (hostname: string) => Promise<string[]>;

export interface DnsProviderDetection {
  isCloudflare: boolean;
  apexHost: string;
  nameservers: string[];
  cloudFlareDirectUrl?: string;
  domainConnectUrl?: string;
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

/**
 * Walk up labels from host to find authoritative nameservers and detect if hosted on Cloudflare.
 */
export async function detectDnsProvider(
  host: string,
  resolveNs?: ResolveNs,
): Promise<DnsProviderDetection> {
  const defaultResult: DnsProviderDetection = {
    isCloudflare: false,
    apexHost: host,
    nameservers: [],
  };

  const nsResolver =
    resolveNs ??
    (async (hostname: string) => {
      const dns = await import('node:dns/promises');
      return dns.resolveNs(hostname);
    });

  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length === 0) return defaultResult;

  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join('.');
    try {
      const nsList = await nsResolver(candidate);
      if (Array.isArray(nsList) && nsList.length > 0) {
        const isCloudflare = nsList.some(isCloudflareNameserver);
        return {
          isCloudflare,
          apexHost: candidate,
          nameservers: nsList,
          cloudFlareDirectUrl: isCloudflare ? 'https://dash.cloudflare.com' : undefined,
        };
      }
    } catch {
      // Continue walking up labels
    }
  }

  return defaultResult;
}
