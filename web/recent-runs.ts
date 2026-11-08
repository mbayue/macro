/**
 * Recent runs kept in this browser (localStorage), so a visitor can get back to a run or probe
 * after leaving its page. Nothing is sent to the server except the status lookups
 * (GET /api/runs/:id) for the entries shown.
 *
 * Stored entries are untrusted input: each one is validated on load and invalid ones are dropped.
 * If storage is unavailable (private mode, disabled), every function quietly does nothing.
 */
import type { RunKind, RunStatus } from '../src/types.ts';
import { getRun } from './api.ts';
import { clear, el, fmtUtc } from './dom.ts';

const KEY = 'macro.recentRuns.v1';
const MAX_STORED = 10;
const MAX_SHOWN = 5;
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

function statusClass(status: RunStatus): string {
  switch (status) {
    case 'completed':
      return 'badge badge--ok';
    case 'halted':
    case 'stopped':
    case 'timed_out':
      return 'badge badge--warn';
    case 'failed':
    case 'interrupted':
      return 'badge badge--bad';
    default:
      return 'badge';
  }
}

/**
 * Fill `host` with the "Recent runs in this browser" panel. Hidden when the list is empty.
 * Returns a cleanup that cancels the status lookups.
 */
export function renderRecentRuns(host: HTMLElement): () => void {
  const abort = new AbortController();
  clear(host);
  const entries = loadRecentRuns().slice(0, MAX_SHOWN);
  if (entries.length === 0) return () => abort.abort();

  const list = el('ul', { class: 'recent' });
  const panel = el(
    'section',
    { class: 'panel stack stack--tight', 'aria-label': 'Recent runs in this browser' },
    el('h2', null, 'Recent runs in this browser'),
    list,
  );

  for (const r of entries) {
    const href = `#/${r.kind === 'probe' ? 'probe' : 'run'}/${encodeURIComponent(r.id)}`;
    const badge = el('span', { class: 'badge' }, 'checking');
    const item = el(
      'li',
      { class: 'recent__item' },
      el('a', { href }, r.kind === 'probe' ? 'Containment probe' : r.name),
      badge,
      el('span', { class: 'muted recent__time' }, `started ${fmtUtc(r.startedAt)}`),
    );
    list.append(item);

    void getRun(r.id, abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      if (res.ok) {
        const status = res.data.run.status;
        badge.className = statusClass(status);
        badge.textContent = status === 'running' ? 'running now' : status.replace('_', ' ');
      } else if (res.error.code === 'not_found') {
        // The server no longer has this run: drop it from the list.
        forgetRun(r.id);
        item.remove();
        if (list.childElementCount === 0) panel.remove();
      } else {
        badge.textContent = 'status unknown';
      }
    });
  }

  host.append(panel);
  return () => abort.abort();
}
