/**
 * Policy_Gate (requirement 4; design "Policy_Gate").
 *
 * Pure and synchronous: no I/O, no network, no clock. Every rule is
 * evaluated, and violations come back in a fixed order: rule 4.2 -> 4.6,
 * then by path (array indexes compared numerically).
 */

import type { TestPlan } from '../types.ts';
import { isRouteId } from './catalog.ts';

export type PolicyRule = '4.2' | '4.3' | '4.4' | '4.5' | '4.6';

export interface Violation {
  rule: PolicyRule;
  path: string;
  message: string;
}

export type GateResult =
  | { status: 'accepted' }
  | { status: 'rejected'; violations: Violation[] };

const RULE_ORDER: readonly PolicyRule[] = ['4.2', '4.3', '4.4', '4.5', '4.6'];

// ---------------------------------------------------------------------------
// Rule 4.2: target origin
// ---------------------------------------------------------------------------

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const AUTHORITY_AND_REST = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)(.*)$/s;

/** Target_Denylist, compared on a lowercased URL hostname (requirements glossary). */
export function isDenylistedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.endsWith('.') && !host.endsWith(']')) host = host.slice(0, -1);
  if (host.startsWith('[')) return true; // bracketed IPv6 literal
  if (IPV4_LITERAL.test(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (host === 'macro.my.id') return true;
  return host === 'yueshop.xyz' || host.endsWith('.yueshop.xyz');
}

type TargetCheck = { ok: true; origin: string; hostname: string } | { ok: false; reason: string };

/** Parse a target (or allowlist entry) as a bare origin. */
export function parseOrigin(raw: string): TargetCheck {
  const m = AUTHORITY_AND_REST.exec(raw);
  if (!m) return { ok: false, reason: 'target is not an absolute URL with an authority' };
  const authority = m[1] ?? '';
  const rest = m[2] ?? '';
  if (authority.includes('@')) return { ok: false, reason: 'target must not contain userinfo' };
  if (rest !== '' && rest !== '/') {
    if (rest.startsWith('?')) return { ok: false, reason: 'target must not have a query' };
    if (rest.startsWith('#')) return { ok: false, reason: 'target must not have a fragment' };
    return { ok: false, reason: 'target must not have a path other than "/"' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'target is not a valid URL' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'target must not contain userinfo' };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { ok: false, reason: 'target must be an origin only' };
  }
  if (url.origin === 'null') return { ok: false, reason: 'target has no network origin' };
  return { ok: true, origin: url.origin, hostname: url.hostname };
}

function normalizedAllowlist(allowlist: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const entry of allowlist) {
    const parsed = parseOrigin(entry);
    if (parsed.ok) out.add(parsed.origin);
  }
  return out;
}

