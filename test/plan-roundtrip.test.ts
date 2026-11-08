import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { parsePlan } from '../src/plan/parser.ts';
import { printPlan } from '../src/plan/printer.ts';
import type { TestPlan } from '../src/types.ts';
import { arbAcceptedPlan, arbBoundaryPlan, arbTestPlan } from './arb.ts';

function roundTrip(plan: TestPlan): void {
  const printed = printPlan(plan);
  const parsed = parsePlan(printed);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)} for ${printed}`);
  expect(parsed.plan).toEqual(plan);
  expect(printPlan(parsed.plan)).toBe(printed);
}

describe('plan round trip', () => {
  test('Property 1: parsePlan(printPlan(p)) equals p and re-prints byte-identically', () => {
    // Feature: macro, Property 1: Plan round trip
    fc.assert(
      fc.property(arbTestPlan, (plan) => {
        roundTrip(plan);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 1: also holds for accepted and boundary plans', () => {
    // Feature: macro, Property 1: Plan round trip
    fc.assert(
      fc.property(fc.oneof(arbAcceptedPlan, arbBoundaryPlan), (plan) => {
        roundTrip(plan);
      }),
      { numRuns: 100 },
    );
  });

  test('Property 1: plan names with three backticks and fence text survive the round trip', () => {
    // Feature: macro, Property 1: Plan round trip
    fc.assert(
      fc.property(
        arbTestPlan,
        fc.constantFrom('```', '```json\n{}\n```', 'a```b', '````', '` ``` `', '```\n'),
        (plan, name) => {
          roundTrip({ ...plan, name });
        },
      ),
      { numRuns: 100 },
    );
  });

  test('Property 1: out-of-policy but type-correct values still parse (Requirement 3.2)', () => {
    // Feature: macro, Property 1: Plan round trip
    const plan: TestPlan = {
      name: 'zero vus',
      target: 'https://yueshop.xyz/path?q=1',
      stages: [{ vus: 0, durationSec: -5 }],
      journey: [{ route: 'not_a_route', probability: 101, thinkMs: -1 }],
      stopThresholds: { p95Ms: 0, errorRatePct: -3.5 },
    };
    roundTrip(plan);
  });

  test('Property 1: Unicode names (astral characters, control characters, line separators)', () => {
    // Feature: macro, Property 1: Plan round trip
    for (const name of ['日本語 🚀', '\u0000\u001f\u007f', '\u2028\u2029', 'quote " and \\ backslash', '😀'.repeat(50)]) {
      roundTrip({
        name,
        target: 'https://yue.macro.my.id',
        stages: [{ vus: 1, durationSec: 30 }],
        journey: [{ route: 'health', probability: 100, thinkMs: 0 }],
        stopThresholds: { p95Ms: 100, errorRatePct: 0.1 },
      });
    }
  });
});
