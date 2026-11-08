import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { guardText, numericTokens, tokenValue } from '../src/report/number-guard.ts';

// ---- generators --------------------------------------------------------------

const arbWord = fc.stringMatching(/^[a-zA-Z]{1,8}$/);
const arbPunct = fc.constantFrom('.', ',', ';', ':', '!', '?', '(', ')', '-', '%', '/');
/** Letter-prefixed digit strings such as p95, v1, k6, v1.2, p95,000. */
const arbPrefixed = fc
  .tuple(
    fc.constantFrom('p', 'v', 'k', 'P', 'x', 'é'),
    fc.integer({ min: 0, max: 9999 }),
    fc.constantFrom('', '.5', ',000', '.25'),
  )
  .map(([l, n, tail]) => `${l}${n}${tail}`);

/** Allowed values: integers and one-decimal numbers (exactly representable as parsed text). */
const arbAllowedSet = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0, max: 5_000_000 }),
      fc.integer({ min: 0, max: 50_000 }).map((n) => n / 10),
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((xs) => new Set(xs));

function grouped(n: number, decimals: 0 | 1): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });
}

/** A text rendering of an allowed value: plain, grouped, fixed decimal, or bare `.5`. */
function arbFormatted(allowed: ReadonlySet<number>): fc.Arbitrary<string> {
  return fc.constantFrom(...allowed).chain((v) => {
    const forms: string[] = [];
    if (Number.isInteger(v)) {
      forms.push(String(v), grouped(v, 0));
    } else {
      forms.push(v.toFixed(1), grouped(v, 1));
      if (v < 1) forms.push(v.toFixed(1).slice(1)); // ".5"
    }
    if (Number.isInteger(v)) forms.push(`${v}.0`);
    return fc.constantFrom(...forms);
  });
}

function arbTextItems(allowed: ReadonlySet<number>): fc.Arbitrary<string[]> {
  return fc.array(
    fc.oneof(
      { weight: 3, arbitrary: arbWord },
      { weight: 1, arbitrary: arbPunct },
      { weight: 2, arbitrary: arbPrefixed },
      { weight: 3, arbitrary: arbFormatted(allowed) },
    ),
    { maxLength: 14 },
  );
}

const fullWidth = (s: string): string => s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));

type Insert = { kind: string; text: string; value: number };

/** One numeric token whose value is not in `allowed`. */
function arbForeign(allowed: ReadonlySet<number>): fc.Arbitrary<Insert> {
  const arbValue = fc.integer({ min: 11, max: 9_999_999 }).filter((v) => !allowed.has(v));
  return fc.oneof(
    arbValue.map((v) => ({ kind: 'plain', text: String(v), value: v })),
    arbValue.map((v) => ({ kind: 'grouped', text: grouped(v, 0), value: v })),
    arbValue.map((v) => ({ kind: 'fullwidth', text: fullWidth(String(v)), value: v })),
    arbValue.map((v) => ({ kind: 'fullwidth-grouped', text: fullWidth(grouped(v, 0)), value: v })),
    // Malformed grouping: "3,45" is the tokens 3 and 45; the foreign one is the two-digit part.
    fc
      .tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 10, max: 99 }).filter((v) => !allowed.has(v)))
      .map(([head, tail]) => ({ kind: 'malformed', text: `${head},${tail}`, value: tail })),
    fc
      .integer({ min: 1, max: 9999 })
      .map((n) => n / 10 + 0.05)
      .filter((v) => !allowed.has(v))
      .map((v) => ({ kind: 'decimal', text: String(v), value: v })),
  );
}

