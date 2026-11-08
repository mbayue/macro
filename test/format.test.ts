import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { fmtCount, fmtMs, fmtPct, fmtRps, roundHalfAway } from '../src/run/format.ts';

// Slack for the toPrecision(15) pre-step in roundHalfAway (about 1e-15 relative) and for double subtraction.
const slack = (x: number): number => Math.max(1e-9, Math.abs(x) * 1e-14);

const arbX: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 0, max: 1e12, noNaN: true }),
  fc.double({ min: 0, max: 1000, noNaN: true }),
  fc.integer({ min: 0, max: 1_000_000_000 }),
  fc.double({ min: 0, max: 1e-3, noNaN: true }),
  // values next to a rounding boundary
  fc
    .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 9 }), fc.constantFrom(-1e-9, 0, 1e-9))
    .map(([n, d, eps]) => n + d / 10 + 0.05 + eps),
  fc.tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.constantFrom(-1e-9, 0, 1e-9)).map(([n, eps]) => n + 0.5 + eps),
);

/** Parse the numeric part of a formatted value ("12.3%" -> 12.3). */
const num = (s: string): number => Number(s.replace('%', ''));

describe('Property 13: display rounding', () => {
  test('fmtMs is an integer string within half a unit of x', () => {
    // Feature: macro, Property 13: Display rounding
    fc.assert(
      fc.property(arbX, (x) => {
        const s = fmtMs(x);
        expect(s).toMatch(/^\d+$/);
        expect(Math.abs(Number(s) - x)).toBeLessThanOrEqual(0.5 + slack(x));
      }),
      { numRuns: 1000 },
    );
  });

  test('fmtPct and fmtRps have exactly one decimal and are within half a unit of the last digit', () => {
    // Feature: macro, Property 13: Display rounding
    fc.assert(
      fc.property(arbX, (x) => {
        const pct = fmtPct(x);
        const rps = fmtRps(x);
        expect(pct).toMatch(/^\d+\.\d%$/);
        expect(rps).toMatch(/^\d+\.\d$/);
        expect(pct.slice(0, -1)).toBe(rps);
        expect(Math.abs(num(pct) - x)).toBeLessThanOrEqual(0.05 + slack(x));
        expect(Math.abs(num(rps) - x)).toBeLessThanOrEqual(0.05 + slack(x));
      }),
      { numRuns: 1000 },
    );
  });

  test('values exactly halfway between two whole units round away from zero', () => {
    // Feature: macro, Property 13: Display rounding
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 43 }), (n) => {
        // Up to 2^43 the value n + 0.5 has at most 15 significant digits, the precision roundHalfAway works at.
        const x = n + 0.5; // exactly representable
        expect(fmtMs(x)).toBe(String(n + 1));
        expect(fmtCount(x)).toBe(String(n + 1));
        expect(roundHalfAway(x)).toBe(n + 1);
        expect(roundHalfAway(-x)).toBe(-(n + 1));
      }),
      { numRuns: 500 },
    );
  });

  test('values written as a decimal exactly halfway between two tenths (x.d5) round up to the next tenth', () => {
    // Feature: macro, Property 13: Display rounding
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.integer({ min: 0, max: 9 }), (n, d) => {
        const x = Number(`${n}.${d}5`); // e.g. 0.25, 1.05, 12.35: not exactly representable in binary
        const tenths = n * 10 + d + 1;
        const expected = `${Math.floor(tenths / 10)}.${tenths % 10}`;
        expect(fmtRps(x)).toBe(expected);
        expect(fmtPct(x)).toBe(`${expected}%`);
      }),
      { numRuns: 1000 },
    );
  });

  test('named halfway examples', () => {
    // Feature: macro, Property 13: Display rounding
    expect(fmtMs(0.5)).toBe('1');
    expect(fmtMs(1.5)).toBe('2');
    expect(fmtMs(2.5)).toBe('3');
    expect(fmtMs(0.49999)).toBe('0');
    expect(fmtMs(1234.5)).toBe('1235');
    expect(fmtPct(0.25)).toBe('0.3%');
    expect(fmtPct(0.05)).toBe('0.1%');
    expect(fmtPct(0.75)).toBe('0.8%');
    expect(fmtPct(12.25)).toBe('12.3%');
    expect(fmtPct(0.15)).toBe('0.2%');
    expect(fmtPct(0.35)).toBe('0.4%');
    expect(fmtPct(1.45)).toBe('1.5%');
    expect(fmtPct(99.95)).toBe('100.0%');
    expect(fmtRps(0.04999)).toBe('0.0');
    expect(fmtRps(2.5)).toBe('2.5');
    expect(fmtRps(45.65)).toBe('45.7');
    expect(fmtRps(0)).toBe('0.0');
    expect(fmtMs(0)).toBe('0');
    // Binary floating point error must not change the decimal reading.
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(2.675, 2)).toBe(2.68);
    expect(roundHalfAway(8.345, 2)).toBe(8.35);
    expect(roundHalfAway(0.615, 2)).toBe(0.62);
    expect(roundHalfAway(1.0005, 3)).toBe(1.001);
  });

  test('negative zero and values that round to zero never print a minus sign', () => {
    // Feature: macro, Property 13: Display rounding
    expect(fmtMs(-0)).toBe('0');
    expect(fmtPct(-0)).toBe('0.0%');
    expect(fmtRps(-0)).toBe('0.0');
    expect(fmtCount(-0)).toBe('0');
    expect(Object.is(roundHalfAway(-0), 0)).toBe(true);
    expect(Object.is(roundHalfAway(-0.4), 0)).toBe(true);
    expect(Object.is(roundHalfAway(-0.04, 1), 0)).toBe(true);
    fc.assert(
      fc.property(fc.double({ min: -0.4999, max: 0, noNaN: true }), (x) => {
        expect(fmtMs(x)).toBe('0');
        expect(Object.is(roundHalfAway(x), 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.double({ min: -0.0499, max: 0, noNaN: true }), (x) => {
        expect(fmtPct(x)).toBe('0.0%');
        expect(fmtRps(x)).toBe('0.0');
      }),
      { numRuns: 200 },
    );
  });

  test('negative halfway values round away from zero as well', () => {
    // Feature: macro, Property 13: Display rounding
    expect(fmtMs(-2.5)).toBe('-3');
    expect(fmtMs(-0.5)).toBe('-1');
    expect(fmtPct(-0.25)).toBe('-0.3%');
    expect(fmtRps(-1.05)).toBe('-1.1');
    expect(roundHalfAway(-1.005, 2)).toBe(-1.01);
  });

  test('rounding is monotonic and idempotent', () => {
    // Feature: macro, Property 13: Display rounding
    fc.assert(
      fc.property(arbX, arbX, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(Number(fmtMs(lo))).toBeLessThanOrEqual(Number(fmtMs(hi)));
        expect(num(fmtPct(lo))).toBeLessThanOrEqual(num(fmtPct(hi)));
        expect(num(fmtRps(lo))).toBeLessThanOrEqual(num(fmtRps(hi)));
        expect(fmtMs(Number(fmtMs(lo)))).toBe(fmtMs(lo));
        expect(fmtPct(num(fmtPct(lo)))).toBe(fmtPct(lo));
        expect(fmtRps(num(fmtRps(lo)))).toBe(fmtRps(lo));
      }),
      { numRuns: 500 },
    );
  });

  test('fmtMs stays a plain integer string for very large finite values (no exponent notation)', () => {
    // Feature: macro, Property 13: Display rounding
    // Requirement 7.4: latencies display as whole milliseconds. A corrupt but finite summary
    // value such as 1e21 must not appear as "1e+21".
    for (const x of [1e15, 1e20, 1e21, 1e300, Number.MAX_VALUE]) {
      expect(fmtMs(x)).toMatch(/^\d+$/);
      expect(fmtPct(x)).toMatch(/^\d+\.\d%$/);
      expect(fmtRps(x)).toMatch(/^\d+\.\d$/);
    }
  });
});
