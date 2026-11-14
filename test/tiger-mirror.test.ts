// The TigerData mirror: batched UNNEST inserts through the injected client,
// schema/hypertable/policies ensured once, failures swallowed.
import { describe, expect, test } from 'bun:test';
import type { StageSample } from '../src/types.ts';
import { createTigerMirror, ensureTigerSchema } from '../src/metrics/tiger.ts';
import type { TigerClient } from '../src/metrics/tiger.ts';

const TIGER_URL = 'postgres://tsdbadmin:pw@host.cloud.tigerdata.com:12345/tsdb?sslmode=require';

const SAMPLES: StageSample[] = [
  { second: 0, route: 'store_home', requests: 10, errors: 1, latencySumMs: 5250, latencyMaxMs: 900 },
  { second: 1, route: 'store_home', requests: 12, errors: 0, latencySumMs: 6000, latencyMaxMs: 600 },
];

function stubClient(): { client: TigerClient; calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  const client: TigerClient = {
    async unsafe(text, params) {
      calls.push({ text, params: params as unknown[] });
      return undefined;
    },
  };
  return { client, calls };
}

function failingClient(): { client: TigerClient; calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  const client: TigerClient = {
    async unsafe(text, params) {
      calls.push({ text, params: params as unknown[] });
      throw new Error('connection refused');
    },
  };
  return { client, calls };
}

function publicInput(samples: readonly StageSample[] = SAMPLES): Parameters<ReturnType<typeof createTigerMirror>>[0] {
  return {
    runId: 'run-1',
    stageIdx: 0,
    startedAt: Date.UTC(2026, 0, 15, 12, 0, 0),
    samples,
    planHash: 'a'.repeat(64),
    visibility: 'public',
  };
}

describe('ensureTigerSchema', () => {
  test('creates the table, plan_hash column, hypertable, indexes, and TimescaleDB policies', async () => {
    const { client, calls } = stubClient();
    await expect(ensureTigerSchema(TIGER_URL, client)).resolves.toBe(true);
    const sqls = calls.map((c) => c.text);
    expect(sqls.some((t) => t.includes('CREATE TABLE IF NOT EXISTS stage_samples'))).toBe(true);
    expect(sqls.some((t) => t.includes('ADD COLUMN IF NOT EXISTS plan_hash'))).toBe(true);
    expect(sqls.some((t) => t.includes('create_hypertable'))).toBe(true);
    expect(sqls.some((t) => t.includes('stage_samples_route_ts_idx'))).toBe(true);
    expect(sqls.some((t) => t.includes('add_compression_policy'))).toBe(true);
    expect(sqls.some((t) => t.includes('add_retention_policy'))).toBe(true);
    expect(sqls.some((t) => t.includes('stage_samples_hourly'))).toBe(true);
  });

  test('a core schema failure is reported, not thrown', async () => {
    const { client } = failingClient();
    expect(await ensureTigerSchema(TIGER_URL, client)).toBe(false);
  });
});

describe('createTigerMirror', () => {
  test('mirrors public-run samples in a single batched UNNEST insert with computed timestamps and plan_hash', async () => {
    const { client, calls } = stubClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await mirror(publicInput());
    const inserts = calls.filter((c) => c.text.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.text).toContain('INSERT INTO stage_samples');
    expect(inserts[0]!.text).toContain('UNNEST');
    const p = inserts[0]!.params as unknown[][];
    expect(p[0]).toEqual([
      new Date(Date.UTC(2026, 0, 15, 12, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 0, 15, 12, 0, 1)).toISOString(),
    ]);
    expect(p[1]).toEqual(['run-1', 'run-1']);
    expect(p[2]).toEqual([0, 0]);
    expect(p[3]).toEqual([0, 1]);
    expect(p[4]).toEqual(['store_home', 'store_home']);
    expect(p[5]).toEqual([10, 12]);
    expect(p[6]).toEqual([1, 0]);
    expect(p[7]).toEqual([5250, 6000]);
    expect(p[8]).toEqual([900, 600]);
    expect(p[9]).toEqual(['a'.repeat(64), 'a'.repeat(64)]);
  });

  test('the schema is ensured once across mirror calls', async () => {
    const { client, calls } = stubClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await mirror(publicInput());
    await mirror(publicInput());
    const ddl = calls.filter((c) => c.text.includes('CREATE TABLE') || c.text.includes('create_hypertable'));
    expect(ddl).toHaveLength(2); // one CREATE TABLE + one create_hypertable across both calls
  });

  test('a private run is never mirrored', async () => {
    const { client, calls } = stubClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await mirror({ ...publicInput(), visibility: 'private' });
    expect(calls).toHaveLength(0);
  });

  test('a null startedAt skips the mirror (no computable timestamps)', async () => {
    const { client, calls } = stubClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await mirror({ ...publicInput(), startedAt: null });
    expect(calls).toHaveLength(0);
  });

  test('empty samples skip the mirror', async () => {
    const { client, calls } = stubClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await mirror(publicInput([]));
    expect(calls).toHaveLength(0);
  });

  test('a client failure resolves silently (the mirror never affects the run)', async () => {
    const { client, calls } = failingClient();
    const mirror = createTigerMirror({ url: TIGER_URL, client });
    await expect(mirror(publicInput())).resolves.toBeUndefined();
    expect(calls.length).toBeGreaterThan(0); // it tried
  });
});
