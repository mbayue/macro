/** Display title copied from the approved plan name at run start. */

export const LOAD_TEST_TITLE = 'Load test';
export const PROBE_TITLE = 'Containment probe';
export const RUN_TITLE_MAX = 80;

/** One line, capped. Empty or missing input becomes `fallback`. */
export function normalizeRunTitle(raw: string | null | undefined, fallback = LOAD_TEST_TITLE): string {
  const flat = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return fallback;
  const cut = [...flat].slice(0, RUN_TITLE_MAX).join('').trimEnd();
  return cut === '' ? fallback : cut;
}
