import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import { createApp, type App } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const config = testConfig();
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
  runController: { start: () => {}, stop: () => false, isRunning: () => false },
  probeController: { start: () => {}, stop: () => false, isRunning: () => false },
  webDist: 'web/dist',
  log: () => {},
});

async function fetchPath(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(
    new Request(`http://macro.test${path}`, {
      method: 'GET',
      headers: { 'cf-connecting-ip': '203.0.113.9', ...headers },
    }),
  );
}

describe('SEO & web standards', () => {
  test('GET /robots.txt returns 200 with RFC 9309 rules, AI crawlers, and Content-Signal', async () => {
    const res = await fetchPath('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('User-agent: OAI-SearchBot');
    expect(text).toContain('User-agent: Claude-SearchBot');
    expect(text).toContain('Content-Signal: ai-train=no');
    expect(text).toContain('Sitemap: https://macro.my.id/sitemap.xml');
  });

  test('GET /sitemap.xml returns 200 XML with canonical URLs', async () => {
    const res = await fetchPath('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const text = await res.text();
    expect(text).toContain('<loc>https://macro.my.id/</loc>');
    expect(text).toContain('<loc>https://macro.my.id/app/</loc>');
  });

  test('GET /llms.txt returns 200 product summary', async () => {
    const res = await fetchPath('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/');
    const text = await res.text();
    expect(text).toContain('# Macro');
  });
});
