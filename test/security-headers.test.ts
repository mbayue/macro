// Security headers: every response the app produces — JSON, static, errors —
// carries the exact CSP constant plus nosniff and no-referrer. The build script
// enforces "no inline script or style" in the HTML; this file pins the headers
// themselves.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InferenceClient } from '../src/agents/inference.ts';
import { CSP, createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const config = testConfig();

function fakeController(): RunStarter {
  return { start: () => {}, stop: () => false, isRunning: () => false };
}

/** A minimal web root so the static paths are actually served, not 404. */
const webRoot = mkdtempSync(join(tmpdir(), 'macro-csp-web-'));
mkdirSync(join(webRoot, 'app'), { recursive: true });
writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>landing</body></html>');
writeFileSync(join(webRoot, 'app', 'index.html'), '<!doctype html><html><body>app</body></html>');
writeFileSync(join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');

const store = new Store(':memory:');
const app: App = createApp({
  store,
  config,
  verifyTurnstile: () => Promise.resolve({ ok: true }),
  client: new InferenceClient({
    config: config.inference,
    store,
    fetchImpl: asFetch(() => Promise.resolve(new Response('{}', { status: 500 }))),
  }),
  runController: fakeController(),
  probeController: fakeController(),
  webDist: webRoot,
  log: () => {},
});

async function fetchPath(path: string, method = 'GET'): Promise<Response> {
  return app.fetch(new Request(`http://macro.test${path}`, { method, headers: { 'cf-connecting-ip': '203.0.113.9' } }));
}

afterAll(() => {
  store.close();
  rmSync(webRoot, { recursive: true, force: true });
});

describe('security headers on every response', () => {
  // JSON, prerendered HTML, the app shell, a static asset, a JSON 404 and a
  // plain-text static miss: one header set for all of them.
  test.each(['/healthz', '/api/config', '/', '/app/', '/favicon.svg', '/definitely-missing'])(
    'GET %s carries the exact CSP, nosniff and no-referrer',
    async (path) => {
      const res = await fetchPath(path);
      expect(res.status).toBeLessThan(500);
      expect(res.headers.get('content-security-policy')).toBe(CSP);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  test('HEAD /healthz carries the same headers', async () => {
    const res = await fetchPath('/healthz', 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('a 405 method-not-allowed response carries the same headers', async () => {
    const res = await fetchPath('/api/plan', 'PUT');
    expect(res.status).toBe(405);
    expect(res.headers.get('content-security-policy')).toBe(CSP);
  });

  test('the CSP allows only self, Cloudflare challenges and Cloudflare insights', () => {
    expect(CSP).not.toContain('unsafe-inline');
    expect(CSP).not.toContain('unsafe-eval');
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain('script-src');
    expect(CSP).toContain('https://challenges.cloudflare.com');
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("base-uri 'none'");
  });
});
