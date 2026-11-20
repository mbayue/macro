import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunListItem, RunSnapshot } from '../src/api-types.ts';
import { buildReport } from '../src/report/build.ts';
import { compareRuns, DIFFERENT_PLAN_MESSAGE } from '../src/report/compare.ts';
import type { StageMetrics, TestPlan } from '../src/types.ts';
import { CompareView } from '../web/landing/src/app/components/compare/CompareView.tsx';
import {
  canComparePickedRuns,
  compareSelectionHint,
  filterRunsRows,
  formatCapacityCell,
  getPickedComparePair,
  KIND_FILTER_OPTIONS,
  mapAccountRunRow,
  mapBrowserRunRow,
  prunePickedRuns,
  rowHasReport,
  type RunsTableRow,
  STATUS_FILTER_OPTIONS,
  togglePickedRun,
} from '../web/landing/src/app/components/compare/runs-table-view.ts';

function makePlan(name = 'Checkout spike'): TestPlan {
  return {
    name,
    target: 'https://yue.macro.my.id',
    stages: [{ vus: 25, durationSec: 30 }],
    journey: [{ route: 'store_home', probability: 100, thinkMs: 500 }],
    stopThresholds: { p95Ms: 1200, errorRatePct: 2 },
  };
}

function makeMetrics(p95 = 300, errorRatePct = 0.2): StageMetrics {
  return {
    overall: { requests: 500, rps: 16.7, errorRatePct, http429: 0, p50: 120, p95, p99: 420 },
    routes: {
      store_home: { requests: 500, rps: 16.7, errorRatePct, http429: 0, p50: 120, p95, p99: 420 },
    },
  };
}

function makeSnapshot(overrides?: Partial<RunSnapshot>): RunSnapshot {
  const plan = makePlan();
  return {
    run: {
      id: 'run_snap_1',
      kind: 'run',
      planHash: 'hash_1',
      status: 'completed',
      statusReason: null,
      runtime: 'runc',
      startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
      endedAt: Date.UTC(2026, 4, 21, 14, 3, 37),
      visibility: 'public',
      probeResult: null,
    },
    plan,
    stages: [],
    decisions: [],
    events: [],
    report: buildReport({
      runId: 'run_snap_1',
      planHash: 'hash_1',
      status: 'completed',
      runtime: 'runc',
      plan,
      stages: [{ index: 0, vus: 25, durationSec: 30, status: 'done', metrics: makeMetrics(), verdict: 'pass' }],
      decisions: [],
      events: [],
    }),
    modelCalls: [],
    routes: [{ id: 'store_home', path: '/', method: 'GET', kind: 'page' }],
    ...overrides,
  };
}

describe('Runs Table mapping and capacity formatting', () => {
  test('mapAccountRunRow maps RunListItem fields, normalizes blank titles, and derives hasReport', () => {
    const item: RunListItem = {
      runId: 'run_acct_1',
      kind: 'run',
      startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
      status: 'halted',
      safeCapacity: 50,
      breakingPoint: 100,
      title: '  Flash sale  ',
    };
    const row = mapAccountRunRow(item);
    expect(row).toEqual({
      runId: 'run_acct_1',
      kind: 'run',
      title: 'Flash sale',
      startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
      startedUtc: '2026-05-21 14:03:07 UTC',
      status: 'halted',
      safeCapacity: 50,
      breakingPoint: 100,
      hasReport: true,
    });
    expect(rowHasReport(row)).toBe(true);

    const probeRow = mapAccountRunRow({
      runId: 'probe_1',
      kind: 'probe',
      startedAt: Date.UTC(2026, 4, 21, 15, 0, 0),
      status: 'completed',
      safeCapacity: null,
      breakingPoint: null,
      title: '',
    });
    expect(probeRow.title).toBe('Containment probe');
    expect(probeRow.hasReport).toBe(false);
    expect(rowHasReport(probeRow)).toBe(false);

    const failedRow = mapAccountRunRow({
      runId: 'run_fail_1',
      kind: 'run',
      startedAt: Date.UTC(2026, 4, 21, 15, 30, 0),
      status: 'failed',
      safeCapacity: null,
      breakingPoint: null,
      title: '',
    });
    expect(failedRow.title).toBe('Load test');
    expect(failedRow.hasReport).toBe(false);
    expect(rowHasReport(failedRow)).toBe(false);

    const completedNoNums = mapAccountRunRow({
      runId: 'run_comp_null',
      startedAt: Date.UTC(2026, 4, 21, 16, 0, 0),
      status: 'completed',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Zero metrics run',
    });
    expect(completedNoNums.kind).toBe('run');
    expect(completedNoNums.hasReport).toBe(true);
    expect(rowHasReport(completedNoNums)).toBe(true);
  });

  test('mapBrowserRunRow handles initial checking, hydrated snapshot with report, missing report, and unknown fallback', () => {
    const entry = {
      id: 'run_snap_1',
      kind: 'run' as const,
      name: 'Fallback name',
      startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
    };

    const checking = mapBrowserRunRow(entry);
    expect(checking.status).toBe('checking');
    expect(checking.hasReport).toBe(false);
    expect(checking.safeCapacity).toBeNull();
    expect(checking.breakingPoint).toBeNull();

    const hydrated = mapBrowserRunRow(entry, makeSnapshot());
    expect(hydrated.title).toBe('Checkout spike');
    expect(hydrated.status).toBe('completed');
    expect(hydrated.safeCapacity).toBe(25);
    expect(hydrated.breakingPoint).toBeNull();
    expect(hydrated.hasReport).toBe(true);

    const withoutReport = mapBrowserRunRow(entry, makeSnapshot({ report: null }));
    expect(withoutReport.hasReport).toBe(false);
    expect(rowHasReport(withoutReport)).toBe(false);

    const unknown = mapBrowserRunRow(entry, null, 'unknown');
    expect(unknown.status).toBe('unknown');
    expect(unknown.hasReport).toBe(false);
  });

  test('formatCapacityCell renders numeric values, shared report none/not reached wording, and en-dash without report', () => {
    expect(formatCapacityCell('safeCapacity', 50, true)).toBe('50');
    expect(formatCapacityCell('safeCapacity', null, true)).toBe('none');
    expect(formatCapacityCell('breakingPoint', 100, true)).toBe('100');
    expect(formatCapacityCell('breakingPoint', null, true)).toBe('not reached');
    expect(formatCapacityCell('safeCapacity', null, false)).toBe('\u2013');
    expect(formatCapacityCell('breakingPoint', null, false)).toBe('\u2013');
  });
});