function checkTarget(plan: TestPlan, allowlist: readonly string[], out: Violation[]): void {
  const path = 'target';
  const parsed = parseOrigin(plan.target);
  if (!parsed.ok) {
    out.push({ rule: '4.2', path, message: parsed.reason });
    return;
  }
  if (isDenylistedHost(parsed.hostname)) {
    out.push({ rule: '4.2', path, message: `target host ${parsed.hostname} is on the Target_Denylist` });
    return;
  }
  if (!normalizedAllowlist(allowlist).has(parsed.origin)) {
    out.push({
      rule: '4.2',
      path,
      message: `target origin ${parsed.origin} is not in the Target_Allowlist`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rules 4.3 - 4.6
// ---------------------------------------------------------------------------

function checkRoutes(
  plan: TestPlan,
  out: Violation[],
  routes: readonly { id: string }[] | undefined,
): void {
  const allowed = routes === undefined ? null : new Set(routes.map((r) => r.id));
  plan.journey.forEach((step, i) => {
    const known = allowed === null ? isRouteId(step.route) : allowed.has(step.route);
    if (!known) {
      out.push({
        rule: '4.3',
        path: `journey[${i}].route`,
        message:
          allowed === null
            ? `route ${JSON.stringify(step.route)} is not in the Route_Catalog`
            : `route ${JSON.stringify(step.route)} is not in the discovered routes`,
      });
    }
  });
}

const isWhole = (n: number): boolean => Number.isInteger(n);

function checkStages(plan: TestPlan, out: Violation[]): void {
  const { stages } = plan;
  if (stages.length < 1 || stages.length > 6) {
    out.push({ rule: '4.4', path: 'stages', message: `stage count ${stages.length} is outside 1 to 6` });
  }
  let sum = 0;
  stages.forEach((stage, i) => {
    const { vus, durationSec } = stage;
    if (!isWhole(vus) || vus < 1 || vus > 500) {
      out.push({
        rule: '4.4',
        path: `stages[${i}].vus`,
        message: `VU count ${vus} is not a whole number from 1 to 500`,
      });
    }
    if (!isWhole(durationSec) || durationSec < 30 || durationSec > 180) {
      out.push({
        rule: '4.4',
        path: `stages[${i}].durationSec`,
        message: `duration ${durationSec} is not a whole number of seconds from 30 to 180`,
      });
    }
    sum += durationSec;
    const prev = stages[i - 1];
    if (prev !== undefined && !(vus > prev.vus)) {
      out.push({
        rule: '4.4',
        path: `stages[${i}].vus`,
        message: `VU count ${vus} is not greater than the previous stage (${prev.vus})`,
      });
    }
  });
  if (sum > 600) {
    out.push({ rule: '4.4', path: 'stages', message: `total duration ${sum} s is above 600 s` });
  }
}

function checkJourney(plan: TestPlan, out: Violation[]): void {
  const { journey } = plan;
  if (journey.length < 1 || journey.length > 8) {
    out.push({ rule: '4.5', path: 'journey', message: `journey length ${journey.length} is outside 1 to 8` });
  }
  let orderCreates = 0;
  journey.forEach((step, i) => {
    const { probability, thinkMs } = step;
    if (!isWhole(probability) || probability < 1 || probability > 100) {
      out.push({
        rule: '4.5',
        path: `journey[${i}].probability`,
        message: `probability ${probability} is not a whole number from 1 to 100`,
      });
    }
    if (!isWhole(thinkMs) || thinkMs < 0 || thinkMs > 10000) {
      out.push({
        rule: '4.5',
        path: `journey[${i}].thinkMs`,
        message: `think time ${thinkMs} is not a whole number of milliseconds from 0 to 10000`,
      });
    }
    if (step.route === 'order_create') {
      orderCreates++;
      if (orderCreates > 1) {
        out.push({
          rule: '4.5',
          path: `journey[${i}].route`,
          message: 'only one order_create step is allowed',
        });
      }
      if (probability > 25) {
        out.push({
          rule: '4.5',
          path: `journey[${i}].probability`,
          message: `order_create probability ${probability} is above 25`,
        });
      }
    }
  });
}

function checkThresholds(plan: TestPlan, out: Violation[]): void {
  const { p95Ms, errorRatePct } = plan.stopThresholds;
  if (!(p95Ms >= 100 && p95Ms <= 5000)) {
    out.push({
      rule: '4.6',
      path: 'stopThresholds.p95Ms',
      message: `p95 limit ${p95Ms} ms is outside 100 to 5000`,
    });
  }
  if (!(errorRatePct >= 0.1 && errorRatePct <= 20)) {
    out.push({
      rule: '4.6',
      path: 'stopThresholds.errorRatePct',
      message: `error rate limit ${errorRatePct}% is outside 0.1 to 20`,
    });
  }
}

// ---------------------------------------------------------------------------
// Ordering and entry point
// ---------------------------------------------------------------------------

type PathToken = string | number;

function tokenizePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (const m of path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) {
    tokens.push(m[1] !== undefined ? Number(m[1]) : (m[2] ?? ''));
  }
  return tokens;
}

/** Order paths field by field; array indexes compare numerically, a prefix sorts first. */
export function comparePaths(a: string, b: string): number {
  const ta = tokenizePath(a);
  const tb = tokenizePath(b);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i] as PathToken;
    const y = tb[i] as PathToken;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return ta.length - tb.length;
}

/**
 * Evaluate every policy rule and return all violations. `allowlist` is
 * `Config.target.allowlist`.
 */
export function evaluatePlan(
  plan: TestPlan,
  allowlist: readonly string[],
  routes?: readonly { id: string; method: 'GET' | 'POST'; path: string }[],
): GateResult {
  const violations: Violation[] = [];
  checkTarget(plan, allowlist, violations);
  checkRoutes(plan, violations, routes);
  checkStages(plan, violations);
  checkJourney(plan, violations);
  checkThresholds(plan, violations);

  if (violations.length === 0) return { status: 'accepted' };
  // Array.prototype.sort is stable, so ties keep their emission order.
  violations.sort(
    (a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || comparePaths(a.path, b.path),
  );
  return { status: 'rejected', violations };
}