describe('Property 21: Number_Guard accepts exactly allowed numbers', () => {
  test('text built only from words, punctuation, letter-prefixed digits, and allowed numbers passes', () => {
    // Feature: macro, Property 21: Number_Guard accepts exactly allowed numbers
    fc.assert(
      fc.property(
        arbAllowedSet.chain((allowed) => arbTextItems(allowed).map((items) => ({ allowed, text: items.join(' ') }))),
        ({ allowed, text }) => {
          expect(guardText(text, allowed)).toEqual({ ok: true });
        },
      ),
      { numRuns: 300 },
    );
  });

  test('one inserted foreign numeric token makes the guard fail and report its value', () => {
    // Feature: macro, Property 21: Number_Guard accepts exactly allowed numbers
    fc.assert(
      fc.property(
        arbAllowedSet.chain((allowed) =>
          fc
            .tuple(arbTextItems(allowed), arbForeign(allowed), fc.nat(40))
            .map(([items, foreign, at]) => ({ allowed, items, foreign, at })),
        ),
        ({ allowed, items, foreign, at }) => {
          const pos = at % (items.length + 1);
          const text = [...items.slice(0, pos), foreign.text, ...items.slice(pos)].join(' ');
          const result = guardText(text, allowed);
          if (result.ok) throw new Error(`guard passed ${JSON.stringify(text)} (${foreign.kind})`);
          expect(result.offending).toContain(foreign.value);
          // Every reported value is genuinely outside the set.
          for (const v of result.offending) expect(allowed.has(v)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('tokenization rules (10.7)', () => {
  test('digits directly after a letter are not tokens', () => {
    expect(numericTokens('p95 v1 k6 P99 v1.2 p95.5 x1,000')).toEqual([]);
    expect(numericTokens('the p95 was 812 ms')).toEqual(['812']);
    expect(guardText('p95 and v1 and k6', new Set())).toEqual({ ok: true });
  });

  test('digits after a space or punctuation are tokens', () => {
    expect(numericTokens('p 95')).toEqual(['95']);
    expect(numericTokens('(95)')).toEqual(['95']);
    expect(numericTokens('-5')).toEqual(['5']);
    expect(numericTokens('about 3.')).toEqual(['3']);
  });

  test('well-formed thousands groups are one token; value ignores commas', () => {
    expect(numericTokens('1,234 and 12,345,678.9 and 999')).toEqual(['1,234', '12,345,678.9', '999']);
    expect(tokenValue('12,345,678.9')).toBe(12345678.9);
    expect(guardText('about 1,234 requests', new Set([1234]))).toEqual({ ok: true });
    expect(guardText('about 1234 requests', new Set([1234]))).toEqual({ ok: true });
  });

  test('malformed grouping splits into separate tokens', () => {
    expect(numericTokens('3,4')).toEqual(['3', '4']);
    expect(numericTokens('12,34')).toEqual(['12', '34']);
    expect(numericTokens('12,3456')).toEqual(['12', '3456']);
    expect(numericTokens('1,2,3')).toEqual(['1', '2', '3']);
    expect(guardText('3,4', new Set([34]))).toEqual({ ok: false, offending: [3, 4] });
    expect(guardText('3,4', new Set([3]))).toEqual({ ok: false, offending: [4] });
    expect(guardText('3,4', new Set([3, 4]))).toEqual({ ok: true });
  });

  test('decimals: one decimal part, bare .5 form', () => {
    expect(numericTokens('0.5 .5 12.25')).toEqual(['0.5', '.5', '12.25']);
    expect(guardText('error rate 0.5', new Set([0.5]))).toEqual({ ok: true });
    expect(guardText('error rate .5', new Set([0.5]))).toEqual({ ok: true });
    expect(guardText('error rate 0.50', new Set([0.5]))).toEqual({ ok: true });
    expect(guardText('error rate 0.6', new Set([0.5]))).toEqual({ ok: false, offending: [0.6] });
  });

  test('NFKC folds full-width digits before extraction', () => {
    expect(numericTokens('１２３')).toEqual(['123']);
    expect(numericTokens('１，２３４')).toEqual(['1,234']);
    expect(guardText('１２３', new Set([123]))).toEqual({ ok: true });
    expect(guardText('９９９', new Set([123]))).toEqual({ ok: false, offending: [999] });
    // Superscript and circled digits fold to ASCII digits under NFKC too.
    expect(guardText('²', new Set())).toEqual({ ok: false, offending: [2] });
  });

  test('non-Latin decimal digits cannot hide a number', () => {
    expect(guardText('٩٩٩', new Set([1]))).toEqual({ ok: false, offending: [999] });
    expect(guardText('٩٩٩', new Set([999]))).toEqual({ ok: true });
  });

  test('offending values are listed once each', () => {
    expect(guardText('77 and 77 and 88', new Set())).toEqual({ ok: false, offending: [77, 88] });
  });

  test('text with no numbers passes against an empty set', () => {
    expect(guardText('', new Set())).toEqual({ ok: true });
    expect(guardText('No numbers here at all.', new Set())).toEqual({ ok: true });
  });
});
