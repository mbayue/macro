import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { compareCodePoints, printPlan } from '../src/plan/printer.ts';
import type { TestPlan } from '../src/types.ts';
import { arbTestPlan } from './arb.ts';

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/gs;

/** Number lexemes of the printed text, in document order (strings skipped). */
function numberLexemes(text: string): string[] {
  const outsideStrings = text.replace(STRING_LITERAL, '""');
  return outsideStrings.match(/-?\d[\d.eE+-]*/g) ?? [];
}

function keysAreSorted(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(keysAreSorted);
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    const sorted = [...keys].sort(compareCodePoints);
    if (keys.some((k, i) => k !== sorted[i])) return false;
    return Object.values(value).every(keysAreSorted);
  }
  return true;
}

/** Same plan with every object's keys inserted in reverse order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => reverseKeys(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).reverse()) out[k] = reverseKeys(v);
    return out as T;
  }
  return value;
}

describe('canonical print format', () => {
  test('Property 2: sorted keys, no whitespace outside strings, integers without . e E, order preserved', () => {
    // Feature: macro, Property 2: Canonical print format
    fc.assert(
      fc.property(arbTestPlan, (plan) => {
        const text = printPlan(plan);
        const parsed: TestPlan = JSON.parse(text);

        // keys sorted by code point at every nesting level
        expect(keysAreSorted(parsed)).toBe(true);
        expect(Object.keys(parsed)).toEqual(['journey', 'name', 'stages', 'stopThresholds', 'target']);

        // no whitespace outside string values
        const outsideStrings = text.replace(STRING_LITERAL, '""');
        expect(/\s/.test(outsideStrings)).toBe(false);

        // integer fields: journey (probability, thinkMs) first, then stages (durationSec, vus),
        // then stopThresholds (errorRatePct, p95Ms) in sorted key order
        const lexemes = numberLexemes(text);
        const integerLexemes = [
          ...plan.journey.flatMap(() => [0, 1]),
          ...plan.stages.flatMap(() => [0, 1]),
        ].length;
        expect(lexemes.length).toBe(integerLexemes + 2);
        const intShaped = /^-?\d+$/;
        for (const lexeme of lexemes.slice(0, integerLexemes)) {
          expect(lexeme).toMatch(intShaped);
          expect(lexeme).not.toMatch(/[.eE]/);
        }
        expect(lexemes[integerLexemes + 1]).toMatch(intShaped); // p95Ms

        // Stage and Journey order preserved, values unchanged
        expect(parsed.stages).toEqual(plan.stages);
        expect(parsed.journey).toEqual(plan.journey);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 2: output does not depend on key insertion order', () => {
    // Feature: macro, Property 2: Canonical print format
    fc.assert(
      fc.property(arbTestPlan, (plan) => {
        expect(printPlan(reverseKeys(plan))).toBe(printPlan(plan));
      }),
      { numRuns: 100 },
    );
  });

  test('Property 2: -0 prints as 0 and large safe integers print without an exponent', () => {
    // Feature: macro, Property 2: Canonical print format
    const plan: TestPlan = {
      name: 'n',
      target: 't',
      stages: [{ vus: -0, durationSec: Number.MAX_SAFE_INTEGER }],
      journey: [{ route: 'health', probability: Number.MIN_SAFE_INTEGER, thinkMs: 0 }],
      stopThresholds: { p95Ms: 100, errorRatePct: 1 },
    };
    expect(printPlan(plan)).toBe(
      '{"journey":[{"probability":-9007199254740991,"route":"health","thinkMs":0}],"name":"n",' +
        '"stages":[{"durationSec":9007199254740991,"vus":0}],"stopThresholds":{"errorRatePct":1,"p95Ms":100},"target":"t"}',
    );
  });

  test('Property 2: keys sort by code point, not UTF-16 code unit', () => {
    // Feature: macro, Property 2: Canonical print format
    // By UTF-16 code unit U+1F600 (0xD83D 0xDE00) sorts before U+FF5E (0xFF5E); by code point it sorts after.
    expect(compareCodePoints('\uFF5E', '\u{1F600}')).toBeLessThan(0);
    expect('\uFF5E' < '\u{1F600}').toBe(false);
  });
});
