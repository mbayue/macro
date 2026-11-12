/**
 * Domain Connect v2 specification integration for Macro site verification.
 * Implements discovery, settings fetching, query signing (RSA-SHA256), and synchronous apply URL generation.
 */
import crypto from 'node:crypto';

export const PROVIDER_ID = 'macro.my.id';
export const SERVICE_ID = 'verify';

export interface BuildApplyUrlOptions {
  syncUxUrl: string;
  domain: string;
  host?: string | undefined;
  token: string;
  redirectUri?: string | undefined;
  state?: string | undefined;
  privateKeyPem?: string | undefined;
  keyId?: string | undefined;
}

/**
 * Sign a Domain Connect query string using RSA-SHA256 (PKCS#1 v1.5).
 * Returns base64-encoded signature.
 */
export function signDomainConnectQuery(queryString: string, privateKeyPem: string): string {
  const normalizedKey = privateKeyPem.includes('\n')
    ? privateKeyPem
    : privateKeyPem.replace(/\\n/g, '\n');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(queryString);
  signer.end();
  return signer.sign(normalizedKey, 'base64');
}

/**
 * Build a canonical, optionally signed Domain Connect synchronous template apply URL.
 * Standard query parameter order: domain, host (if non-empty), token, redirect_uri (if provided), state (if provided).
 */
export function buildDomainConnectApplyUrl(opts: BuildApplyUrlOptions): string {
  const baseUrl = opts.syncUxUrl.replace(/\/+$/, '');
  const path = `/v2/domainTemplates/providers/${encodeURIComponent(PROVIDER_ID)}/services/${encodeURIComponent(SERVICE_ID)}/apply`;

  const params: string[] = [];
  params.push(`domain=${encodeURIComponent(opts.domain)}`);

  if (opts.host && opts.host.trim() !== '') {
    params.push(`host=${encodeURIComponent(opts.host.trim())}`);
  }

  params.push(`token=${encodeURIComponent(opts.token)}`);

  if (opts.redirectUri && opts.redirectUri.trim() !== '') {
    params.push(`redirect_uri=${encodeURIComponent(opts.redirectUri.trim())}`);
  }

  if (opts.state && opts.state.trim() !== '') {
    params.push(`state=${encodeURIComponent(opts.state.trim())}`);
  }

  const baseQuery = params.join('&');

  if (opts.privateKeyPem && opts.privateKeyPem.trim() !== '') {
    const sigBase64 = signDomainConnectQuery(baseQuery, opts.privateKeyPem);
    const key = encodeURIComponent(opts.keyId?.trim() || 'p1');
    const sig = encodeURIComponent(sigBase64);
    return `${baseUrl}${path}?${baseQuery}&sig=${sig}&key=${key}`;
  }

  return `${baseUrl}${path}?${baseQuery}`;
}

export interface DomainConnectSettings {
  providerId: string;
  providerName: string;
  urlSyncUX: string;
  urlAPI?: string | undefined;
}

export type ResolveTxt = (hostname: string) => Promise<string[][]>;
export type ResolveCname = (hostname: string) => Promise<string[]>;
export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Discover the Domain Connect API hostname for a given apex domain.
 * Queries _domainconnect.<apexDomain> (TXT then CNAME fallback) with timeout.
 */
export async function discoverDomainConnectApi(
  apexDomain: string,
  resolveTxt?: ResolveTxt,
  resolveCname?: ResolveCname,
): Promise<string | null> {
  const targetHost = `_domainconnect.${apexDomain.toLowerCase().trim()}`;

  const txtResolver =
    resolveTxt ??
    (async (hostname: string) => {
      const dns = await import('node:dns/promises');
      return dns.resolveTxt(hostname);
    });

  const cnameResolver =
    resolveCname ??
    (async (hostname: string) => {
      const dns = await import('node:dns/promises');
      return dns.resolveCname(hostname);
    });

  // Try TXT first
  try {
    const txtRecords = await Promise.race([
      txtResolver(targetHost),
      new Promise<string[][]>((_, reject) =>
        setTimeout(() => reject(new Error('DNS_TIMEOUT')), 1500),
      ),
    ]);

    if (Array.isArray(txtRecords) && txtRecords.length > 0) {
      for (const chunk of txtRecords) {
        const text = chunk.join('').trim();
        if (text) {
          return text.replace(/\.+$/, '');
        }
      }
    }
  } catch {
    // TXT failed, proceed to CNAME fallback
  }

  // Fallback to CNAME
  try {
    const cnameRecords = await Promise.race([
      cnameResolver(targetHost),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('DNS_TIMEOUT')), 1500),
      ),
    ]);

    if (Array.isArray(cnameRecords) && cnameRecords.length > 0) {
      const first = cnameRecords[0]?.trim();
      if (first) {
        return first.replace(/\.+$/, '');
      }
    }
  } catch {
    // Both failed
  }

  return null;
}

/**
 * Fetch Domain Connect v2 settings for a domain from the discovered API host.
 */
export async function fetchDomainConnectSettings(
  apiHost: string,
  apexDomain: string,
  fetchFn?: FetchFn,
): Promise<DomainConnectSettings | null> {
  const customFetch = fetchFn ?? fetch;
  const host = apiHost.replace(/\/+$/, '');
  const url = `https://${host}/v2/${encodeURIComponent(apexDomain)}/settings`;

  try {
    const res = await customFetch(url, {
      signal: AbortSignal.timeout(1500),
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;

    const body = (await res.json()) as Record<string, unknown>;
    if (
      typeof body.urlSyncUX === 'string' &&
      typeof body.providerId === 'string' &&
      typeof body.providerName === 'string'
    ) {
      return {
        providerId: body.providerId,
        providerName: body.providerName,
        urlSyncUX: body.urlSyncUX,
        urlAPI: typeof body.urlAPI === 'string' ? body.urlAPI : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

