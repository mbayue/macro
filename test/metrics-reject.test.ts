import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { readSummary } from '../src/k6/metrics.ts';
import { arbGenSummary, buildSummary } from './arb-run.ts';
import type { GenSummary } from './arb-run.ts';

type Json = Record<string, unknown>;

type BadValue = 'negative' | 'tiny-negative' | 'nan' | 'infinity' | 'string' | 'null' | 'huge-literal';
type Field = 'count' | 'p50' | 'p95' | 'p99' | 'rate';

type Corruption =
  | { k: 'invalid-json'; cut: number; garbage: string }
  | { k: 'missing-count' }
  | { k: 'missing-count-metric' }
  | { k: 'missing-p50' }
  | { k: 'missing-p95' }
  | { k: 'missing-p99' }
  | { k: 'missing-failed-metric' }
  | { k: 'missing-failed-rate' }
  | { k: 'count-zero' }
  | { k: 'bad-value'; field: Field; bad: BadValue }
  | { k: 'duration'; variant: 'no-state' | 'no-field' | 'zero' | 'negative' | 'string' | 'null' | 'nan' };

const arbCorruption: fc.Arbitrary<Corruption> = fc.oneof(
  fc.record({ k: fc.constant('invalid-json' as const), cut: fc.double({ min: 0, max: 0.999, noNaN: true }), garbage: fc.string({ maxLength: 30 }) }),
  fc.constant({ k: 'missing-count' as const }),
  fc.constant({ k: 'missing-count-metric' as const }),
  fc.constant({ k: 'missing-p50' as const }),
  fc.constant({ k: 'missing-p95' as const }),
  fc.constant({ k: 'missing-p99' as const }),
  fc.constant({ k: 'missing-failed-metric' as const }),
  fc.constant({ k: 'missing-failed-rate' as const }),
  fc.constant({ k: 'count-zero' as const }),
  fc.record({
    k: fc.constant('bad-value' as const),
    field: fc.constantFrom<Field>('count', 'p50', 'p95', 'p99', 'rate'),
    bad: fc.constantFrom<BadValue>('negative', 'tiny-negative', 'nan', 'infinity', 'string', 'null', 'huge-literal'),
  }),
  fc.record({
    k: fc.constant('duration' as const),
    variant: fc.constantFrom('no-state' as const, 'no-field' as const, 'zero' as const, 'negative' as const, 'string' as const, 'null' as const, 'nan' as const),
  }),
);

const HUGE = '__HUGE_NUMBER_LITERAL__';

function badValue(bad: BadValue): unknown {
  switch (bad) {
    case 'negative':
      return -1;
    case 'tiny-negative':
      return -0.001;
    case 'nan':
      return Number.NaN; // serialises as null
    case 'infinity':
      return Number.POSITIVE_INFINITY; // serialises as null
    case 'string':
      return '12';
    case 'null':
      return null;
    case 'huge-literal':
      return HUGE; // replaced by the number literal 1e999, which parses to Infinity
  }
}

function values(summary: Json, metric: string): Json {
  const m = (summary['metrics'] as Json)[metric] as Json;
  return m['values'] as Json;
}

