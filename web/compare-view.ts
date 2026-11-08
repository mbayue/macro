/**
 * Side-by-side Run comparison (task 11.4, requirements 13.3, 13.4, 13.5).
 *
 *   renderCompareView(root, comparison)    fills `root`
 *   parseComparison(payload)               validates GET /api/compare output
 *
 * The comparison is computed on the server (src/report/compare.ts). This view
 * only shows it, exactly as the fields say:
 *   - `different_plan`: the message and no values.
 *   - `ok`: the earlier Run is the baseline; a `ValueComparison` with
 *     `difference`/`percentChange` of `null` shows nothing in those cells;
 *     `"n/a"` and `"not run"` are shown as given.
 * Every string reaches the page as a text node.
 */
import {
  type Comparison,
  type HeadlineValue,
  type MetricsComparison,
  type RouteComparison,
  type RunSummary,
  type StageComparison,
  type ValueComparison,
  NOT_RUN,
} from '../src/report/compare.ts';
import type { RouteId } from '../src/types.ts';
import { el, fmtUtc, scrollRegion } from './dom.ts';

// ----------------------------------------------------------- parsing ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseValue(v: unknown): ValueComparison | null {
  if (!isRecord(v)) return null;
  const { baseline, later, difference, percentChange } = v;
  if (typeof baseline !== 'string' || typeof later !== 'string') return null;
  if (difference !== null && typeof difference !== 'string') return null;
  if (percentChange !== null && typeof percentChange !== 'string') return null;
  return { baseline, later, difference, percentChange };
}

function parseMetrics(v: unknown): MetricsComparison | null {
  if (!isRecord(v)) return null;
  const p95Ms = parseValue(v['p95Ms']);
  const errorRatePct = parseValue(v['errorRatePct']);
  const rps = parseValue(v['rps']);
  if (!p95Ms || !errorRatePct || !rps) return null;
  return { p95Ms, errorRatePct, rps };
}

function parseSummary(v: unknown): RunSummary | null {
  if (!isRecord(v)) return null;
  const nullableNumber = (x: unknown): x is number | null => x === null || typeof x === 'number';
  const nullableString = (x: unknown): x is string | null => x === null || typeof x === 'string';
  if (
    typeof v['runId'] !== 'string' ||
    typeof v['startedAt'] !== 'number' ||
    !nullableNumber(v['safeCapacity']) ||
    !nullableNumber(v['breakingPoint']) ||
    !nullableString(v['firstDegradedRoute']) ||
    typeof v['safeCapacityDisplay'] !== 'string' ||
    typeof v['breakingPointDisplay'] !== 'string' ||
    typeof v['firstDegradedRouteDisplay'] !== 'string'
  ) {
    return null;
  }
  return {
    runId: v['runId'],
    startedAt: v['startedAt'],
    safeCapacity: v['safeCapacity'],
    breakingPoint: v['breakingPoint'],
    firstDegradedRoute: v['firstDegradedRoute'] as RouteId | null,
    safeCapacityDisplay: v['safeCapacityDisplay'],
    breakingPointDisplay: v['breakingPointDisplay'],
    firstDegradedRouteDisplay: v['firstDegradedRouteDisplay'],
  };
}

function parseHeadlineValue(v: unknown): HeadlineValue | null {
  if (!isRecord(v) || typeof v['baseline'] !== 'string' || typeof v['later'] !== 'string') return null;
  return { baseline: v['baseline'], later: v['later'] };
}

function parseStage(v: unknown): StageComparison | null {
  if (!isRecord(v) || typeof v['index'] !== 'number' || typeof v['displayIndex'] !== 'number') return null;
  if (typeof v['vus'] !== 'number' || !Array.isArray(v['routes'])) return null;
  const overall = parseMetrics(v['overall']);
  if (!overall) return null;
  const routes: RouteComparison[] = [];
  for (const r of v['routes']) {
    const m = parseMetrics(r);
    if (!m || !isRecord(r) || typeof r['route'] !== 'string') return null;
    routes.push({ route: r['route'] as RouteId, ...m });
  }
  return { index: v['index'], displayIndex: v['displayIndex'], vus: v['vus'], overall, routes };
}

/**
 * Accepts the API payload `{ result: Comparison }` (a bare Comparison is also
 * accepted). Returns `null` when the shape is wrong, so the caller can show a
 * generic error instead of rendering half a table.
 */
export function parseComparison(payload: unknown): Comparison | null {
  const c = isRecord(payload) && 'result' in payload ? payload['result'] : payload;
  if (!isRecord(c)) return null;
  if (c['kind'] === 'different_plan') {
    return typeof c['message'] === 'string' ? { kind: 'different_plan', message: c['message'] } : null;
  }
  if (c['kind'] !== 'ok') return null;
  const baseline = parseSummary(c['baseline']);
  const later = parseSummary(c['later']);
  const h = c['headline'];
  if (!baseline || !later || !isRecord(h) || !Array.isArray(c['stages'])) return null;
  const safeCapacity = parseHeadlineValue(h['safeCapacity']);
  const breakingPoint = parseHeadlineValue(h['breakingPoint']);
  const firstDegradedRoute = parseHeadlineValue(h['firstDegradedRoute']);
  if (!safeCapacity || !breakingPoint || !firstDegradedRoute) return null;
  const stages: StageComparison[] = [];
  for (const s of c['stages']) {
    const parsed = parseStage(s);
    if (!parsed) return null;
    stages.push(parsed);
  }
  return { kind: 'ok', baseline, later, headline: { safeCapacity, breakingPoint, firstDegradedRoute }, stages };
}

