import { describe, expect, test } from 'bun:test';
import { evaluatePlan } from '../src/plan/policy.ts';
import type { TestPlan, TestPlanJourneyStep, TestPlanStage } from '../src/types.ts';
import { ALLOWLIST } from './arb.ts';

function plan(patch: Partial<TestPlan> = {}): TestPlan {
  return {
    name: 'bounds',
    target: 'https://yue.macro.my.id',
    stages: [{ vus: 10, durationSec: 60 }],
    journey: [{ route: 'store_home', probability: 50, thinkMs: 1000 }],
    stopThresholds: { p95Ms: 1000, errorRatePct: 5 },
    ...patch,
  };
}

/** "rule path" for each violation, or [] when accepted. */
function violations(p: TestPlan): string[] {
  const r = evaluatePlan(p, ALLOWLIST);
  return r.status === 'accepted' ? [] : r.violations.map((v) => `${v.rule} ${v.path}`);
}

const stage = (vus: number, durationSec: number): TestPlanStage => ({ vus, durationSec });
const step = (probability: number, thinkMs = 0, route = 'health'): TestPlanJourneyStep => ({ route, probability, thinkMs });

const increasing = (n: number): TestPlanStage[] => Array.from({ length: n }, (_, i) => stage(i + 1, 30));
const steps = (n: number): TestPlanJourneyStep[] => Array.from({ length: n }, () => step(10));

describe('baseline', () => {
  test('the base plan is accepted', () => {
    expect(evaluatePlan(plan(), ALLOWLIST)).toEqual({ status: 'accepted' });
  });
});

describe('Requirement 4.4: stages (inclusive bounds)', () => {
  test('stage count: 1 and 6 accepted, 0 and 7 rejected', () => {
    expect(violations(plan({ stages: increasing(1) }))).toEqual([]);
    expect(violations(plan({ stages: increasing(6) }))).toEqual([]);
    expect(violations(plan({ stages: [] }))).toEqual(['4.4 stages']);
    expect(violations(plan({ stages: increasing(7) }))).toEqual(['4.4 stages']);
  });

  test('VU count: 1 and 500 accepted, 0 and 501 rejected at the stage index', () => {
    expect(violations(plan({ stages: [stage(1, 30)] }))).toEqual([]);
    expect(violations(plan({ stages: [stage(500, 30)] }))).toEqual([]);
    expect(violations(plan({ stages: [stage(0, 30)] }))).toEqual(['4.4 stages[0].vus']);
    expect(violations(plan({ stages: [stage(1, 30), stage(501, 30)] }))).toEqual(['4.4 stages[1].vus']);
  });

  test('duration: 30 and 180 accepted, 29 and 181 rejected at the stage index', () => {
    expect(violations(plan({ stages: [stage(1, 30)] }))).toEqual([]);
    expect(violations(plan({ stages: [stage(1, 180)] }))).toEqual([]);
    expect(violations(plan({ stages: [stage(1, 29)] }))).toEqual(['4.4 stages[0].durationSec']);
    expect(violations(plan({ stages: [stage(1, 30), stage(2, 181)] }))).toEqual(['4.4 stages[1].durationSec']);
  });

  test('total duration: 600 s accepted, 601 s rejected', () => {
    const six = (last: number): TestPlanStage[] => [
      stage(1, 100),
      stage(2, 100),
      stage(3, 100),
      stage(4, 100),
      stage(5, 100),
      stage(6, last),
    ];
    expect(violations(plan({ stages: six(100) }))).toEqual([]);
    expect(violations(plan({ stages: six(101) }))).toEqual(['4.4 stages']);
  });

  test('VU count must be strictly greater than the previous stage', () => {
    expect(violations(plan({ stages: [stage(1, 30), stage(2, 30)] }))).toEqual([]);
    expect(violations(plan({ stages: [stage(2, 30), stage(2, 30)] }))).toEqual(['4.4 stages[1].vus']);
    expect(violations(plan({ stages: [stage(3, 30), stage(2, 30)] }))).toEqual(['4.4 stages[1].vus']);
  });

  test('values that are not whole numbers are rejected', () => {
    expect(violations(plan({ stages: [stage(1.5, 30)] }))).toEqual(['4.4 stages[0].vus']);
    expect(violations(plan({ stages: [stage(1, 30.5)] }))).toEqual(['4.4 stages[0].durationSec']);
  });
});