/** Corrupt a valid summary and return the text to feed the reader. */
function corrupt(g: GenSummary, c: Corruption): string {
  const summary = buildSummary(g);
  const metrics = summary['metrics'] as Json;
  const medianKey = g.overall.medianKey;
  const text = (): string => JSON.stringify(summary).replaceAll(`"${HUGE}"`, '1e999');

  switch (c.k) {
    case 'invalid-json': {
      const full = JSON.stringify(summary);
      const n = Math.floor(full.length * c.cut);
      return c.garbage.length > 0 && c.cut > 0.5 ? `${full.slice(0, n)}${c.garbage}{` : full.slice(0, n);
    }
    case 'missing-count':
      delete values(summary, 'http_reqs')['count'];
      return text();
    case 'missing-count-metric':
      delete metrics['http_reqs'];
      return text();
    case 'missing-p50':
      delete values(summary, 'http_req_duration')['med'];
      delete values(summary, 'http_req_duration')['p(50)'];
      return text();
    case 'missing-p95':
      delete values(summary, 'http_req_duration')['p(95)'];
      return text();
    case 'missing-p99':
      delete values(summary, 'http_req_duration')['p(99)'];
      return text();
    case 'missing-failed-metric':
      delete metrics['http_req_failed'];
      return text();
    case 'missing-failed-rate':
      delete values(summary, 'http_req_failed')['rate'];
      return text();
    case 'count-zero':
      values(summary, 'http_reqs')['count'] = 0;
      return text();
    case 'bad-value': {
      const v = badValue(c.bad);
      if (c.field === 'count') values(summary, 'http_reqs')['count'] = v;
      else if (c.field === 'rate') values(summary, 'http_req_failed')['rate'] = v;
      else if (c.field === 'p50') values(summary, 'http_req_duration')[medianKey] = v;
      else if (c.field === 'p95') values(summary, 'http_req_duration')['p(95)'] = v;
      else values(summary, 'http_req_duration')['p(99)'] = v;
      return text();
    }
    case 'duration': {
      const state = summary['state'] as Json;
      if (c.variant === 'no-state') delete summary['state'];
      else if (c.variant === 'no-field') delete state['testRunDurationMs'];
      else if (c.variant === 'zero') state['testRunDurationMs'] = 0;
      else if (c.variant === 'negative') state['testRunDurationMs'] = -5;
      else if (c.variant === 'string') state['testRunDurationMs'] = '60000';
      else if (c.variant === 'null') state['testRunDurationMs'] = null;
      else state['testRunDurationMs'] = Number.NaN;
      return text();
    }
  }
}

/**
 * Corruptions of the failed-request rate act on the `rate` key, which is the only carrier of the
 * rate in the `rate-only` style. Pin that style when the corruption targets it.
 */
function prepare(g: GenSummary, c: Corruption): GenSummary {
  const targetsRate = c.k === 'missing-failed-rate' || (c.k === 'bad-value' && c.field === 'rate');
  return targetsRate ? { ...g, overall: { ...g.overall, failedStyle: 'rate-only' } } : g;
}

function assertRejected(result: ReturnType<typeof readSummary>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.reason).toBe('string');
  expect(result.reason.length).toBeGreaterThan(0);
  expect('metrics' in result).toBe(false);
}