function sampleRows(): RunsTableRow[] {
  return [
    mapAccountRunRow({
      runId: 'run_completed_1',
      kind: 'run',
      startedAt: 8000,
      status: 'completed',
      safeCapacity: 100,
      breakingPoint: null,
      title: 'Checkout spike',
    }),
    mapAccountRunRow({
      runId: 'run_halted_2',
      kind: 'run',
      startedAt: 7000,
      status: 'halted',
      safeCapacity: 50,
      breakingPoint: 100,
      title: 'Weekend sale',
    }),
    mapAccountRunRow({
      runId: 'run_stopped_3',
      kind: 'run',
      startedAt: 6000,
      status: 'stopped',
      safeCapacity: 25,
      breakingPoint: null,
      title: 'Campaign burst',
    }),
    mapAccountRunRow({
      runId: 'run_timeout_4',
      kind: 'run',
      startedAt: 5000,
      status: 'timed_out',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Long soak',
    }),
    mapAccountRunRow({
      runId: 'run_running_5',
      kind: 'run',
      startedAt: 4000,
      status: 'running',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Live canary',
    }),
    mapAccountRunRow({
      runId: 'run_queued_6',
      kind: 'run',
      startedAt: 3000,
      status: 'queued',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Queued follow-up',
    }),
    mapAccountRunRow({
      runId: 'run_failed_7',
      kind: 'run',
      startedAt: 2000,
      status: 'failed',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Broken target',
    }),
    mapAccountRunRow({
      runId: 'run_interrupted_8',
      kind: 'run',
      startedAt: 1500,
      status: 'interrupted',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Aborted worker',
    }),
    mapAccountRunRow({
      runId: 'probe_ok_9',
      kind: 'probe',
      startedAt: 1000,
      status: 'completed',
      safeCapacity: null,
      breakingPoint: null,
      title: 'Containment probe',
    }),
  ];
}

describe('Runs Table filtering and search', () => {
  test('STATUS_FILTER_OPTIONS and KIND_FILTER_OPTIONS expose expected labels and values', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      'All',
      'Completed',
      'Running',
      'Stopped / Halted',
      'Failed',
    ]);
    expect(KIND_FILTER_OPTIONS.map((o) => o.label)).toEqual(['All', 'Load tests', 'Probes']);
  });

  test('filterRunsRows filters by kind, status bucket, and case-insensitive title or runId query', () => {
    const rows = sampleRows();

    expect(filterRunsRows(rows, {})).toHaveLength(rows.length);
    expect(filterRunsRows(rows, { kind: 'probe' }).map((r) => r.runId)).toEqual(['probe_ok_9']);
    expect(filterRunsRows(rows, { kind: 'run' }).every((r) => r.kind === 'run')).toBe(true);

    expect(filterRunsRows(rows, { status: 'completed' }).map((r) => r.runId)).toEqual([
      'run_completed_1',
      'probe_ok_9',
    ]);
    expect(filterRunsRows(rows, { status: 'running' }).map((r) => r.runId)).toEqual([
      'run_running_5',
      'run_queued_6',
    ]);
    expect(filterRunsRows(rows, { status: 'stopped_halted' }).map((r) => r.runId)).toEqual([
      'run_halted_2',
      'run_stopped_3',
      'run_timeout_4',
    ]);
    expect(filterRunsRows(rows, { status: 'failed' }).map((r) => r.runId)).toEqual([
      'run_failed_7',
      'run_interrupted_8',
    ]);

    expect(filterRunsRows(rows, { query: '  CHECKOUT ' }).map((r) => r.runId)).toEqual(['run_completed_1']);
    expect(filterRunsRows(rows, { query: 'HALTED_2' }).map((r) => r.runId)).toEqual(['run_halted_2']);
    expect(filterRunsRows(rows, { kind: 'run', status: 'completed', query: 'probe' })).toEqual([]);
  });
});

