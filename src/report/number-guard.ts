/**
 * Number_Guard (requirement 10.7): every numeric token in AI-written text must
 * equal a member of the Run's Allowed_Numbers. Pure functions.
 */

import { roundHalfAway } from '../run/format.ts';
import type { CapacityReport } from './build.ts';

/**
 * Map non-ASCII decimal digits that NFKC leaves alone (for example Arabic-Indic
 * digits) to ASCII, so they cannot hide a number from the guard. The digit
 * value is the number of directly preceding decimal-digit code points,
 * modulo 10 (Unicode lays decimal digits out in contiguous zero-to-nine runs).
 */
function asciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp > 0x7f && /\p{Nd}/u.test(ch)) {
      let k = 0;
      while (/\p{Nd}/u.test(String.fromCodePoint(cp - k - 1))) k += 1;
      out += String(k % 10);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * A token: digits with comma thousands groups (1-3 digits, then groups of
 * exactly 3) and at most one decimal part, or a bare `.5`-style decimal.
 * A token that directly follows a letter, or a letter plus a digit run (with
 * `,`/`.` separators), is not a match, so `p95`, `v1`, `k6`, `v1.2` yield
 * nothing. Malformed
 * grouping (`3,4`, `12,34`, `12,3456`) splits into separate tokens.
 */
const TOKEN_RE = /(?<!\p{L}(?:\d+(?:[,.]\d+)*[,.]?)?)(?:(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?|\.\d+)/gu;

/** Extract numeric tokens (normalized with NFKC) as raw strings, in order. */
export function numericTokens(text: string): string[] {
  const normalized = asciiDigits(text.normalize('NFKC'));
  return normalized.match(TOKEN_RE) ?? [];
}

/** Numeric value of a token produced by `numericTokens`. */
export function tokenValue(token: string): number {
  return Number(token.replaceAll(',', ''));
}

export type GuardResult = { ok: true } | { ok: false; offending: number[] };

/** Pass only if every token's numeric value equals a member of `allowed`. */
export function guardText(text: string, allowed: ReadonlySet<number>): GuardResult {
  const offending: number[] = [];
  for (const token of numericTokens(text)) {
    const v = tokenValue(token);
    if (!allowed.has(v) && !offending.includes(v)) offending.push(v);
  }
  return offending.length === 0 ? { ok: true } : { ok: false, offending };
}

/**
 * Allowed_Numbers for a Run: every displayed Stage_Metrics value (overall and
 * per route) as rounded for display, every Stage VU count, duration, and index
 * (both the stored index and the 1-based display index), the Stop_Thresholds,
 * Safe_Capacity, Breaking_Point, and the integers 0 through 10.
 *
 * Works on a report built from partial data too (for example the Stages so
 * far, for a Supervisor_Agent reason).
 */
export function allowedNumbers(
  report: Pick<CapacityReport, 'thresholds' | 'stages' | 'headline'>,
): Set<number> {
  const allowed = new Set<number>();
  for (let i = 0; i <= 10; i++) allowed.add(i);

  allowed.add(report.thresholds.p95Ms);
  allowed.add(report.thresholds.errorRatePct);
  if (report.headline.safeCapacity !== null) allowed.add(report.headline.safeCapacity);
  if (report.headline.breakingPoint !== null) allowed.add(report.headline.breakingPoint);

  const addMetrics = (m: { requests: number; rps: number; errorRatePct: number; http429: number; p50: number; p95: number; p99: number }): void => {
    allowed.add(roundHalfAway(m.requests, 0));
    allowed.add(roundHalfAway(m.http429, 0));
    allowed.add(roundHalfAway(m.rps, 1));
    allowed.add(roundHalfAway(m.errorRatePct, 1));
    allowed.add(roundHalfAway(m.p50, 0));
    allowed.add(roundHalfAway(m.p95, 0));
    allowed.add(roundHalfAway(m.p99, 0));
  };

  for (const s of report.stages) {
    allowed.add(s.index);
    allowed.add(s.displayIndex);
    allowed.add(s.vus);
    allowed.add(s.durationSec);
    if (s.overall !== null) addMetrics(s.overall.raw);
    for (const r of s.routes) addMetrics(r.raw);
  }
  return allowed;
}