describe('Requirement 4.5: journey (inclusive bounds)', () => {
  test('journey length: 1 and 8 accepted, 0 and 9 rejected', () => {
    expect(violations(plan({ journey: steps(1) }))).toEqual([]);
    expect(violations(plan({ journey: steps(8) }))).toEqual([]);
    expect(violations(plan({ journey: [] }))).toEqual(['4.5 journey']);
    expect(violations(plan({ journey: steps(9) }))).toEqual(['4.5 journey']);
  });

  test('probability: 1 and 100 accepted, 0 and 101 rejected at the step index', () => {
    expect(violations(plan({ journey: [step(1)] }))).toEqual([]);
    expect(violations(plan({ journey: [step(100)] }))).toEqual([]);
    expect(violations(plan({ journey: [step(0)] }))).toEqual(['4.5 journey[0].probability']);
    expect(violations(plan({ journey: [step(50), step(101)] }))).toEqual(['4.5 journey[1].probability']);
    expect(violations(plan({ journey: [step(0.5)] }))).toEqual(['4.5 journey[0].probability']);
  });

  test('think time: 0 and 10000 accepted, -1 and 10001 rejected at the step index', () => {
    expect(violations(plan({ journey: [step(10, 0)] }))).toEqual([]);
    expect(violations(plan({ journey: [step(10, 10000)] }))).toEqual([]);
    expect(violations(plan({ journey: [step(10, -1)] }))).toEqual(['4.5 journey[0].thinkMs']);
    expect(violations(plan({ journey: [step(10), step(10, 10001)] }))).toEqual(['4.5 journey[1].thinkMs']);
    expect(violations(plan({ journey: [step(10, 1.5)] }))).toEqual(['4.5 journey[0].thinkMs']);
  });

  test('order_create: probability 25 accepted, 26 rejected', () => {
    expect(violations(plan({ journey: [step(25, 0, 'order_create')] }))).toEqual([]);
    expect(violations(plan({ journey: [step(26, 0, 'order_create')] }))).toEqual(['4.5 journey[0].probability']);
  });

  test('order_create: one step accepted, a second step rejected', () => {
    expect(violations(plan({ journey: [step(10), step(1, 0, 'order_create')] }))).toEqual([]);
    expect(
      violations(plan({ journey: [step(1, 0, 'order_create'), step(10), step(1, 0, 'order_create')] })),
    ).toEqual(['4.5 journey[2].route']);
  });
});

describe('Requirement 4.6: stop thresholds (inclusive bounds)', () => {
  test('p95 limit: 100 and 5000 accepted, 99 and 5001 rejected', () => {
    expect(violations(plan({ stopThresholds: { p95Ms: 100, errorRatePct: 5 } }))).toEqual([]);
    expect(violations(plan({ stopThresholds: { p95Ms: 5000, errorRatePct: 5 } }))).toEqual([]);
    expect(violations(plan({ stopThresholds: { p95Ms: 99, errorRatePct: 5 } }))).toEqual(['4.6 stopThresholds.p95Ms']);
    expect(violations(plan({ stopThresholds: { p95Ms: 5001, errorRatePct: 5 } }))).toEqual([
      '4.6 stopThresholds.p95Ms',
    ]);
  });

  test('error rate limit: 0.1 and 20 accepted, 0.09 and 20.01 rejected', () => {
    expect(violations(plan({ stopThresholds: { p95Ms: 1000, errorRatePct: 0.1 } }))).toEqual([]);
    expect(violations(plan({ stopThresholds: { p95Ms: 1000, errorRatePct: 20 } }))).toEqual([]);
    expect(violations(plan({ stopThresholds: { p95Ms: 1000, errorRatePct: 0.09 } }))).toEqual([
      '4.6 stopThresholds.errorRatePct',
    ]);
    expect(violations(plan({ stopThresholds: { p95Ms: 1000, errorRatePct: 20.01 } }))).toEqual([
      '4.6 stopThresholds.errorRatePct',
    ]);
  });
});

describe('Requirements 4.2 and 4.3: target and routes', () => {
  test('both allowlisted origins are accepted; a denylisted or unlisted host is rejected', () => {
    expect(violations(plan({ target: 'https://api.yue.macro.my.id' }))).toEqual([]);
    expect(violations(plan({ target: 'https://yueshop.xyz' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'https://api.yueshop.xyz' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'https://example.com' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'https://127.0.0.1' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'http://yue.macro.my.id' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'https://yue.macro.my.id:8443' }))).toEqual(['4.2 target']);
    expect(violations(plan({ target: 'https://yue.macro.my.id/path' }))).toEqual(['4.2 target']);
  });

  test('the denylist wins over the allowlist', () => {
    const r = evaluatePlan(plan({ target: 'https://yueshop.xyz' }), [...ALLOWLIST, 'https://yueshop.xyz']);
    expect(r.status).toBe('rejected');
  });

  test('one violation per unknown route', () => {
    expect(
      violations(plan({ journey: [step(10, 0, 'health'), step(10, 0, 'nope'), step(10, 0, 'Health')] })),
    ).toEqual(['4.3 journey[1].route', '4.3 journey[2].route']);
  });

  test('every rule is evaluated: a plan broken in all rules reports all of them', () => {
    const r = evaluatePlan(
      {
        name: 'x',
        target: 'https://example.com',
        stages: [stage(0, 29)],
        journey: [step(0, -1, 'nope')],
        stopThresholds: { p95Ms: 1, errorRatePct: 99 },
      },
      ALLOWLIST,
    );
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') {
      expect([...new Set(r.violations.map((v) => v.rule))]).toEqual(['4.2', '4.3', '4.4', '4.5', '4.6']);
    }
  });
});