describe('Runs Table selection and compare gating', () => {
  test('togglePickedRun enforces max 2 unique selections and clean removal', () => {
    let picked = togglePickedRun([], 'run_a', true);
    expect(picked).toEqual(['run_a']);

    picked = togglePickedRun(picked, 'run_a', true);
    expect(picked).toEqual(['run_a']);

    picked = togglePickedRun(picked, 'run_b', true);
    expect(picked).toEqual(['run_a', 'run_b']);

    // Third selection is ignored once 2 rows are already picked.
    picked = togglePickedRun(picked, 'run_c', true);
    expect(picked).toEqual(['run_a', 'run_b']);

    picked = togglePickedRun(picked, 'run_a', false);
    expect(picked).toEqual(['run_b']);

    picked = togglePickedRun(picked, 'run_c', true);
    expect(picked).toEqual(['run_b', 'run_c']);
  });

  test('canComparePickedRuns and getPickedComparePair require 2 rows that both have reports', () => {
    const rows = sampleRows();

    expect(canComparePickedRuns(rows, [])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1'])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1', 'run_completed_1'])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1', 'probe_ok_9'])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1', 'run_failed_7'])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1', 'run_running_5'])).toBe(false);
    expect(canComparePickedRuns(rows, ['run_completed_1', 'missing_run'])).toBe(false);

    expect(canComparePickedRuns(rows, ['run_completed_1', 'run_halted_2'])).toBe(true);
    expect(getPickedComparePair(rows, ['run_completed_1', 'run_halted_2'])).toEqual({
      a: 'run_completed_1',
      b: 'run_halted_2',
    });
    expect(getPickedComparePair(rows, ['run_completed_1', 'probe_ok_9'])).toBeNull();
  });

  test('compareSelectionHint explains why Compare is disabled and prunePickedRuns drops missing ids', () => {
    const rows = sampleRows();

    expect(compareSelectionHint(rows, [])).toContain('Select two load test runs');
    expect(compareSelectionHint(rows, ['run_completed_1'])).toContain('Select one more load test run');
    expect(compareSelectionHint(rows, ['probe_ok_9'])).toContain('no report');
    expect(compareSelectionHint(rows, ['run_completed_1', 'probe_ok_9'])).toContain('must be load tests with a capacity report');
    expect(compareSelectionHint(rows, ['run_completed_1', 'run_halted_2'])).toContain('Ready to compare');

    expect(prunePickedRuns(rows, ['run_completed_1', 'deleted_run'])).toEqual(['run_completed_1']);
  });
});

