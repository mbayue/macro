import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { parsePlan } from '../src/plan/parser.ts';
import { printPlan } from '../src/plan/printer.ts';
import type { TestPlan } from '../src/types.ts';
import { arbTestPlan } from './arb.ts';

/** Text outside the fence: any characters except a backtick, kept short so the total stays under 16 KiB. */
const arbOutsideText = fc.string({
  unit: fc.oneof(
    fc.integer({ min: 0x20, max: 0x7e }).filter((c) => c !== 0x60),
    fc.constantFrom(0x0a, 0x0d, 0x09, 0x7b, 0x7d, 0x22, 0x5b, 0x1f600, 0xe9, 0x65e5),
  ).map((cp) => String.fromCodePoint(cp)),
  maxLength: 80,
});

/**
 * Prefix without backticks, not starting with `{` (after leading whitespace), and ending at a line
 * boundary: the opening fence is recognised at the start of a line (design, "Plan_Parser").
 */
const arbPrefix = arbOutsideText
  .filter((s) => !s.trimStart().startsWith('{'))
  .map((s) => (s === '' ? s : `${s}\n`))
  .filter((s) => !s.trimStart().startsWith('{'));

/** A plan whose printed text contains no backtick, so the closing fence is the first ``` after the opening one. */
const arbFenceablePlan: fc.Arbitrary<TestPlan> = arbTestPlan.filter((p) => !printPlan(p).includes('`'));

const arbTag = fc.constantFrom('json', 'JSON', '');
const arbLayout = fc.constantFrom<'canonical' | 'indented'>('canonical', 'indented');

function planText(plan: TestPlan, layout: 'canonical' | 'indented'): string {
  return layout === 'canonical' ? printPlan(plan) : JSON.stringify(JSON.parse(printPlan(plan)), null, 2);
}

describe('code fence extraction', () => {
  test('Property 4: a fenced plan parses to the same structure as the bare plan text', () => {
    // Feature: macro, Property 4: Fence extraction
    fc.assert(
      fc.property(arbFenceablePlan, arbPrefix, arbOutsideText, arbTag, arbLayout, (plan, prefix, suffix, tag, layout) => {
        const bare = planText(plan, layout);
        const expected = parsePlan(bare);
        expect(expected.ok).toBe(true);
        const wrapped = `${prefix}\`\`\`${tag}\n${bare}\n\`\`\`${suffix}`;
        const actual = parsePlan(wrapped);
        expect(actual).toEqual(expected);
        if (actual.ok) expect(actual.plan).toEqual(plan);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 4: removing the closing fence yields the "code fence is unclosed" error', () => {
    // Feature: macro, Property 4: Fence extraction
    fc.assert(
      fc.property(arbFenceablePlan, arbPrefix, arbOutsideText, arbTag, arbLayout, (plan, prefix, suffix, tag, layout) => {
        const unclosed = `${prefix}\`\`\`${tag}\n${planText(plan, layout)}\n${suffix}`;
        const result = parsePlan(unclosed);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.reason).toMatch(/code fence is unclosed/);
          expect(result.errors).toHaveLength(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  // Requirement 3.4 and Property 4 allow any prefix without backticks, including prose on the same
  // line as the opening fence. The Plan_Parser currently only recognises a fence at the start of a
  // line, so this fails with "code fence is unclosed" (the closing fence is taken as an opening one).
  // Minimal fix in src/plan/parser.ts: `const OPEN_FENCE = /```/;` (the leading-`{` check already
  // protects plan names that contain three backticks).
  test('Property 4: a fence that follows prose on the same line is extracted (Requirement 3.4)', () => {
    // Feature: macro, Property 4: Fence extraction
    fc.assert(
      fc.property(
        arbFenceablePlan,
        arbOutsideText.filter((s) => !s.trimStart().startsWith('{') && !s.includes('\n')),
        arbOutsideText,
        arbTag,
        (plan, prefix, suffix, tag) => {
          const wrapped = `${prefix}\`\`\`${tag}\n${printPlan(plan)}\n\`\`\`${suffix}`;
          const actual = parsePlan(wrapped);
          expect(actual.ok && actual.plan).toEqual(plan);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('only the first fence is used and text after it is ignored', () => {
    const plan: TestPlan = {
      name: 'first',
      target: 'https://yue.macro.my.id',
      stages: [{ vus: 1, durationSec: 30 }],
      journey: [{ route: 'health', probability: 100, thinkMs: 0 }],
      stopThresholds: { p95Ms: 100, errorRatePct: 0.1 },
    };
    const text = `Here is the plan:\n\`\`\`json\n${printPlan(plan)}\n\`\`\`\nAnd a second one:\n\`\`\`json\n{"not":"a plan"}\n\`\`\`\n`;
    const result = parsePlan(text);
    expect(result.ok && result.plan).toEqual(plan);
  });

  test('a plan name containing three backticks round-trips as bare JSON (leading { wins over fence search)', () => {
    const plan: TestPlan = {
      name: 'weird ``` name',
      target: 'https://yue.macro.my.id',
      stages: [{ vus: 1, durationSec: 30 }],
      journey: [{ route: 'health', probability: 100, thinkMs: 0 }],
      stopThresholds: { p95Ms: 100, errorRatePct: 0.1 },
    };
    const result = parsePlan(printPlan(plan));
    expect(result.ok && result.plan).toEqual(plan);
  });
});
