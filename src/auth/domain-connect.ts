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
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(queryString);
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
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
