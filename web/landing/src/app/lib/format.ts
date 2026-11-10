/**
 * Shared formatting helpers for the Macro app (no DOM).
 */
import type { ParseErrorView } from '../../../../../src/api-types.ts';

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
