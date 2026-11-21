/**
 * Shared formatting helpers for the Macro app (no DOM).
 */
import type { ParseErrorView } from '../../../../../src/api-types.ts';

/**
 * A count in running copy, grouped like `1,500`. Fixed to en-US on purpose: the app's copy is English,
 * and a browser locale would put `1.500` into English sentences. Metric readings use the plain-digit
 * formatters in src/run/format.ts instead, so they match the report and the AI text.
 */
const GROUPED = new Intl.NumberFormat('en-US');
export function fmtGrouped(n: number): string {
  return GROUPED.format(n);
}

/** `2026-05-21 14:03:07 UTC` for an epoch-ms value. */
export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Plain-text description of a parse error: reason plus path or offset. */
export function parseErrorText(pe: ParseErrorView): string {
  let text = pe.reason;
  if (pe.path !== undefined && pe.path !== '') text += ` (at ${pe.path})`;
  if (pe.offset !== undefined) text += ` (at character offset ${pe.offset})`;
  return text;
}
