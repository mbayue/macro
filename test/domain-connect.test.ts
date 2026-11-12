import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import {
  buildDomainConnectApplyUrl,
  discoverDomainConnectApi,
  fetchDomainConnectSettings,
  type FetchFn,
  signDomainConnectQuery,
} from '../src/auth/domain-connect.ts';

describe('Domain Connect Signer & URL Builder', () => {
  // Generate a test RSA 2048-bit keypair for test assertions
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  test('signDomainConnectQuery produces a valid RSA-SHA256 base64 signature', () => {
    const query = 'domain=example.com&host=shop&token=abc123';
    const sigBase64 = signDomainConnectQuery(query, privateKey);

    expect(typeof sigBase64).toBe('string');
    expect(sigBase64.length).toBeGreaterThan(0);

    // Verify using standard crypto.createVerify
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(query);
    verifier.end();
    const valid = verifier.verify(publicKey, sigBase64, 'base64');
    expect(valid).toBe(true);
  });

  test('buildDomainConnectApplyUrl builds signed URL with canonical parameter order', () => {
    const url = buildDomainConnectApplyUrl({
      syncUxUrl: 'https://domainconnect.example.com',
      domain: 'example.com',
      host: 'shop',
      token: 'tok-999',
      redirectUri: 'https://macro.my.id/app/#/verify',
      state: 'st-123',
      privateKeyPem: privateKey,
      keyId: 'p1',
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://domainconnect.example.com');
    expect(parsed.pathname).toBe(
      '/v2/domainTemplates/providers/macro.my.id/services/verify/apply',
    );

    // Parameters must be present
    expect(parsed.searchParams.get('domain')).toBe('example.com');
    expect(parsed.searchParams.get('host')).toBe('shop');
    expect(parsed.searchParams.get('token')).toBe('tok-999');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://macro.my.id/app/#/verify');
    expect(parsed.searchParams.get('state')).toBe('st-123');
    expect(parsed.searchParams.get('key')).toBe('p1');
    expect(parsed.searchParams.has('sig')).toBe(true);

    // Reconstruct the signed portion of the query string and verify it
    const rawQuery = url.split('?')[1] ?? '';
    const signedQuery = rawQuery.split('&sig=')[0] ?? '';
    const rawSig = parsed.searchParams.get('sig');
    expect(rawSig).not.toBeNull();
    const sig = decodeURIComponent(rawSig!);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedQuery);
    verifier.end();
    expect(verifier.verify(publicKey, sig, 'base64')).toBe(true);
  });

  test('buildDomainConnectApplyUrl omits host parameter when host is empty string', () => {
    const url = buildDomainConnectApplyUrl({
      syncUxUrl: 'https://domainconnect.example.com/',
      domain: 'example.com',
      host: '',
      token: 'tok-apex',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('domain')).toBe('example.com');
    expect(parsed.searchParams.has('host')).toBe(false);
    expect(parsed.searchParams.get('token')).toBe('tok-apex');
    // Unsigned when no privateKeyPem provided
    expect(parsed.searchParams.has('sig')).toBe(false);
    expect(parsed.searchParams.has('key')).toBe(false);
  });

  describe('Discovery & Settings Resolver', () => {
    test('discoverDomainConnectApi discovers host via TXT record', async () => {
      const mockResolveTxt = async (hostname: string) => {
        if (hostname === '_domainconnect.example.com') {
          return [['domainconnect.godaddy.com']];
        }
        throw new Error('ENOTFOUND');
      };

      const host = await discoverDomainConnectApi('example.com', mockResolveTxt);
      expect(host).toBe('domainconnect.godaddy.com');
    });

    test('discoverDomainConnectApi falls back to CNAME record when TXT is absent', async () => {
      const mockResolveTxt = async () => {
        throw new Error('ENODATA');
      };
      const mockResolveCname = async (hostname: string) => {
        if (hostname === '_domainconnect.example.com') {
          return ['_domainconnect.gd.domaincontrol.com.'];
        }
        throw new Error('ENOTFOUND');
      };

      const host = await discoverDomainConnectApi(
        'example.com',
        mockResolveTxt,
        mockResolveCname,
      );
      expect(host).toBe('_domainconnect.gd.domaincontrol.com');
    });

    test('discoverDomainConnectApi returns null on DNS failure or ENOTFOUND', async () => {
      const failingTxt = async () => {
        throw new Error('ENOTFOUND');
      };
      const failingCname = async () => {
        throw new Error('ENOTFOUND');
      };

      const host = await discoverDomainConnectApi('nodc.com', failingTxt, failingCname);
      expect(host).toBeNull();
    });

    test('fetchDomainConnectSettings fetches and parses settings from /v2/<domain>/settings', async () => {
      const mockFetch: FetchFn = async (input) => {
        const url = String(input);
        expect(url).toBe('https://domainconnect.godaddy.com/v2/example.com/settings');
        return new Response(
          JSON.stringify({
            providerId: 'godaddy.com',
            providerName: 'GoDaddy',
            urlSyncUX: 'https://dcc.godaddy.com/manage/dns/connect',
            urlAPI: 'https://api.domainconnect.godaddy.com/v2',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const settings = await fetchDomainConnectSettings(
        'domainconnect.godaddy.com',
        'example.com',
        mockFetch,
      );
      expect(settings).not.toBeNull();
      expect(settings?.providerId).toBe('godaddy.com');
      expect(settings?.providerName).toBe('GoDaddy');
      expect(settings?.urlSyncUX).toBe('https://dcc.godaddy.com/manage/dns/connect');
    });

    test('fetchDomainConnectSettings returns null on non-200 or invalid payload', async () => {
      const mockFetch404: FetchFn = async () => new Response('Not Found', { status: 404 });
      const res = await fetchDomainConnectSettings('api.example.com', 'example.com', mockFetch404);
      expect(res).toBeNull();
    });
  });
});
