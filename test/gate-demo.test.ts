// POST /api/gate-demo: the real parser and Policy_Gate refuse fixed hostile plans, with no side effects.
import { describe, expect, test } from 'bun:test';
import { InferenceClient } from '../src/agents/inference.ts';
import type { ApiErrorBody, GateDemoResponse, GateDemoScenario } from '../src/api-types.ts';
import { parsePlan } from '../src/plan/parser.ts';
import { evaluatePlan } from '../src/plan/policy.ts';
import { createApp } from '../src/server.ts';
import type { App, RunStarter } from '../src/server.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, testConfig } from './arb-agents.ts';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const config = testConfig();

interface Harness {
  store: Store;
  app: App;
  turnstileCalls: number;
  inferenceCalls: number;
  controllerCalls: number;
  clock: { now: number };
  post(body: unknown, ip?: string): Promise<{ status: number; body: unknown; headers: Headers }>;
  rowCount(): number;
}

function makeHarness(): Harness {
  const store = new Store(':memory:');
  const h = { store, turnstileCalls: 0, inferenceCalls: 0, controllerCalls: 0, clock: { now: NOW } } as Harness;
  const controller: RunStarter = {
    start: () => void h.controllerCalls++,
    stop: () => false,
    isRunning: () => false,
  };
  h.app = createApp({
    store,
    config,
    verifyTurnstile: () => {
      h.turnstileCalls++;
      return Promise.resolve({ ok: true });
    },
    client: new InferenceClient({
      config: config.inference,
      store,
      fetchImpl: asFetch(() => {
        h.inferenceCalls++;
        return Promise.reject(new Error('no network'));
      }),
    }),
    runController: controller,
    probeController: controller,
    now: () => h.clock.now,
    log: () => {},
  });
  h.post = async (body, ip = '203.0.113.5') => {
    const res = await h.app.fetch(
      new Request('http://macro.test/api/gate-demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as unknown, headers: res.headers };
  };
  h.rowCount = () => {
    const tables = store.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    let total = 0;
    for (const t of tables) {
      total += store.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM "${t.name}"`).get()?.n ?? 0;
    }
    return total;
  };
  return h;
}

const EXPECTED_RULES: Record<GateDemoScenario, readonly string[]> = {
  other_host: ['4.2'],
  too_big: ['4.4'],
  unknown_route: ['4.3', '4.5'],
};

describe('POST /api/gate-demo', () => {
  for (const scenario of ['other_host', 'too_big', 'unknown_route'] as const) {
    test(`${scenario} is rejected by the real gate with the expected rules and no side effects`, async () => {
      const h = makeHarness();
      const before = h.rowCount();
      const res = await h.post({ scenario });
      expect(res.status).toBe(200);
      const body = res.body as GateDemoResponse;
      expect(body.scenario).toBe(scenario);
      expect(body.requestsSent).toBe(0);
      expect(body.title.length).toBeGreaterThan(0);
      expect(body.description.length).toBeGreaterThan(0);
      expect(body.gate.status).toBe('rejected');
      expect(body.gate.violations.length).toBeGreaterThan(0);
      expect([...new Set<string>(body.gate.violations.map((v) => v.rule))]).toEqual([...EXPECTED_RULES[scenario]]);
      for (const v of body.gate.violations) {
        expect(v.path).not.toBe('');
        expect(v.message.length).toBeGreaterThan(0);
      }

      // The returned text is a plan the parser accepts and the gate rejects with the same violations.
      const parsed = parsePlan(body.planText);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const again = evaluatePlan(parsed.plan, config.target.allowlist);
      expect(again).toEqual({ status: 'rejected', violations: body.gate.violations });

      expect(h.turnstileCalls).toBe(0);
      expect(h.inferenceCalls).toBe(0);
      expect(h.controllerCalls).toBe(0);
      expect(h.rowCount()).toBe(before);
      h.store.close();
    });
  }

  test('each scenario triggers the intended violation paths', async () => {
    const h = makeHarness();
    const host = (await h.post({ scenario: 'other_host' })).body as GateDemoResponse;
    expect(host.gate.violations.map((v) => v.path)).toEqual(['target']);
    expect(host.gate.violations[0]?.message).toContain('tokopedia.com');

    const big = (await h.post({ scenario: 'too_big' })).body as GateDemoResponse;
    const paths = big.gate.violations.map((v) => v.path);
    expect(paths).toContain('stages');
    expect(paths).toContain('stages[11].vus');
    expect(paths).toContain('stages[11].durationSec');

    const route = (await h.post({ scenario: 'unknown_route' })).body as GateDemoResponse;
    expect(route.gate.violations.map((v) => `${v.rule} ${v.path}`)).toEqual([
      '4.3 journey[1].route',
      '4.5 journey[2].probability',
    ]);
    expect(route.gate.violations[0]?.message).toContain('admin_export_all_users');
    h.store.close();
  });

  test('an unknown or missing scenario is 400 invalid_input', async () => {
    const h = makeHarness();
    for (const body of [{ scenario: 'nope' }, { scenario: 7 }, {}, { scenario: null }, [], 'other_host']) {
      const res = await h.post(body);
      expect(res.status).toBe(400);
      expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
    }
    expect(h.turnstileCalls).toBe(0);
    expect(h.inferenceCalls).toBe(0);
    h.store.close();
  });

  test('a body above 64 KiB is refused', async () => {
    const h = makeHarness();
    const res = await h.post({ scenario: 'other_host', pad: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect((res.body as ApiErrorBody).error.code).toBe('invalid_input');
    h.store.close();
  });

  test('only POST is accepted', async () => {
    const h = makeHarness();
    const res = await h.app.fetch(new Request('http://macro.test/api/gate-demo'));
    expect(res.status).toBe(405);
    h.store.close();
  });

  test('the 31st request in a minute from one IP is 429 rate_limited; other IPs and a later minute are fine', async () => {
    const h = makeHarness();
    for (let i = 0; i < 30; i++) {
      const res = await h.post({ scenario: 'other_host' });
      expect(res.status).toBe(200);
    }
    const blocked = await h.post({ scenario: 'other_host' });
    expect(blocked.status).toBe(429);
    const err = (blocked.body as ApiErrorBody).error;
    expect(err.code).toBe('rate_limited');
    expect(err.retryAt).toBe(NOW + 60_000);
    expect(blocked.headers.get('retry-after')).toBe('60');

    expect((await h.post({ scenario: 'other_host' }, '198.51.100.9')).status).toBe(200);

    h.clock.now = NOW + 60_001;
    expect((await h.post({ scenario: 'too_big' })).status).toBe(200);

    expect(h.turnstileCalls).toBe(0);
    expect(h.inferenceCalls).toBe(0);
    expect(h.rowCount()).toBe(0);
    h.store.close();
  });
});
