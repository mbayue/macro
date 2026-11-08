/**
 * Test_Plan zod schema (requirement 3.1; design "Plan_Parser and Plan_Printer").
 *
 * Only types and shapes are checked here. Value ranges, route membership and
 * the target origin belong to the Policy_Gate (requirement 3.2), so `route`,
 * `target` and `name` are plain strings and integers have no bounds.
 */

import { z } from 'zod';
import type { TestPlan } from '../types.ts';

export const StageSchema = z.strictObject({
  vus: z.int(),
  durationSec: z.int(),
});

export const JourneyStepSchema = z.strictObject({
  route: z.string(),
  probability: z.int(),
  thinkMs: z.int(),
});

export const StopThresholdsSchema = z.strictObject({
  p95Ms: z.int(),
  errorRatePct: z.number().finite(),
});

export const TestPlanSchema = z.strictObject({
  name: z.string(),
  target: z.string(),
  stages: z.array(StageSchema),
  journey: z.array(JourneyStepSchema),
  stopThresholds: StopThresholdsSchema,
});

// Compile-time check that the schema output is the shared TestPlan type.
type SchemaPlan = z.infer<typeof TestPlanSchema>;
const _assignable = (p: SchemaPlan): TestPlan => p;
void _assignable;

const INTEGER_FIELD_PATH =
  /^(?:stages\[\d+\]\.(?:vus|durationSec)|journey\[\d+\]\.(?:probability|thinkMs)|stopThresholds\.p95Ms)$/;

/**
 * True for paths (in parseStrict notation) of fields that must be integers.
 * Used to turn `5.0` / `1e2` lexemes into parse errors (requirement 3.3).
 */
export function isIntegerFieldPath(path: string): boolean {
  return INTEGER_FIELD_PATH.test(path);
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Format a zod issue path in the same notation as parseStrict:
 * `stages[2].vus`, non-identifier keys as `["key"]`.
 */
export function formatPath(segments: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else {
      const key = String(seg);
      if (IDENT.test(key)) out += out === '' ? key : `.${key}`;
      else out += `[${JSON.stringify(key)}]`;
    }
  }
  return out;
}
