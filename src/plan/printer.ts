/**
 * Plan_Printer and Plan_Hash (requirements 3.6, 3.7).
 */

import { createHash } from 'node:crypto';
import type { TestPlan } from '../types.ts';

/** Compare strings by Unicode code point (not UTF-16 code unit). */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done && nb.done) return 0;
    if (na.done) return -1;
    if (nb.done) return 1;
    const ca = na.value.codePointAt(0) ?? 0;
    const cb = nb.value.codePointAt(0) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new RangeError('cannot print a non-finite number');
      return JSON.stringify(value); // -0 -> "0"; safe integers never use an exponent
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => compareCodePoints(a, b));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`cannot print a value of type ${typeof value}`);
  }
}

/** Canonical JSON: keys sorted by code point at every level, no whitespace. */
export function printPlan(plan: TestPlan): string {
  return canonical(plan);
}

/** SHA-256 (lowercase hex) of the UTF-8 bytes of the printed plan text. */
export function planHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
