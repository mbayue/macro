import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { MAX_PLAN_BYTES, parsePlan } from '../src/plan/parser.ts';
import { printPlan } from '../src/plan/printer.ts';
import type { TestPlan } from '../src/types.ts';
import { arbTestPlan } from './arb.ts';

type Seg = string | number;

/** Field path in the notation of the parse errors: `stages[2].vus`. */
function fmt(segs: readonly Seg[]): string {
  let out = '';
  for (const s of segs) out += typeof s === 'number' ? `[${s}]` : out === '' ? s : `.${s}`;
  return out;
}

/** Every value inside a plan, below the root. */
function allPaths(plan: TestPlan): Seg[][] {
  const paths: Seg[][] = [
    ['name'],
    ['target'],
    ['stages'],
    ['journey'],
    ['stopThresholds'],
    ['stopThresholds', 'p95Ms'],
    ['stopThresholds', 'errorRatePct'],
  ];
  plan.stages.forEach((_, i) => {
    paths.push(['stages', i], ['stages', i, 'vus'], ['stages', i, 'durationSec']);
  });
  plan.journey.forEach((_, i) => {
    paths.push(['journey', i], ['journey', i, 'route'], ['journey', i, 'probability'], ['journey', i, 'thinkMs']);
  });
  return paths;
}

/** Objects of the plan (root included). */
function objectPaths(plan: TestPlan): Seg[][] {
  return [
    [],
    ['stopThresholds'],
    ...plan.stages.map((_, i): Seg[] => ['stages', i]),
    ...plan.journey.map((_, i): Seg[] => ['journey', i]),
  ];
}

const INTEGER_FIELDS = new Set(['vus', 'durationSec', 'probability', 'thinkMs', 'p95Ms']);

function integerPaths(plan: TestPlan): Seg[][] {
  return allPaths(plan).filter((segs) => INTEGER_FIELDS.has(String(segs.at(-1))));
}

function getAt(root: unknown, segs: readonly Seg[]): unknown {
  let cur = root;
  for (const s of segs) cur = (cur as Record<Seg, unknown>)[s];
  return cur;
}

function setAt(root: unknown, segs: readonly Seg[], value: unknown): void {
  const parent = getAt(root, segs.slice(0, -1)) as Record<Seg, unknown>;
  parent[segs.at(-1) as Seg] = value;
}

function deleteAt(root: unknown, segs: readonly Seg[]): void {
  const parent = getAt(root, segs.slice(0, -1)) as Record<Seg, unknown>;
  delete parent[segs.at(-1) as Seg];
}

/** Replacement values whose type differs from the original value at a path. */
function wrongTypeValues(original: unknown): unknown[] {
  const all: unknown[] = ['text', 7, true, null, [], {}];
  const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  return all.filter((v) => kind(v) !== kind(original));
}

/** Compact JSON writer that can repeat one key of one object and replace number lexemes. */
function emit(
  plan: TestPlan,
  opts: { dup?: { segs: readonly Seg[]; key: string }; lexemes?: ReadonlyMap<string, string> },
): { text: string; dupOffset: number | undefined } {
  let out = '';
  let dupOffset: number | undefined;
  const dupPath = opts.dup ? fmt(opts.dup.segs) : undefined;
  const walk = (value: unknown, segs: readonly Seg[]): void => {
    if (Array.isArray(value)) {
      out += '[';
      value.forEach((v, i) => {
        if (i > 0) out += ',';
        walk(v, [...segs, i]);
      });
      out += ']';
    } else if (value !== null && typeof value === 'object') {
      out += '{';
      const entries = Object.entries(value);
      entries.forEach(([k, v], i) => {
        if (i > 0) out += ',';
        out += `${JSON.stringify(k)}:`;
        walk(v, [...segs, k]);
      });
      if (opts.dup && fmt(segs) === dupPath) {
        out += ',';
        dupOffset = out.length;
        out += `${JSON.stringify(opts.dup.key)}:${JSON.stringify((value as Record<string, unknown>)[opts.dup.key])}`;
      }
      out += '}';
    } else if (typeof value === 'number' && opts.lexemes?.has(fmt(segs))) {
      out += opts.lexemes.get(fmt(segs));
    } else {
      out += JSON.stringify(value);
    }
  };
  walk(plan, []);
  return { text: out, dupOffset };
}

function expectRejected(text: string): { reason: string; path?: string; offset?: number } {
  const r = parsePlan(text);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.errors[0]).toEqual(r.error);
  return r.error;
}