describe('CompareView component states', () => {
  test('renders loading state with accessible status text and no inline style attributes', () => {
    const html = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_a',
        b: 'run_b',
        loading: true,
        error: null,
        comparison: null,
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('run_a');
    expect(html).toContain('run_b');
    expect(html).not.toMatch(/\sstyle=/i);
  });

  test('renders ApiErrorText and retry button for API and unreadable errors', () => {
    const apiHtml = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_a',
        b: 'run_b',
        loading: false,
        error: { code: 'not_found', message: 'Not found.' },
        comparison: null,
        onRetry: () => {},
      }),
    );
    expect(apiHtml).toContain('Not found.');
    expect(apiHtml).toContain('Try again');
    expect(apiHtml).toContain('#/runs');

    const unreadableHtml = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_a',
        b: 'run_b',
        loading: false,
        error: 'unreadable',
        comparison: null,
        onRetry: () => {},
      }),
    );
    expect(unreadableHtml).toContain('comparison could not be read');
    expect(unreadableHtml).toContain('Try again');
  });

  test('renders Different plans warning notice with message and navigation links back to runs a, b, and #/runs', () => {
    const html = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_alpha',
        b: 'run_beta',
        loading: false,
        error: null,
        comparison: { kind: 'different_plan', message: DIFFERENT_PLAN_MESSAGE },
      }),
    );
    expect(html).toContain('Different plans');
    expect(html).toContain(DIFFERENT_PLAN_MESSAGE);
    expect(html).toContain('#/run/run_alpha');
    expect(html).toContain('#/run/run_beta');
    expect(html).toContain('#/runs');
    expect(html).not.toMatch(/\sstyle=/i);
  });

  test('renders baseline vs later telemetry cards, headline comparison, and per-stage rows with font-mono tabular-nums', () => {
    const plan = makePlan();
    const s1 = makeMetrics(280, 0.2);
    const s2 = makeMetrics(350, 0.5);
    const reportA = buildReport({
      runId: 'run_base',
      planHash: 'hash_shared',
      status: 'completed',
      runtime: 'runc',
      plan,
      stages: [{ index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s1, verdict: 'pass' }],
      decisions: [],
      events: [],
    });
    const reportB = buildReport({
      runId: 'run_later',
      planHash: 'hash_shared',
      status: 'completed',
      runtime: 'runc',
      plan,
      stages: [{ index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s2, verdict: 'pass' }],
      decisions: [],
      events: [],
    });
    const comparison = compareRuns(
      { runId: 'run_base', planHash: 'hash_shared', startedAt: Date.UTC(2026, 4, 21, 10, 0, 0), report: reportA },
      { runId: 'run_later', planHash: 'hash_shared', startedAt: Date.UTC(2026, 4, 21, 11, 0, 0), report: reportB },
    );
    const html = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_later',
        b: 'run_base',
        loading: false,
        error: null,
        comparison,
      }),
    );

    expect(html).toContain('Baseline (earlier run)');
    expect(html).toContain('Later run');
    expect(html).toContain('run_base');
    expect(html).toContain('run_later');
    expect(html).toContain('Safe capacity (VUs)');
    expect(html).toContain('Breaking point (VUs)');
    expect(html).toContain('First degraded route');
    expect(html).toContain('Stage 1');
    expect(html).toContain('Overall');
    expect(html).toContain('store_home');
    expect(html).toContain('p95 latency (ms)');
    expect(html).toContain('+70');
    expect(html).toContain('+25.0%');
    expect(html).toContain('font-mono');
    expect(html).toContain('tabular-nums');
    expect(html).not.toMatch(/\sstyle=/i);
  });

  test('renders one-sided not-run stages, zero-baseline n/a cells, and empty-stages fallback cleanly', () => {
    const plan = makePlan();
    const zeroErrMetrics = makeMetrics(150, 0);
    const partialA = buildReport({
      runId: 'run_one',
      planHash: 'hash_shared',
      status: 'halted',
      runtime: 'runc',
      plan,
      stages: [{ index: 0, vus: 25, durationSec: 30, status: 'done', metrics: zeroErrMetrics, verdict: 'pass' }],
      decisions: [],
      events: [],
    });
    const partialB = buildReport({
      runId: 'run_two',
      planHash: 'hash_shared',
      status: 'completed',
      runtime: 'runc',
      plan,
      stages: [
        { index: 0, vus: 25, durationSec: 30, status: 'done', metrics: makeMetrics(200, 1.5), verdict: 'pass' },
        { index: 1, vus: 50, durationSec: 30, status: 'done', metrics: makeMetrics(310, 0.5), verdict: 'pass' },
      ],
      decisions: [],
      events: [],
    });
    const comparison = compareRuns(
      { runId: 'run_one', planHash: 'hash_shared', startedAt: 1000, report: partialA },
      { runId: 'run_two', planHash: 'hash_shared', startedAt: 2000, report: partialB },
    );

    const html = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_one',
        b: 'run_two',
        loading: false,
        error: null,
        comparison,
      }),
    );
    expect(html).toContain('Stage 1');
    expect(html).toContain('Stage 2');
    expect(html).toContain('not run');
    expect(html).toContain('n/a');
    expect(html).not.toMatch(/\sstyle=/i);

    const emptyReportA = buildReport({
      runId: 'run_empty_1',
      planHash: 'hash_empty',
      status: 'stopped',
      runtime: 'runc',
      plan,
      stages: [],
      decisions: [],
      events: [],
    });
    const emptyReportB = buildReport({
      runId: 'run_empty_2',
      planHash: 'hash_empty',
      status: 'stopped',
      runtime: 'runc',
      plan,
      stages: [],
      decisions: [],
      events: [],
    });
    const emptyComparison = compareRuns(
      { runId: 'run_empty_1', planHash: 'hash_empty', startedAt: 1000, report: emptyReportA },
      { runId: 'run_empty_2', planHash: 'hash_empty', startedAt: 2000, report: emptyReportB },
    );
    const emptyHtml = renderToStaticMarkup(
      createElement(CompareView, {
        a: 'run_empty_1',
        b: 'run_empty_2',
        loading: false,
        error: null,
        comparison: emptyComparison,
      }),
    );
    expect(emptyHtml).toContain('Neither run has stage metrics to compare.');
  });
});
