/**
 * Plan_Parser (requirements 3.1-3.5; design "Plan_Parser and Plan_Printer").
 */

import type { TestPlan } from '../types.ts';
import { parseStrict } from './json-strict.ts';
import { formatPath, isIntegerFieldPath, TestPlanSchema } from './schema.ts';

export const MAX_PLAN_BYTES = 16384;

export interface ParseError {
  reason: string;
  path?: string;
  offset?: number;
}

export type ParseResult =
  | { ok: true; plan: TestPlan }
  | {
      ok: false;
      /** First error (the one most callers show). */
      error: ParseError;
      /** All errors found, first one first. */
      errors: ParseError[];
    };

function failure(errors: ParseError[]): ParseResult {
  const [first] = errors;
  return { ok: false, error: first ?? { reason: 'invalid plan' }, errors };
}

function makeError(reason: string, path?: string, offset?: number): ParseError {
  const e: ParseError = { reason };
  if (path !== undefined && path !== '') e.path = path;
  if (offset !== undefined) e.offset = offset;
  return e;
}

function sizeCheck(text: string): ParseError | undefined {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_PLAN_BYTES) {
    return makeError(`input is ${bytes} bytes, larger than the ${MAX_PLAN_BYTES} byte (16 KiB) limit`);
  }
  return undefined;
}

/** Replace -0 with 0 in every number of a parsed plan. */
function normalizeNegativeZero<T>(value: T): T {
  if (typeof value === 'number') return (value === 0 ? 0 : value) as T;
  if (Array.isArray(value)) return value.map((v) => normalizeNegativeZero(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeNegativeZero(v);
    return out as T;
  }
  return value;
}

/**
 * Parse bare Test_Plan JSON (no fence handling). The 16 KiB cap, strict JSON
 * parse, schema check, integer-lexeme check and -0 normalization all apply.
 * `baseOffset` is added to JSON syntax error offsets so they point into the
 * caller's original text.
 */
export function parsePlanJson(jsonText: string, baseOffset = 0): ParseResult {
  const tooBig = sizeCheck(jsonText);
  if (tooBig) return failure([tooBig]);

  const strict = parseStrict(jsonText);
  if (!strict.ok) {
    return failure([makeError(`invalid JSON: ${strict.reason}`, strict.path, strict.offset + baseOffset)]);
  }

  const result = TestPlanSchema.safeParse(strict.value);
  const errors: ParseError[] = [];
  const reported = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) {
          const path = formatPath([...issue.path, key]);
          errors.push(makeError('field is not part of the Test_Plan schema', path));
          reported.add(path);
        }
        continue;
      }
      const path = formatPath(issue.path);
      const missing = issue.code === 'invalid_type' && /received undefined/.test(issue.message);
      errors.push(makeError(missing ? 'required field is missing' : issue.message, path));
      reported.add(path);
    }
  }

  // 5.0 and 1e2 parse to integers; the lexeme check rejects them (3.3).
  for (const path of strict.nonIntegerLexemes) {
    if (isIntegerFieldPath(path) && !reported.has(path)) {
      errors.push(makeError('integer required, found a number with a fraction or exponent', path));
    }
  }

  if (errors.length > 0 || !result.success) return failure(errors);
  return { ok: true, plan: normalizeNegativeZero(result.data) };
}

/** Find the first opening fence anywhere in the text (prose may precede it on the same line). */
const OPEN_FENCE = /```/;
const JSON_TAG = /^json(?![A-Za-z0-9_])/i;

/**
 * Parse Test_Plan text as produced by an LLM or a user: bare JSON, or JSON
 * inside the first Markdown code fence. Text outside the fence is ignored.
 */
export function parsePlan(text: string): ParseResult {
  const tooBig = sizeCheck(text);
  if (tooBig) return failure([tooBig]);

  // A leading `{` means bare JSON, even if a string value contains ```.
  if (text.trimStart().startsWith('{')) return parsePlanJson(text);

  const open = OPEN_FENCE.exec(text);
  if (!open) return parsePlanJson(text);

  let contentStart = open.index + open[0].length;
  const tag = JSON_TAG.exec(text.slice(contentStart));
  if (tag) contentStart += tag[0].length;

  const close = text.indexOf('```', contentStart);
  if (close === -1) {
    return failure([makeError('code fence is unclosed: opening ``` has no closing ```', undefined, open.index)]);
  }
  return parsePlanJson(text.slice(contentStart, close), contentStart);
}
