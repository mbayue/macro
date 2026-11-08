import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { applyDecision, fallbackReason } from '../src/run/decide.ts';
import type { AgentDecision } from '../src/run/decide.ts';

const arbAgent: fc.Arbitrary<AgentDecision> = fc.oneof(
  fc.constant(null),
  fc.record({
    decision: fc.constantFrom('continue' as const, 'stop' as const),
    reason: fc.string({ minLength: 1, maxLength: 80 }),
  }),
);

describe('Property 15: Decision application', () => {
  test('applyDecision follows the decision table for every input', () => {
    // Feature: macro, Property 15: Decision application
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom('pass' as const, 'fail' as const), arbAgent, (isLast, verdict, agent) => {
        const applied = applyDecision(isLast, verdict, agent);

        if (isLast) {
          expect(applied.record).toBe(false);
          expect(applied.action).toBe(verdict === 'pass' ? 'complete' : 'halt');
          expect('decision' in applied).toBe(false);
          return;
        }

        if (!applied.record) throw new Error('a non-last Stage must record a decision');
        const expected: 'continue' | 'stop' = verdict === 'fail' ? 'stop' : (agent?.decision ?? 'continue');
        expect(applied.decision).toBe(expected);
        // End status: halted exactly when the applied decision is stop.
        expect(applied.action).toBe(expected === 'stop' ? 'halt' : 'continue');
        // Source agent exactly when the applied decision equals the agent's valid decision.
        const fromAgent = agent !== null && agent.decision === expected;
        expect(applied.source).toBe(fromAgent ? 'agent' : 'fallback');
        if (fromAgent && agent !== null) {
          expect(applied.reason).toBe(agent.reason);
          expect(applied.reasonKind).toBe('agent');
        } else {
          // Fixed text for a fallback: fail overriding a continue, or no valid decision.
          const kind = agent !== null && agent.decision === 'continue' && verdict === 'fail' ? 'fail_override' : 'no_valid_decision';
          expect(applied.reasonKind).toBe(kind);
          expect(applied.reason).toBe(fallbackReason(kind));
        }
        // A failing verdict always stops, whatever the agent said.
        if (verdict === 'fail') expect(applied.decision).toBe('stop');
      }),
      { numRuns: 200 },
    );
  });
});

describe('fixed fallback reasons (8.8)', () => {
  test('the two fallback texts are distinct and name their cause', () => {
    expect(fallbackReason('no_valid_decision')).toContain('No valid Supervisor_Agent decision');
    expect(fallbackReason('fail_override')).toContain('fail');
    expect(fallbackReason('fail_override')).not.toBe(fallbackReason('no_valid_decision'));
  });

  test('a continue answer on a failing Stage is an overridden fallback stop', () => {
    const a = applyDecision(false, 'fail', { decision: 'continue', reason: 'looks fine' });
    expect(a).toMatchObject({ record: true, decision: 'stop', source: 'fallback', reasonKind: 'fail_override', action: 'halt' });
  });

  test('no decision on a passing Stage continues as a fallback', () => {
    const a = applyDecision(false, 'pass', null);
    expect(a).toMatchObject({ record: true, decision: 'continue', source: 'fallback', reasonKind: 'no_valid_decision', action: 'continue' });
  });

  test('a stop answer on a failing Stage keeps source agent', () => {
    const a = applyDecision(false, 'fail', { decision: 'stop', reason: 'saturated' });
    expect(a).toMatchObject({ record: true, decision: 'stop', source: 'agent', reason: 'saturated', action: 'halt' });
  });
});