describe('Property 12: Metrics_Reader rejects incomplete summaries', () => {
  test('a valid summary is accepted before it is corrupted (control)', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    fc.assert(
      fc.property(arbGenSummary, (g) => {
        expect(readSummary(JSON.stringify(buildSummary(g))).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('any single corruption is rejected with a reason and no metrics, and never throws', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    fc.assert(
      fc.property(arbGenSummary, arbCorruption, (g0, c) => {
        const g = prepare(g0, c);
        const text = corrupt(g, c);
        let result: ReturnType<typeof readSummary> | undefined;
        expect(() => {
          result = readSummary(text);
        }).not.toThrow();
        if (result === undefined) throw new Error('unreachable');
        assertRejected(result);
      }),
      { numRuns: 1500 },
    );
  });

  test('every corruption kind is exercised against a fixed summary', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    const base: GenSummary = {
      durationMs: 60_000,
      overall: { count: 100, failed: 5, p50: 10, p95: 20, p99: 30, m429: 1, failedStyle: 'rate-only', medianKey: 'med' },
      routes: { health: { count: 50, failed: 0, p50: 5, p95: 6, p99: 7, m429: undefined, failedStyle: 'full', medianKey: 'p(50)' } },
      noise: false,
    };
    const kinds: Corruption[] = [
      { k: 'invalid-json', cut: 0.5, garbage: '' },
      { k: 'missing-count' },
      { k: 'missing-count-metric' },
      { k: 'missing-p50' },
      { k: 'missing-p95' },
      { k: 'missing-p99' },
      { k: 'missing-failed-metric' },
      { k: 'missing-failed-rate' },
      { k: 'count-zero' },
      ...(['count', 'p50', 'p95', 'p99', 'rate'] as const).flatMap((field) =>
        (['negative', 'tiny-negative', 'nan', 'infinity', 'string', 'null', 'huge-literal'] as const).map(
          (bad): Corruption => ({ k: 'bad-value', field, bad }),
        ),
      ),
      ...(['no-state', 'no-field', 'zero', 'negative', 'string', 'null', 'nan'] as const).map(
        (variant): Corruption => ({ k: 'duration', variant }),
      ),
    ];
    expect(readSummary(JSON.stringify(buildSummary(base))).ok).toBe(true);
    for (const c of kinds) assertRejected(readSummary(corrupt(base, c)));
  });

  test('missing, empty, or non-object summary text is rejected', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    for (const text of ['', ' ', '\n', 'null', 'true', '42', '"summary"', '[]', '[{"metrics":{}}]', '{}', '{"metrics":{}}', '{"state":{"testRunDurationMs":1000}}', '{"state":{"testRunDurationMs":1000},"metrics":{}}']) {
      assertRejected(readSummary(text));
    }
  });

  test('metrics of a rejected summary are never partially returned for a corrupt route block', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    fc.assert(
      fc.property(
        arbGenSummary.filter((g) => Object.values(g.routes).some((b) => b !== undefined && b.count > 0)),
        (g) => {
          const summary = buildSummary(g);
          const metrics = summary['metrics'] as Json;
          const key = Object.keys(metrics).find((k) => k.startsWith('http_req_duration{route:'));
          if (key === undefined) return;
          delete ((metrics[key] as Json)['values'] as Json)['p(95)'];
          assertRejected(readSummary(JSON.stringify(summary)));
        },
      ),
      { numRuns: 100 },
    );
  });

  test('random mutations of a valid summary never throw, and accepted results hold only finite numbers >= 0', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    fc.assert(
      fc.property(arbGenSummary, fc.nat(), fc.jsonValue({ maxDepth: 2 }), (g, pick, replacement) => {
        const summary = buildSummary(g);
        const paths: (string | number)[][] = [];
        const walk = (node: unknown, path: (string | number)[]): void => {
          paths.push(path);
          if (node !== null && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
          }
        };
        walk(summary, []);
        const target = paths[pick % paths.length] ?? [];
        let node: unknown = summary;
        for (const part of target.slice(0, -1)) node = (node as Json)[part as string];
        const last = target.at(-1);
        // Keep magnitudes below 1e15: overflow of derived values is pinned by its own test below.
        const tame: unknown = JSON.parse(JSON.stringify(replacement ?? null, (_k, v: unknown) => (typeof v === 'number' && Math.abs(v) > 1e15 ? 1e15 : v)));
        const mutated = last === undefined ? tame : (((node as Json)[last as string] = tame), summary);
        const text = JSON.stringify(mutated);
        let result: ReturnType<typeof readSummary> | undefined;
        expect(() => {
          result = readSummary(text ?? 'null');
        }).not.toThrow();
        if (result === undefined) throw new Error('unreachable');
        if (result.ok) {
          for (const m of [result.metrics.overall, ...Object.values(result.metrics.routes)]) {
            for (const v of Object.values(m)) {
              expect(Number.isFinite(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
            }
            expect(m.requests).toBeGreaterThan(0);
          }
        } else {
          assertRejected(result);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test('derived values that overflow to a non-finite number are not returned as metrics', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    // Requirement 7.2: no non-finite value may reach Stage_Metrics. The inputs below are finite,
    // but requests per second or the error rate computed from them is not.
    const base = buildSummary({
      durationMs: 60_000,
      overall: { count: 100, failed: 5, p50: 10, p95: 20, p99: 30, m429: undefined, failedStyle: 'rate-only', medianKey: 'med' },
      routes: {},
      noise: false,
    });
    const withCount = (count: number, durationMs: number): string => {
      const s = JSON.parse(JSON.stringify(base)) as Json;
      values(s, 'http_reqs')['count'] = count;
      (s['state'] as Json)['testRunDurationMs'] = durationMs;
      return JSON.stringify(s);
    };
    const withRate = (rate: number): string => {
      const s = JSON.parse(JSON.stringify(base)) as Json;
      values(s, 'http_req_failed')['rate'] = rate;
      return JSON.stringify(s);
    };
    for (const text of [withCount(1.7e305, 1), withCount(100, 1e-320), withCount(5e300, 5e-10), withRate(1e307)]) {
      const result = readSummary(text);
      if (result.ok) {
        for (const v of Object.values(result.metrics.overall)) expect(Number.isFinite(v)).toBe(true);
      } else {
        assertRejected(result);
      }
    }
  });

  test('arbitrary text never throws', () => {
    // Feature: macro, Property 12: Metrics_Reader rejects incomplete summaries
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary', maxLength: 200 }), fc.json(), fc.string({ maxLength: 50 })), (text) => {
        const result = readSummary(text);
        if (!result.ok) assertRejected(result);
      }),
      { numRuns: 500 },
    );
  });
});
