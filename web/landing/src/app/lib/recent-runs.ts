/**
 * Recent runs kept in this browser (localStorage), so a visitor can get back to a run or probe
 * after leaving its page. Nothing is sent to the server except the status lookups
 * (GET /api/runs/:id) for the entries shown.
 *
 * Stored entries are untrusted input: each one is validated on load and invalid ones are dropped.
 * If storage is unavailable (private mode, disabled), every function quietly does nothing.
 */
import type { RunKind } from '../../../../../src/types.ts';

const KEY = 'macro.recentRuns.v1';
const MAX_STORED = 10;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export interface RecentRun {
  id: string;
  kind: RunKind;
  name: string;
  startedAt: number;
}

function isRecentRun(v: unknown): v is RecentRun {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    ID_RE.test(r['id']) &&
    (r['kind'] === 'run' || r['kind'] === 'probe') &&
    typeof r['name'] === 'string' &&
    r['name'].length <= 200 &&
    typeof r['startedAt'] === 'number' &&
    Number.isFinite(r['startedAt'])
  );
}

export function loadRecentRuns(): RecentRun[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentRun).slice(0, MAX_STORED);
  } catch {
    return [];
  }
}

function save(list: RecentRun[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {
    // Storage full or disabled: the list is a convenience only.
  }
}

/** Add or refresh an entry; newest first, one entry per run ID. */
export function rememberRun(entry: RecentRun): void {
  if (!isRecentRun(entry)) return;
  const rest = loadRecentRuns().filter((r) => r.id !== entry.id);
  const list = [entry, ...rest].sort((a, b) => b.startedAt - a.startedAt);
  save(list);
}

export function forgetRun(id: string): void {
  save(loadRecentRuns().filter((r) => r.id !== id));
}