// -------------------------------------------------------- view model ----

export interface CompareRow {
  /** `Overall` or a route id. */
  scope: string;
  metric: string;
  value: ValueComparison;
}

export const METRIC_LABELS = {
  p95Ms: 'p95 latency (ms)',
  errorRatePct: 'Error rate',
  rps: 'Requests per second',
} as const;

/** Rows of one Stage table: Overall first, then each route, three metrics each. */
export function stageCompareRows(stage: StageComparison): CompareRow[] {
  const rows: CompareRow[] = [];
  const add = (scope: string, m: MetricsComparison): void => {
    rows.push({ scope, metric: METRIC_LABELS.p95Ms, value: m.p95Ms });
    rows.push({ scope, metric: METRIC_LABELS.errorRatePct, value: m.errorRatePct });
    rows.push({ scope, metric: METRIC_LABELS.rps, value: m.rps });
  };
  add('Overall', stage.overall);
  for (const r of stage.routes) add(r.route, r);
  return rows;
}

export interface HeadlineCompareRow {
  label: string;
  baseline: string;
  later: string;
}

export function headlineCompareRows(c: Extract<Comparison, { kind: 'ok' }>): HeadlineCompareRow[] {
  return [
    { label: 'Safe capacity (VUs)', ...c.headline.safeCapacity },
    { label: 'Breaking point (VUs)', ...c.headline.breakingPoint },
    { label: 'First degraded route', ...c.headline.firstDegradedRoute },
  ];
}

// -------------------------------------------------------------- render ----

function runHeading(role: 'Baseline' | 'Later', run: RunSummary): HTMLElement {
  return el(
    'div',
    { class: 'compare__run stack stack--tight' },
    el('h4', null, role === 'Baseline' ? 'Baseline (earlier Run)' : 'Later Run'),
    el('p', { class: 'mono' }, run.runId),
    el('p', { class: 'muted' }, `Started ${fmtUtc(run.startedAt)}`),
  );
}

function valueCell(text: string): HTMLElement {
  return el('td', { class: text === NOT_RUN ? 'num mono compare__notrun' : 'num mono' }, text);
}

function stageTable(stage: StageComparison): HTMLElement {
  return scrollRegion(
    `Stage ${stage.displayIndex} comparison`,
    el(
      'table',
      { class: 'table table--compare' },
      el('caption', null, `Stage ${stage.displayIndex} (${stage.vus} VUs)`),
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          el('th', { scope: 'col' }, 'Scope'),
          el('th', { scope: 'col' }, 'Metric'),
          el('th', { scope: 'col', class: 'num' }, 'Baseline'),
          el('th', { scope: 'col', class: 'num' }, 'Later'),
          el('th', { scope: 'col', class: 'num' }, 'Difference'),
          el('th', { scope: 'col', class: 'num' }, 'Change'),
        ),
      ),
      el(
        'tbody',
        null,
        stageCompareRows(stage).map((row) =>
          el(
            'tr',
            null,
            el('th', { scope: 'row', class: 'mono' }, row.scope),
            el('td', null, row.metric),
            valueCell(row.value.baseline),
            valueCell(row.value.later),
            // null = no difference shown for a row that exists in one Run only.
            el('td', { class: 'num mono' }, row.value.difference),
            el('td', { class: 'num mono' }, row.value.percentChange),
          ),
        ),
      ),
    ),
  );
}

/** Fill `root` with the comparison. `root` should be empty. */
export function renderCompareView(root: HTMLElement, comparison: Comparison): void {
  if (comparison.kind === 'different_plan') {
    // 13.4: the message only. No Run values are drawn.
    root.append(
      el(
        'div',
        { class: 'panel panel--warn stack stack--tight', role: 'status' },
        el('h3', null, 'These Runs cannot be compared'),
        el('p', null, comparison.message),
      ),
    );
    return;
  }

  const rows = headlineCompareRows(comparison);
  root.append(
    el(
      'div',
      { class: 'stack' },
      el('h3', null, 'Comparison'),
      el('div', { class: 'compare__runs' }, runHeading('Baseline', comparison.baseline), runHeading('Later', comparison.later)),
      scrollRegion(
        'Headline comparison',
        el(
          'table',
          { class: 'table table--compare' },
          el('caption', null, 'Headline values'),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col' }, 'Value'),
              el('th', { scope: 'col' }, 'Baseline'),
              el('th', { scope: 'col' }, 'Later'),
            ),
          ),
          el(
            'tbody',
            null,
            rows.map((r) =>
              el('tr', null, el('th', { scope: 'row' }, r.label), el('td', { class: 'mono' }, r.baseline), el('td', { class: 'mono' }, r.later)),
            ),
          ),
        ),
      ),
      comparison.stages.length === 0
        ? el('p', { class: 'muted' }, 'Neither Run has Stage metrics to compare.')
        : el('div', { class: 'stack' }, comparison.stages.map(stageTable)),
    ),
  );
}
