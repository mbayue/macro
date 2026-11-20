/**
 * Pure view-model helpers for the Runs Table (`#/runs`) and Run Compare selection.
 * No DOM or React dependencies.
 */
import type { RunListItem, RunSnapshot } from '../../../../../../src/api-types.ts';
import { displayBreakingPoint, displaySafeCapacity } from '../../../../../../src/report/compare.ts';
import type { RunKind, RunStatus } from '../../../../../../src/types.ts';
import { fmtUtc } from '../../lib/format.ts';
import type { RecentRun } from '../../lib/recent-runs.ts';
import { reportExpected } from '../../lib/run-view.ts';

export type RunsRowStatus = RunStatus | 'checking' | 'unknown';
export type RunsStatusFilter = 'all' | 'completed' | 'running' | 'stopped_halted' | 'failed';
export type RunsKindFilter = 'all' | 'run' | 'probe';

export interface RunsTableRow {
  runId: string;
  kind: RunKind;
  title: string;
  startedAt: number;
  startedUtc: string;
  status: RunsRowStatus;
  safeCapacity: number | null;
  breakingPoint: number | null;
  hasReport: boolean;
}

export interface RunsTableFilter {
  status?: RunsStatusFilter | undefined;
  kind?: RunsKindFilter | undefined;
  query?: string | undefined;
}

export const STATUS_FILTER_OPTIONS: readonly { value: RunsStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'running', label: 'Running' },
  { value: 'stopped_halted', label: 'Stopped / Halted' },
  { value: 'failed', label: 'Failed' },
];

export const KIND_FILTER_OPTIONS: readonly { value: RunsKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'run', label: 'Load tests' },
  { value: 'probe', label: 'Probes' },
];

function normalizeTitle(rawTitle: string | undefined, kind: RunKind): string {
  const trimmed = rawTitle?.trim() ?? '';
  if (trimmed !== '') return trimmed;
  return kind === 'probe' ? 'Containment probe' : 'Load test';
}

export function mapAccountRunRow(item: RunListItem): RunsTableRow {
  const kind: RunKind = item.kind ?? 'run';
  const hasReport =
    kind !== 'probe' &&
    (item.safeCapacity !== null || item.breakingPoint !== null || reportExpected(item.status));
  return {
    runId: item.runId,
    kind,
    title: normalizeTitle(item.title, kind),
    startedAt: item.startedAt,
    startedUtc: fmtUtc(item.startedAt),
    status: item.status,
    safeCapacity: item.safeCapacity,
    breakingPoint: item.breakingPoint,
    hasReport,
  };
}

export function mapBrowserRunRow(
  entry: RecentRun,
  snapshot?: RunSnapshot | null,
  fallbackStatus: 'checking' | 'unknown' = 'checking',
): RunsTableRow {
  const kind: RunKind = snapshot?.run.kind ?? entry.kind;
  const startedAt = snapshot?.run.startedAt ?? entry.startedAt;
  const title = normalizeTitle(snapshot?.plan?.name ?? snapshot?.report?.planName ?? entry.name, kind);
  if (snapshot) {
    const hasReport = kind !== 'probe' && snapshot.report !== null;
    return {
      runId: entry.id,
      kind,
      title,
      startedAt,
      startedUtc: fmtUtc(startedAt),
      status: snapshot.run.status,
      safeCapacity: snapshot.report?.headline.safeCapacity ?? null,
      breakingPoint: snapshot.report?.headline.breakingPoint ?? null,
      hasReport,
    };
  }
  return {
    runId: entry.id,
    kind,
    title,
    startedAt,
    startedUtc: fmtUtc(startedAt),
    status: fallbackStatus,
    safeCapacity: null,
    breakingPoint: null,
    hasReport: false,
  };
}

export function rowHasReport(row: Pick<RunsTableRow, 'kind' | 'hasReport'>): boolean {
  return row.kind !== 'probe' && row.hasReport;
}

export function formatCapacityCell(
  metric: 'safeCapacity' | 'breakingPoint',
  value: number | null,
  hasReport = true,
): string {
  if (!hasReport && value === null) return '\u2013';
  return metric === 'safeCapacity' ? displaySafeCapacity(value) : displayBreakingPoint(value);
}

function matchesStatusFilter(status: RunsRowStatus, filter: RunsStatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'completed':
      return status === 'completed';
    case 'running':
      return status === 'running' || status === 'queued';
    case 'stopped_halted':
      return status === 'halted' || status === 'stopped' || status === 'timed_out';
    case 'failed':
      return status === 'failed' || status === 'interrupted';
  }
}

export function filterRunsRows(rows: readonly RunsTableRow[], filter: RunsTableFilter): RunsTableRow[] {
  const kind = filter.kind ?? 'all';
  const status = filter.status ?? 'all';
  const needle = (filter.query ?? '').trim().toLowerCase();

  if (kind === 'all' && status === 'all' && needle === '') {
    return [...rows];
  }

  return rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false;
    if (!matchesStatusFilter(row.status, status)) return false;
    if (needle !== '') {
      return row.title.toLowerCase().includes(needle) || row.runId.toLowerCase().includes(needle);
    }
    return true;
  });
}

export function togglePickedRun(picked: readonly string[], runId: string, on: boolean): string[] {
  if (!on) return picked.filter((id) => id !== runId);
  if (picked.includes(runId) || picked.length >= 2) return [...picked];
  return [...picked, runId];
}

export function getPickedComparePair(
  rows: readonly RunsTableRow[],
  picked: readonly string[],
): { a: string; b: string } | null {
  if (picked.length !== 2) return null;
  const [a, b] = picked;
  if (a === undefined || b === undefined || a === b) return null;
  const rowA = rows.find((r) => r.runId === a);
  const rowB = rows.find((r) => r.runId === b);
  if (!rowA || !rowB) return null;
  if (!rowHasReport(rowA) || !rowHasReport(rowB)) return null;
  return { a, b };
}

export function canComparePickedRuns(rows: readonly RunsTableRow[], picked: readonly string[]): boolean {
  return getPickedComparePair(rows, picked) !== null;
}

export function compareSelectionHint(rows: readonly RunsTableRow[], picked: readonly string[]): string {
  if (picked.length === 0) {
    return 'Select two load test runs that have reports to compare.';
  }
  if (picked.length === 1) {
    const first = rows.find((r) => r.runId === picked[0]);
    if (first && !rowHasReport(first)) {
      return 'The selected run has no report yet. Select two load test runs that have reports to compare.';
    }
    return 'Select one more load test run with a report to compare.';
  }
  if (!canComparePickedRuns(rows, picked)) {
    return 'Both selected runs must be load tests with a capacity report to compare.';
  }
  return 'Ready to compare the two selected runs side by side.';
}

export function prunePickedRuns(rows: readonly RunsTableRow[], picked: readonly string[]): string[] {
  if (picked.length === 0) return [];
  const valid = new Set(rows.map((r) => r.runId));
  return picked.filter((id) => valid.has(id)).slice(0, 2);
}
