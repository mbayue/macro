import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InferenceClient } from '../src/agents/inference.ts';
import * as ServerMod from '../src/server.ts';
import type { App, Clock, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, samplePlan, testConfig } from './arb-agents.ts';

function fakeController(activeId?: string): RunStarter {
  return { start: () => {}, stop: () => false, isRunning: (id) => id === activeId };
}

describe('server public exports and seams', () => {
  test('re-exports all documented constants and helpers from src/server.ts', () => {
    expect(ServerMod.MAX_BODY_BYTES).toBe(64 * 1024);
    expect(ServerMod.TRAFFIC_EVENT_MIN).toBe(10);
    expect(ServerMod.TRAFFIC_EVENT_MAX).toBe(1000);
    expect(typeof ServerMod.CSP).toBe('string');
    expect(ServerMod.SSE_POLL_MS).toBe(5000);
    expect(ServerMod.SSE_HEARTBEAT_MS).toBe(3000);
    expect(ServerMod.SSE_TERMINAL_GRACE_MS).toBe(180_000);
    expect(ServerMod.SSE_MAX_LIFETIME_MS).toBe(30 * 60_000);
    expect(ServerMod.SSE_MAX_PER_IP).toBe(8);
    expect(ServerMod.SSE_MAX_TOTAL).toBe(64);
    expect(ServerMod.EXAMPLES.length).toBeGreaterThan(0);
    expect(ServerMod.GATE_DEMO_LIMIT).toEqual({ max: 30, windowMs: 60_000 });
    expect(ServerMod.WAITLIST_LIMIT).toEqual({ max: 5, windowMs: 3_600_000 });
    expect(ServerMod.MAGIC_LINK_IP_LIMIT).toEqual({ max: 5, windowMs: 3_600_000 });
    expect(ServerMod.MAGIC_LINK_EMAIL_LIMIT).toEqual({ max: 3, windowMs: 3_600_000 });
    expect(ServerMod.MAGIC_LINK_COOLDOWN).toEqual({ max: 1, windowMs: 60_000 });
    expect(ServerMod.normaliseEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(typeof ServerMod.createApp).toBe('function');
  });

  describe('static asset serving', () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'macro-static-seam-'));
    mkdirSync(join(webRoot, 'app'), { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>home</body></html>');
    writeFileSync(join(webRoot, 'privacy.html'), '<!doctype html><html><body>privacy</body></html>');
    writeFileSync(join(webRoot, 'terms.html'), '<!doctype html><html><body>terms</body></html>');
    writeFileSync(join(webRoot, '404.html'), '<!doctype html><html><body>missing</body></html>');
    writeFileSync(join(webRoot, 'app', 'index.html'), '<!doctype html><html><body>app</body></html>');
    writeFileSync(join(webRoot, '.secret'), 'hidden');

    const store = new Store(':memory:');
    const config = testConfig();
    const app: App = ServerMod.createApp({
      store,
      config,
      verifyTurnstile: async () => ({ ok: true }),
      client: new InferenceClient({
        config: config.inference,
        store,
        fetchImpl: asFetch(async () => new Response('{}', { status: 500 })),
      }),
      runController: fakeController(),
      probeController: fakeController(),
      webDist: webRoot,
      log: () => {},
    });

    afterAll(() => {
      store.close();
      rmSync(webRoot, { recursive: true, force: true });
    });

    test('serves /privacy and /terms without .html suffix', async () => {
      const privacy = await app.fetch(new Request('http://macro.test/privacy'));
      expect(privacy.status).toBe(200);
      expect(privacy.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(privacy.headers.get('cache-control')).toBe('no-cache');
      expect(await privacy.text()).toContain('privacy');

      const terms = await app.fetch(new Request('http://macro.test/terms'));
      expect(terms.status).toBe(200);
      expect(await terms.text()).toContain('terms');
    });

    test('redirects legacy /app-next paths with 301 preserving query string', async () => {
      const res = await app.fetch(new Request('http://macro.test/app-next/?tab=report'), undefined);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/app/?tab=report');
    });

    test('blocks dotfiles and traversal paths and renders 404.html', async () => {
      const dot = await app.fetch(new Request('http://macro.test/.secret'));
      expect(dot.status).toBe(404);
      expect(await dot.text()).toContain('missing');

      const trav = await app.fetch(new Request('http://macro.test/../package.json'));
      expect(trav.status).toBe(404);
    });

    test('rejects non-GET/HEAD static requests with 405', async () => {
      const res = await app.fetch(new Request('http://macro.test/', { method: 'POST' }));
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
    });
  });

  describe('SSE streaming via createApp', () => {
    test('returns 204 on Last-Event-ID reconnect after a finished Run with no unseen events', async () => {
      const store = new Store(':memory:');
      const now = 1_700_000_000_000;
      store.storeApprovedPlan({ hash: 'a'.repeat(64), text: JSON.stringify(samplePlan()), approvedAt: now });
      store.createRun({
        id: 'run-sse-done-1',
        kind: 'run',
        planHash: 'a'.repeat(64),
        runtime: 'runc',
        startedAt: now,
        visibility: 'public',
      });
      store.setRunStatus('run-sse-done-1', 'completed', 'Done', now + 1000);
      const evId = store.appendEvent({ runId: 'run-sse-done-1', type: 'status', payload: { status: 'completed' }, ts: now + 1000 });

      const config = testConfig();
      const app = ServerMod.createApp({
        store,
        config,
        verifyTurnstile: async () => ({ ok: true }),
        client: new InferenceClient({
          config: config.inference,
          store,
          fetchImpl: asFetch(async () => new Response('{}', { status: 500 })),
        }),
        runController: fakeController(),
        probeController: fakeController(),
        now: () => now + 2000,
        log: () => {},
      });

      const res = await app.fetch(
        new Request('http://macro.test/api/runs/run-sse-done-1/events', {
          headers: { 'last-event-id': String(evId) },
        }),
      );
      expect(res.status).toBe(204);
      store.close();
    });

    test('enforces total SSE connection cap across distinct IPs and emits heartbeats', async () => {
      const store = new Store(':memory:');
      const now = 1_700_000_000_000;
      store.storeApprovedPlan({ hash: 'b'.repeat(64), text: JSON.stringify(samplePlan()), approvedAt: now });
      store.createRun({
        id: 'run-sse-total-1',
        kind: 'run',
        planHash: 'b'.repeat(64),
        runtime: 'runc',
        startedAt: now,
        visibility: 'public',
      });

      const ticks: (() => void)[] = [];
      const clock: Clock = {
        every(fn) {
          ticks.push(fn);
          return () => {};
        },
      };

      const config = testConfig();
      const app = ServerMod.createApp({
        store,
        config,
        verifyTurnstile: async () => ({ ok: true }),
        client: new InferenceClient({
          config: config.inference,
          store,
          fetchImpl: asFetch(async () => new Response('{}', { status: 500 })),
        }),
        runController: fakeController('run-sse-total-1'),
        probeController: fakeController(),
        now: () => now,
        clock,
        sse: { maxPerIp: 5, maxTotal: 2, pollMs: 5000, heartbeatMs: 3000 },
        log: () => {},
      });

      const r1 = await app.fetch(
        new Request('http://macro.test/api/runs/run-sse-total-1/events', { headers: { 'cf-connecting-ip': '198.51.100.1' } }),
      );
      const r2 = await app.fetch(
        new Request('http://macro.test/api/runs/run-sse-total-1/events', { headers: { 'cf-connecting-ip': '198.51.100.2' } }),
      );
      const r3 = await app.fetch(
        new Request('http://macro.test/api/runs/run-sse-total-1/events', { headers: { 'cf-connecting-ip': '198.51.100.3' } }),
      );

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);

      // Trigger heartbeat callback (registered after poll callback on each stream).
      const hb = ticks[1];
      expect(hb).toBeDefined();
      hb!();
      const reader = r1.body!.getReader();
      const dec = new TextDecoder();
      const first = dec.decode((await reader.read()).value);
      const second = first.includes(': hb') ? first : dec.decode((await reader.read()).value);
      expect(second).toContain(': hb');

      await reader.cancel();
      await r2.body?.cancel();

      const r4 = await app.fetch(
        new Request('http://macro.test/api/runs/run-sse-total-1/events', { headers: { 'cf-connecting-ip': '198.51.100.3' } }),
      );
      expect(r4.status).toBe(200);
      await r4.body?.cancel();
      store.close();
    });
  });
});
