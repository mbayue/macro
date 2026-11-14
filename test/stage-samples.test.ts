// Stage samples storage: per-second, per-route rows are the source of truth
// behind the report chart. SQLite only; the TigerData mirror is tested apart.
import { describe, expect, test } from 'bun:test';
import type { StageSample } from '../src/types.ts';
import { Store } from '../src/store/db.ts';

const SAMPLES: StageSample[] = [
  { second: 0, route: 'store_home', requests: 10, errors: 1, latencySumMs: 5250, latencyMaxMs: 900 },
  { second: 0, route: 'catalog_list', requests: 8, errors: 0, latencySumMs: 2000, latencyMaxMs: 300 },
  { second: 1, route: 'store_home', requests: 11, errors: 0, latencySumMs: 6000, latencyMaxMs: 700 },
];

describe('stage samples storage', () => {
  test('store then read round-trips, ordered by second then route', () => {
    const store = new Store(':memory:');
    store.storeStageSamples('run-1', 0, SAMPLES);
    // Second 0 first (routes alphabetical: catalog_list < store_home), then second 1.
    expect(store.readStageSamples('run-1', 0)).toEqual([SAMPLES[1]!, SAMPLES[0]!, SAMPLES[2]!]);
  });

  test('stages are independent and other runs see nothing', () => {
    const store = new Store(':memory:');
    store.storeStageSamples('run-1', 0, SAMPLES);
    store.storeStageSamples('run-1', 1, SAMPLES.map((s) => ({ ...s, second: s.second + 5 })));
    store.storeStageSamples('run-2', 0, SAMPLES);
    expect(store.readStageSamples('run-1', 1)[0]?.second).toBe(5);
    expect(store.readStageSamples('run-1', 2)).toEqual([]);
    expect(store.readStageSamples('run-3', 0)).toEqual([]);
  });

  test('re-storing a stage replaces its rows instead of duplicating them', () => {
    const store = new Store(':memory:');
    store.storeStageSamples('run-1', 0, SAMPLES);
    store.storeStageSamples('run-1', 0, SAMPLES.slice(0, 1));
    expect(store.readStageSamples('run-1', 0)).toEqual([SAMPLES[0]!]);
  });

  test('fractional latency sums are kept as written', () => {
    const store = new Store(':memory:');
    store.storeStageSamples('run-1', 0, [
      { second: 0, route: 'store_home', requests: 3, errors: 0, latencySumMs: 1234.5, latencyMaxMs: 567.75 },
    ]);
    expect(store.readStageSamples('run-1', 0)).toEqual([
      { second: 0, route: 'store_home', requests: 3, errors: 0, latencySumMs: 1234.5, latencyMaxMs: 567.75 },
    ]);
  });
});
