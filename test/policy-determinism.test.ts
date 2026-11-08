import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { evaluatePlan } from '../src/plan/policy.ts';
import { ALLOWLIST, arbPolicyPlan } from './arb.ts';

const calls: unknown[][] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(args);
    return Promise.reject(new Error('network is off in policy tests'));
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('Policy_Gate determinism', () => {
  test('Property 6: repeated and cloned evaluation return deeply equal results in the same order, with no fetch call', () => {
    // Feature: macro, Property 6: Policy_Gate is deterministic and offline
    calls.length = 0;
    fc.assert(
      fc.property(arbPolicyPlan, (plan) => {
        const first = evaluatePlan(plan, ALLOWLIST);
        const second = evaluatePlan(plan, ALLOWLIST);
        const cloned = evaluatePlan(structuredClone(plan), [...ALLOWLIST]);
        expect(second).toEqual(first);
        expect(cloned).toEqual(first);
        if (first.status === 'rejected') {
          // Fixed rule order 4.2 -> 4.6 (design, "Policy_Gate").
          const rules = first.violations.map((v) => v.rule);
          expect(rules).toEqual([...rules].sort());
        }
      }),
      { numRuns: 300 },
    );
    expect(calls).toHaveLength(0);
  });

  test('Property 6: evaluation does not mutate the plan or the allowlist', () => {
    // Feature: macro, Property 6: Policy_Gate is deterministic and offline
    fc.assert(
      fc.property(arbPolicyPlan, (plan) => {
        const planBefore = structuredClone(plan);
        const allowlist = [...ALLOWLIST];
        evaluatePlan(plan, allowlist);
        expect(plan).toEqual(planBefore);
        expect(allowlist).toEqual([...ALLOWLIST]);
      }),
      { numRuns: 100 },
    );
  });
});
