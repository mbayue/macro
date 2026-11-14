/**
 * Report_Export CSV (design "Report export", docs/superpowers/specs/2026-11-14).
 *
 * Pure: takes a CapacityReport and returns the flat CSV text the browser
 * downloads. One table, one row per measured line (each Stage's overall block
 * then its route rows), headline values repeated on every row. Raw stored
 * numbers, never the display strings, and never the AI section: this file is
 * the measured answer only. The browser supplies the download and the print
 * path; nothing here touches the DOM.
 */

import type { CapacityReport } from './build.ts';

export const CSV_COLUMNS: readonly string[] = [
  'run_id',
  'plan_name',
  'plan_hash',
  'target',
  'run_status',
  'sandbox_runtime',
  'safe_capacity_vus',
  'breaking_point_vus',
  'first_degraded_route',
  'p95_limit_ms',
  'error_rate_limit_pct',
  'stage',
  'vus',
  'duration_sec',
  'scope',
  'route',
  'requests',
  'requests_per_sec',
  'error_rate_pct',
  'http_429',
  'p50_ms',
  'p95_ms',
  'p99_ms',
  'verdict',
  'note',
];

/** RFC 4180 field with spreadsheet formula-prefix neutralization. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

const num = (n: number): string => String(n);

function metricCells(m: {
  requests: number;
  rps: number;
  errorRatePct: number;
  http429: number;
  p50: number;
  p95: number;
  p99: number;
}): string[] {
  return [num(m.requests), num(m.rps), num(m.errorRatePct), num(m.http429), num(m.p50), num(m.p95), num(m.p99)];
}

/** Header followed by one row per measured line, in stage then route order. */
export function reportCsvRows(report: CapacityReport): string[][] {
  const head: string[] = [...CSV_COLUMNS];
  const rows: string[][] = [head];

  const shared = [
    report.runId,
    report.planName,
    report.planHash,
    report.target,
    report.headline.status,
    report.runtime,
    report.headline.safeCapacity === null ? '' : num(report.headline.safeCapacity),
    report.headline.breakingPoint === null ? '' : num(report.headline.breakingPoint),
    report.headline.firstDegradedRoute ?? '',
    num(report.thresholds.p95Ms),
    num(report.thresholds.errorRatePct),
  ];

  for (const s of report.stages) {
    const stageCols = [String(s.displayIndex), String(s.vus), String(s.durationSec)];
    if (s.overall === null) {
      rows.push([
        ...shared,
        ...stageCols,
        'overall',
        '',
        ...Array.from({ length: 7 }, () => ''),
        'error',
        s.errorReason ?? '',
      ]);
      continue;
    }
    rows.push([
      ...shared,
      ...stageCols,
      'overall',
      '',
      ...metricCells(s.overall.raw),
      s.verdict === null ? '' : s.verdict,
      '',
    ]);
    for (const r of s.routes) {
      rows.push([
        ...shared,
        ...stageCols,
        'route',
        r.route,
        ...metricCells(r.raw),
        r.exceedsThresholds ? 'exceeded' : 'within',
        '',
      ]);
    }
  }
  return rows;
}

/** The full CSV file: UTF-8 BOM, CRLF line endings, one trailing CRLF. */
export function reportToCsv(report: CapacityReport): string {
  const text = reportCsvRows(report)
    .map((row) => row.map(csvField).join(','))
    .join('\r\n');
  return `\uFEFF${text}\r\n`;
}

/** `macro-report-<run_id>.csv`; run ids are filename-safe by the API's id rule. */
export function reportCsvFilename(runId: string): string {
  return `macro-report-${runId}.csv`;
}