describe('malformed plan text', () => {
  test('Property 3: dropping a required field reports it missing at its path', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), (plan, k) => {
        // Fields only: removing an array element is not "dropping a required field".
        const paths = allPaths(plan).filter((segs) => typeof segs.at(-1) === 'string');
        const segs = paths[k % paths.length] as Seg[];
        const mutated = structuredClone(plan);
        deleteAt(mutated, segs);
        const error = expectRejected(printPlan(mutated));
        expect(error.path).toBe(fmt(segs));
        expect(error.reason).toMatch(/missing/i);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: an unknown field is rejected and located', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), fc.constantFrom('extra', 'unknown_field', 'note', 'x1'), (plan, k, key) => {
        const objects = objectPaths(plan);
        const segs = objects[k % objects.length] as Seg[];
        const mutated = structuredClone(plan);
        (getAt(mutated, segs) as Record<string, unknown>)[key] = 1;
        const error = expectRejected(JSON.stringify(mutated));
        expect(error.path).toBe(fmt([...segs, key]));
        expect(error.reason).toMatch(/not part of the Test_Plan schema/);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: a duplicated key is rejected at the second occurrence', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), fc.nat(), (plan, k, j) => {
        const objects = objectPaths(plan);
        const segs = objects[k % objects.length] as Seg[];
        const keys = Object.keys(getAt(plan, segs) as object);
        const key = keys[j % keys.length] as string;
        const { text, dupOffset } = emit(plan, { dup: { segs, key } });
        const error = expectRejected(text);
        expect(error.reason).toMatch(/duplicate key/);
        expect(error.path).toBe(fmt([...segs, key]));
        expect(error.offset).toBe(dupOffset as number);
        expect(text.slice(dupOffset, (dupOffset as number) + key.length + 2)).toBe(JSON.stringify(key));
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: a fractional or exponent lexeme where an integer is required is rejected at its path', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    const lexemeFor = [
      (v: number) => `${v}.5`,
      (v: number) => `${v}.0`,
      (v: number) => `${v}e0`,
      (v: number) => `${v}E+0`,
      (v: number) => `${v}.25e1`,
    ];
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), fc.nat(), (plan, k, f) => {
        const paths = integerPaths(plan);
        const segs = paths[k % paths.length] as Seg[];
        const original = getAt(plan, segs) as number;
        const lexeme = (lexemeFor[f % lexemeFor.length] as (v: number) => string)(original);
        const { text } = emit(plan, { lexemes: new Map([[fmt(segs), lexeme]]) });
        const error = expectRejected(text);
        expect(error.path).toBe(fmt(segs));
        expect(error.reason).toMatch(/int/i);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: a value of the wrong type is rejected at its path', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), fc.nat(), (plan, k, v) => {
        const paths = allPaths(plan);
        const segs = paths[k % paths.length] as Seg[];
        const replacements = wrongTypeValues(getAt(plan, segs));
        const replacement = replacements[v % replacements.length];
        const mutated = structuredClone(plan);
        setAt(mutated, segs, replacement);
        const error = expectRejected(JSON.stringify(mutated));
        expect(error.path).toBe(fmt(segs));
        expect(error.reason).toMatch(/expected|invalid/i);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: text truncated to invalid JSON is rejected with an offset inside the kept text', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat(), (plan, k) => {
        const text = printPlan(plan);
        const cut = 1 + (k % (text.length - 1));
        const error = expectRejected(text.slice(0, cut));
        expect(error.reason).toMatch(/^invalid JSON/);
        expect(error.path).toBeUndefined();
        expect(typeof error.offset).toBe('number');
        expect(error.offset as number).toBeGreaterThanOrEqual(0);
        expect(error.offset as number).toBeLessThanOrEqual(cut);
      }),
      { numRuns: 300 },
    );
  });

  test('Property 3: text over 16,384 UTF-8 bytes is rejected, text at exactly 16,384 bytes is not', () => {
    // Feature: macro, Property 3: Malformed plan text is rejected with a located error
    fc.assert(
      fc.property(arbTestPlan, fc.nat({ max: 5000 }), (plan, extra) => {
        const text = printPlan(plan);
        const bytes = Buffer.byteLength(text, 'utf8');
        const over = text + ' '.repeat(MAX_PLAN_BYTES - bytes + 1 + extra);
        const error = expectRejected(over);
        expect(error.reason).toMatch(/16384 byte \(16 KiB\) limit/);
        expect(error.path).toBeUndefined();

        const exact = text + ' '.repeat(MAX_PLAN_BYTES - bytes);
        expect(Buffer.byteLength(exact, 'utf8')).toBe(MAX_PLAN_BYTES);
        expect(parsePlan(exact).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('size is measured in UTF-8 bytes, not characters', () => {
    const plan: TestPlan = {
      name: '',
      target: 'https://yue.macro.my.id',
      stages: [{ vus: 1, durationSec: 30 }],
      journey: [{ route: 'health', probability: 100, thinkMs: 0 }],
      stopThresholds: { p95Ms: 100, errorRatePct: 0.1 },
    };
    const base = Buffer.byteLength(printPlan(plan), 'utf8');
    // 4-byte characters: 4096 of them is 16384 bytes of name alone.
    const fits = { ...plan, name: '😀'.repeat(Math.floor((MAX_PLAN_BYTES - base) / 4)) };
    expect(Buffer.byteLength(printPlan(fits), 'utf8')).toBeLessThanOrEqual(MAX_PLAN_BYTES);
    expect(parsePlan(printPlan(fits)).ok).toBe(true);
    const tooBig = { ...plan, name: '😀'.repeat(Math.floor((MAX_PLAN_BYTES - base) / 4) + 1) };
    expect(Buffer.byteLength(printPlan(tooBig), 'utf8')).toBeGreaterThan(MAX_PLAN_BYTES);
    expect(tooBig.name.length).toBeLessThan(MAX_PLAN_BYTES); // would pass a character count
    expectRejected(printPlan(tooBig));
  });
});
