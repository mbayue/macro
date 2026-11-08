import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { evaluatePlan } from '../src/plan/policy.ts';
import type { TestPlan } from '../src/types.ts';
import { ALLOWLIST, arbAcceptedPlan, arbBoundaryPlan, arbPolicyPlan, arbTarget } from './arb.ts';

/**
 * Independent reference checker, written from requirements 4.2 to 4.6 and the glossary
 * (Target_Allowlist, Target_Denylist, Route_Catalog). It does not share code with
 * src/plan/policy.ts. It returns the set of violated (rule, path) pairs as "rule path" strings.
 *
 * Path convention (design, "Policy_Gate"): `target`, `journey[i].route`, `stages`, `stages[i].vus`,
 * `journey`, `stopThresholds.p95Ms`, and so on. Where a rule is about the whole list (stage count,
 * total duration, journey length) the path is the list itself. A second or later `order_create`
 * step is reported at its own `route`.
 */
const CATALOG = ['store_home', 'catalog_list', 'product_detail', 'ledger', 'order_create', 'health'];

interface RefOrigin {
  scheme: string;
  host: string;
  port: number;
}

function refParseOrigin(text: string): RefOrigin | null {
  // scheme://host[:port][/]  with no userinfo, query, fragment, or deeper path
  const m = /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[^\s/?#@:[\]\\%]+)(?::([1-9][0-9]{0,4}))?\/?$/.exec(text);
  if (!m) return null;
  const scheme = m[1] as string;
  const defaultPort = scheme === 'https' ? 443 : 80;
  return { scheme, host: (m[2] as string).toLowerCase(), port: m[3] === undefined ? defaultPort : Number(m[3]) };
}

function refDenylisted(host: string): boolean {
  return (
    host === 'yueshop.xyz' ||
    host.endsWith('.yueshop.xyz') ||
    host === 'macro.my.id' ||
    /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(host) || // IPv4 literal
    host.startsWith('[') // IPv6 literal
  );
}

function refTargetAccepted(target: string, allowlist: readonly string[]): boolean {
  const t = refParseOrigin(target);
  if (t === null) return false;
  if (refDenylisted(t.host)) return false;
  return allowlist.some((entry) => {
    const a = refParseOrigin(entry);
    return a !== null && a.scheme === t.scheme && a.host === t.host && a.port === t.port;
  });
}

const whole = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;

function reference(plan: TestPlan, allowlist: readonly string[]): string[] {
  const v = new Set<string>();

  if (!refTargetAccepted(plan.target, allowlist)) v.add('4.2 target');

  plan.journey.forEach((step, i) => {
    if (!CATALOG.includes(step.route)) v.add(`4.3 journey[${i}].route`);
  });

  if (plan.stages.length < 1 || plan.stages.length > 6) v.add('4.4 stages');
  let total = 0;
  plan.stages.forEach((s, i) => {
    if (!whole(s.vus, 1, 500)) v.add(`4.4 stages[${i}].vus`);
    if (!whole(s.durationSec, 30, 180)) v.add(`4.4 stages[${i}].durationSec`);
    total += s.durationSec;
    const before = plan.stages[i - 1];
    if (before !== undefined && !(s.vus > before.vus)) v.add(`4.4 stages[${i}].vus`);
  });
  if (total > 600) v.add('4.4 stages');

  if (plan.journey.length < 1 || plan.journey.length > 8) v.add('4.5 journey');
  let orderSteps = 0;
  plan.journey.forEach((step, i) => {
    if (!whole(step.probability, 1, 100)) v.add(`4.5 journey[${i}].probability`);
    if (!whole(step.thinkMs, 0, 10000)) v.add(`4.5 journey[${i}].thinkMs`);
    if (step.route === 'order_create') {
      orderSteps += 1;
      if (orderSteps > 1) v.add(`4.5 journey[${i}].route`);
      if (step.probability > 25) v.add(`4.5 journey[${i}].probability`);
    }
  });

  const { p95Ms, errorRatePct } = plan.stopThresholds;
  if (!(p95Ms >= 100 && p95Ms <= 5000)) v.add('4.6 stopThresholds.p95Ms');
  if (!(errorRatePct >= 0.1 && errorRatePct <= 20)) v.add('4.6 stopThresholds.errorRatePct');

  return [...v].sort();
}

function actual(plan: TestPlan, allowlist: readonly string[]): string[] | 'accepted' {
  const r = evaluatePlan(plan, allowlist);
  if (r.status === 'accepted') return 'accepted';
  return [...new Set(r.violations.map((x) => `${x.rule} ${x.path}`))].sort();
}

function check(plan: TestPlan, allowlist: readonly string[]): void {
  const expected = reference(plan, allowlist);
  const got = actual(plan, allowlist);
  if (expected.length === 0) expect(got).toBe('accepted');
  else expect(got).toEqual(expected);
}

/** Includes denylisted hosts, IP literals, and look-alikes so that "denylist beats allowlist" is exercised. */
const PERMISSIVE_ALLOWLIST: readonly string[] = [
  ...ALLOWLIST,
  'https://yueshop.xyz',
  'https://api.yueshop.xyz',
  'https://macro.my.id',
  'https://127.0.0.1',
  'https://[::1]',
  'https://notyueshop.xyz',
  'https://macro.my.id.evil.test',
  'https://evil.test',
  'https://example.com',
];

describe('Policy_Gate against a reference model', () => {
  test('Property 5: evaluatePlan accepts exactly when the reference finds no violation, else the same (rule, path) pairs', () => {
    // Feature: macro, Property 5: Policy_Gate matches a reference rule model
    fc.assert(
      fc.property(arbPolicyPlan, (plan) => {
        check(plan, ALLOWLIST);
      }),
      { numRuns: 1000 },
    );
  });

  test('Property 5: same with a permissive allowlist (denylist applies even to allowlisted origins)', () => {
    // Feature: macro, Property 5: Policy_Gate matches a reference rule model
    fc.assert(
      fc.property(arbPolicyPlan, (plan) => {
        check(plan, PERMISSIVE_ALLOWLIST);
      }),
      { numRuns: 500 },
    );
  });

  test('Property 5: target classification across origin variants', () => {
    // Feature: macro, Property 5: Policy_Gate matches a reference rule model
    const base: TestPlan = {
      name: 'n',
      target: '',
      stages: [{ vus: 1, durationSec: 30 }],
      journey: [{ route: 'health', probability: 1, thinkMs: 0 }],
      stopThresholds: { p95Ms: 100, errorRatePct: 1 },
    };
    fc.assert(
      fc.property(arbTarget, fc.constantFrom(ALLOWLIST, PERMISSIVE_ALLOWLIST), (target, allowlist) => {
        check({ ...base, target }, allowlist);
      }),
      { numRuns: 500 },
    );
  });

  test('Property 5: generators cover accepted and rejected plans, and each rule', () => {
    // Feature: macro, Property 5: Policy_Gate matches a reference rule model
    const seen = new Set<string>();
    let accepted = 0;
    fc.assert(
      fc.property(arbPolicyPlan, (plan) => {
        const r = evaluatePlan(plan, ALLOWLIST);
        if (r.status === 'accepted') accepted++;
        else for (const x of r.violations) seen.add(x.rule);
        return true;
      }),
      { numRuns: 1000 },
    );
    expect(accepted).toBeGreaterThan(20);
    expect([...seen].sort()).toEqual(['4.2', '4.3', '4.4', '4.5', '4.6']);
  });

  test('arbAcceptedPlan is always accepted and arbBoundaryPlan sits on inclusive bounds and is accepted', () => {
    // Feature: macro, Property 5: Policy_Gate matches a reference rule model
    fc.assert(
      fc.property(fc.oneof(arbAcceptedPlan, arbBoundaryPlan), (plan) => {
        expect(evaluatePlan(plan, ALLOWLIST)).toEqual({ status: 'accepted' });
        expect(reference(plan, ALLOWLIST)).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});
