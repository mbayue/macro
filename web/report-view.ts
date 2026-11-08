/**
 * Capacity_Report view (tasks 8.3, 10.12, 11.4, 11.5).
 *
 *   renderReportView(root, ctx, report, helpers?) -> cleanup
 *
 * The Run view calls this once `RunSnapshot.report` is set. This view only
 * renders what the report holds; the one thing it fetches is the Run list for
 * the report's Plan_Hash, and a comparison when the user asks for one.
 *
 * Structure, top to bottom:
 *   1. header              plan name, target, Run ID, Plan_Hash
 *   2. Headline values     computed from stored metrics only (10.6)
 *   3. fixed sentences     10.3, 10.4, 10.11, 10.12 states
 *   4. chart + Stage table + per-route tables
 *   5. decisions, Containment_Events
 *   6. "AI-generated"      a separate section; AI text appears nowhere else
 *   7. model calls
 *   8. re-run, Run list, compare picker
 *
 * Every API string is set as a text node (see dom.ts).
 */
import type { ModelCallView, RunListItem } from '../src/api-types.ts';
import type {
  AiSection,
  CapacityReport,
  ReportDecision,
  ReportEvent,
  RouteRowView,
  StageView,
} from '../src/report/build.ts';
import {
  displayBreakingPoint,
  displayFirstDegradedRoute,
  displaySafeCapacity,
} from '../src/report/compare.ts';
import { fmtMs } from '../src/run/format.ts';
import type { ContainmentType, RunStatus } from '../src/types.ts';
import { type ApiError, VERIFICATION_ERROR, getCompare, getRunsForPlan, postRun } from './api.ts';
import { renderStageChart } from './chart.ts';
import { parseComparison, renderCompareView } from './compare-view.ts';
import type { AppContext, ReportViewHelpers, ViewCleanup } from './context.ts';
import { clear, el, fmtUtc, renderApiError, scrollRegion } from './dom.ts';
import { disposeWidget, getToken, resetWidget } from './turnstile.ts';

// ------------------------------------------------------ fixed wording ----

export const AI_WITHHELD_NOTE = 'AI explanation withheld: unverified number';
export const AI_UNAVAILABLE_NOTE = 'AI explanation unavailable';
export const AI_PENDING_NOTE = 'AI explanation pending';
export const AI_NO_METRICS_NOTE = 'No AI explanation was requested because no Stage produced metrics.';
export const MAX_LISTED_RUNS = 20;

// ----------------------------------------------------- pure view model ----

/** Re-run is offered only for Runs that ended in one of these states (13.1). */
export function canRerun(status: RunStatus): boolean {
  return status === 'completed' || status === 'halted' || status === 'stopped' || status === 'timed_out';
}

export type BadgeKind = 'ok' | 'warn' | 'bad' | 'neutral';

export function statusBadgeKind(status: RunStatus): BadgeKind {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'halted':
    case 'stopped':
    case 'timed_out':
      return 'warn';
    case 'failed':
    case 'interrupted':
      return 'bad';
    default:
      return 'neutral';
  }
}

export interface HeadlineItem {
  label: string;
  value: string;
  /** Set for the Run status, which is drawn as a badge. */
  badge?: BadgeKind;
}

/** Headline values with the shared wording for null values (13.2, 10.11). */
export function headlineItems(report: CapacityReport): HeadlineItem[] {
  const h = report.headline;
  return [
    { label: 'Safe capacity (VUs)', value: displaySafeCapacity(h.safeCapacity) },
    { label: 'Breaking point (VUs)', value: displayBreakingPoint(h.breakingPoint) },
    { label: 'First degraded route', value: displayFirstDegradedRoute(h.firstDegradedRoute) },
    { label: 'Run status', value: h.status, badge: statusBadgeKind(h.status) },
    { label: 'Sandbox runtime', value: report.runtime },
  ];
}

/** The fixed sentences the report carries for the 10.3, 10.4, 10.11, 10.12 states. */
export function reportNotices(report: CapacityReport): string[] {
  const out: string[] = [];
  if (report.noStageMetrics) out.push(report.noStageMetrics.text);
  if (report.noSafeCapacity) out.push(report.noSafeCapacity.text);
  if (report.breakingPointNotReached) out.push(report.breakingPointNotReached.text);
  if (report.noRouteExceeded) out.push(report.noRouteExceeded.text);
  return out;
}

const EVENT_LABELS: Record<ContainmentType, string> = {
  sandbox_created: 'Sandbox created',
  egress_blocked: 'Egress blocked',
  memory_cap_hit: 'Memory cap hit',
  time_cap_hit: 'Time cap hit',
  sandbox_killed: 'Sandbox killed',
  sandbox_removed: 'Sandbox removed',
  runner_created: 'Runner created',
  runner_deleted: 'Runner deleted',
};

/** Types shown with the warning highlight (amber) in the timeline. */
export function isWarningEvent(type: ContainmentType): boolean {
  return type === 'egress_blocked' || type === 'memory_cap_hit' || type === 'time_cap_hit';
}

/** Plain wording for one Containment_Event, e.g. `Egress blocked: example.com:443`. */
export function eventText(ev: ReportEvent): string {
  const base = EVENT_LABELS[ev.type] ?? String(ev.type);
  const target = ev.host !== undefined ? (ev.port !== undefined ? `${ev.host}:${ev.port}` : ev.host) : null;
  return target === null ? base : `${base}: ${target}`;
}

/** `2026-05-21 14:03:07 UTC` for epoch ms or a date string; other text is shown as given. */
export function eventTime(ts: number | string): string {
  if (typeof ts === 'number') return fmtUtc(ts);
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : fmtUtc(ms);
}

/** Where an event happened: `Stage 2` (1-based) or `Run` for Run-level events. */
export function eventScope(ev: ReportEvent): string {
  return ev.stageIdx === null ? 'Run' : `Stage ${ev.stageIdx + 1}`;
}

export interface AiModel {
  /** `ai` is undefined: the report event has not carried the AI part yet. */
  pending: boolean;
  /** Fixed notes, in order, without duplicates. */
  notes: string[];
  explanation: string | null;
  suggestions: string[];
}

/**
 * What the AI-generated section shows (10.8-10.10). `report.ai` is the only
 * source of text. A missing note is filled in for the `withheld` and
 * `unavailable` states so the label is always on screen.
 */
export function aiModel(report: Pick<CapacityReport, 'ai' | 'noStageMetrics'>): AiModel {
  const ai: AiSection | undefined = report.ai;
  if (ai === undefined) {
    return {
      pending: report.noStageMetrics === null,
      notes: report.noStageMetrics === null ? [AI_PENDING_NOTE] : [AI_NO_METRICS_NOTE],
      explanation: null,
      suggestions: [],
    };
  }
  const notes: string[] = [];
  const add = (n: string): void => {
    if (!notes.includes(n)) notes.push(n);
  };
  if (ai.status === 'withheld') add(AI_WITHHELD_NOTE);
  if (ai.status === 'unavailable') add(AI_UNAVAILABLE_NOTE);
  for (const n of ai.notes ?? []) add(n);
  return {
    pending: false,
    notes,
    explanation: ai.explanation !== undefined && ai.explanation !== '' ? ai.explanation : null,
    suggestions: ai.suggestions ?? [],
  };
}

export interface ModelCallRow {
  n: number;
  agent: string;
  model: string;
  outcome: ModelCallView['outcome'];
  latency: string;
  tokens: string;
}

export function tokensText(c: Pick<ModelCallView, 'promptTokens' | 'completionTokens'>): string {
  if (c.promptTokens === null && c.completionTokens === null) return 'not reported';
  const part = (n: number | null): string => (n === null ? 'not reported' : String(n));
  return `prompt ${part(c.promptTokens)}, completion ${part(c.completionTokens)}`;
}

/** Model-call rows in the order given (request order). */
export function modelCallRows(calls: readonly ModelCallView[]): ModelCallRow[] {
  return calls.map((c, i) => ({
    n: i + 1,
    agent: c.agent,
    model: c.model,
    outcome: c.outcome,
    latency: fmtMs(c.latencyMs),
    tokens: tokensText(c),
  }));
}

export interface RunListRow {
  runId: string;
  started: string;
  status: RunStatus;
  safeCapacity: string;
  breakingPoint: string;
}

/** At most 20 Runs, newest first (13.2); Safe_Capacity `none`, Breaking_Point `not reached`. */
export function runListRows(runs: readonly RunListItem[]): RunListRow[] {
  return [...runs]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_LISTED_RUNS)
    .map((r) => ({
      runId: r.runId,
      started: fmtUtc(r.startedAt),
      status: r.status,
      safeCapacity: displaySafeCapacity(r.safeCapacity),
      breakingPoint: displayBreakingPoint(r.breakingPoint),
    }));
}

// ---------------------------------------------------------- DOM pieces ----

function badge(kind: BadgeKind, text: string): HTMLElement {
  return el('span', { class: kind === 'neutral' ? 'badge' : `badge badge--${kind}` }, text);
}

function th(text: string, num = false): HTMLElement {
  return el('th', { scope: 'col', class: num ? 'num' : null }, text);
}

function metricCells(m: { display: { requests: string; rps: string; errorRatePct: string; http429: string; p50: string; p95: string; p99: string } }): HTMLElement[] {
  const d = m.display;
  return [d.requests, d.rps, d.errorRatePct, d.http429, d.p50, d.p95, d.p99].map((v) =>
    el('td', { class: 'num mono' }, v),
  );
}

function verdictBadge(stage: StageView): HTMLElement {
  if (stage.status === 'error') return badge('bad', 'error');
  if (stage.verdict === 'pass') return badge('ok', 'pass');
  if (stage.verdict === 'fail') return badge('bad', 'fail');
  return badge('neutral', 'no metrics');
}

function stageTable(report: CapacityReport): HTMLElement {
  return scrollRegion(
    'Stages',
    el(
      'table',
      { class: 'table' },
      el('caption', null, 'Stages'),
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          th('Stage'),
          th('VUs', true),
          th('Duration (s)', true),
          th('Verdict'),
          th('Requests', true),
          th('Requests/s', true),
          th('Error rate', true),
          th('HTTP 429', true),
          th('p50 (ms)', true),
          th('p95 (ms)', true),
          th('p99 (ms)', true),
        ),
      ),
      el(
        'tbody',
        null,
        report.stages.map((s) =>
          el(
            'tr',
            null,
            el('th', { scope: 'row', class: 'mono' }, s.displayIndex),
            el('td', { class: 'num mono' }, s.vus),
            el('td', { class: 'num mono' }, s.durationSec),
            el('td', null, verdictBadge(s)),
            s.overall !== null
              ? metricCells(s.overall)
              : el(
                  'td',
                  { colspan: 7, class: 'muted' },
                  s.status === 'error'
                    ? `Stage failed${s.errorReason !== null ? `: ${s.errorReason}` : '.'}`
                    : 'This Stage has no metrics.',
                ),
          ),
        ),
      ),
    ),
  );
}

function routeTable(stage: StageView): HTMLElement {
  const rows = stage.routes.map((r: RouteRowView) =>
    el(
      'tr',
      { class: r.exceedsThresholds ? 'is-exceeded' : null },
      el('th', { scope: 'row', class: 'mono' }, r.route),
      metricCells(r),
      el('td', null, r.exceedsThresholds ? badge('warn', 'Exceeded thresholds') : el('span', { class: 'muted' }, 'Within')),
    ),
  );
  return scrollRegion(
    `Stage ${stage.displayIndex} routes`,
    el(
      'table',
      { class: 'table' },
      el('caption', null, `Stage ${stage.displayIndex} routes (${stage.vus} VUs)`),
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          th('Route'),
          th('Requests', true),
          th('Requests/s', true),
          th('Error rate', true),
          th('HTTP 429', true),
          th('p50 (ms)', true),
          th('p95 (ms)', true),
          th('p99 (ms)', true),
          th('Thresholds'),
        ),
      ),
      el('tbody', null, rows),
    ),
  );
}

function decisionsSection(decisions: readonly ReportDecision[]): HTMLElement {
  return el(
    'section',
    { class: 'panel stack stack--tight' },
    el('h3', null, 'Decisions'),
    decisions.length === 0
      ? el('p', { class: 'muted' }, 'No decisions were made.')
      : scrollRegion(
          'Decisions',
          el(
            'table',
            { class: 'table' },
            el('caption', null, 'Decision after each Stage'),
            el('thead', null, el('tr', null, th('After Stage'), th('Decision'), th('Source'), th('Reason'))),
            el(
              'tbody',
              null,
              decisions.map((d) =>
                el(
                  'tr',
                  null,
                  el('th', { scope: 'row', class: 'mono' }, d.stageIdx + 1),
                  el('td', null, badge(d.decision === 'stop' ? 'warn' : 'ok', d.decision)),
                  el('td', { class: 'mono' }, d.source),
                  el(
                    'td',
                    { class: 'prose' },
                    d.reason,
                    d.reasonWithheld ? el('span', { class: 'muted report__withheld' }, AI_WITHHELD_NOTE) : null,
                  ),
                ),
              ),
            ),
          ),
        ),
  );
}

function eventsSection(events: readonly ReportEvent[]): HTMLElement {
  return el(
    'section',
    { class: 'panel stack stack--tight' },
    el('h3', null, 'Containment events'),
    events.length === 0
      ? el('p', { class: 'muted' }, 'No containment events were recorded.')
      : el(
          'ol',
          { class: 'timeline' },
          events.map((ev) => {
            const warn = isWarningEvent(ev.type);
            return el(
              'li',
              { class: warn ? 'timeline__item timeline__item--warn' : 'timeline__item' },
              el('span', { class: 'timeline__time' }, eventTime(ev.ts)),
              warn ? el('span', { 'aria-hidden': 'true', class: 'timeline__icon' }, '\u26A0 ') : null,
              warn ? el('span', { class: 'visually-hidden' }, 'Warning: ') : null,
              el('span', null, eventText(ev)),
              el('span', { class: 'muted' }, ` (${eventScope(ev)})`),
            );
          }),
        ),
  );
}

function aiSection(report: CapacityReport): HTMLElement {
  const m = aiModel(report);
  return el(
    'section',
    { class: 'panel report-ai stack', 'aria-labelledby': 'report-ai-heading' },
    el('h3', { id: 'report-ai-heading' }, 'AI-generated'),
    el(
      'p',
      { class: 'muted' },
      'Written by an AI model. The headline values and tables on this page come from the stored metrics, not from the AI.',
    ),
    m.notes.length > 0
      ? el(
          'ul',
          { class: 'report-ai__notes', role: m.pending ? null : 'status' },
          m.notes.map((n) => el('li', { class: 'muted' }, n)),
        )
      : null,
    m.explanation !== null
      ? el('div', { class: 'stack stack--tight' }, el('h4', null, 'Explanation'), el('p', { class: 'prose' }, m.explanation))
      : null,
    m.suggestions.length > 0
      ? el(
          'div',
          { class: 'stack stack--tight' },
          el('h4', null, 'Suggestions'),
          el('ol', { class: 'report-ai__list' }, m.suggestions.map((s) => el('li', { class: 'prose' }, s))),
        )
      : null,
  );
}

function modelCallsSection(calls: readonly ModelCallView[]): HTMLElement {
  const rows = modelCallRows(calls);
  return el(
    'section',
    { class: 'panel stack stack--tight' },
    el('h3', null, 'Model calls'),
    rows.length === 0
      ? el('p', { class: 'muted' }, 'No model calls were recorded.')
      : scrollRegion(
          'Model calls',
          el(
            'table',
            { class: 'table' },
            el('caption', null, 'Model calls in request order'),
            el(
              'thead',
              null,
              el(
                'tr',
                null,
                th('#', true),
                th('Agent'),
                th('Model'),
                th('Outcome'),
                th('Latency (ms)', true),
                th('Tokens'),
              ),
            ),
            el(
              'tbody',
              null,
              rows.map((r) =>
                el(
                  'tr',
                  null,
                  el('th', { scope: 'row', class: 'num mono' }, r.n),
                  el('td', { class: 'mono' }, r.agent),
                  el('td', { class: 'mono' }, r.model),
                  el('td', null, badge(r.outcome === 'success' ? 'ok' : r.outcome === 'timeout' ? 'warn' : 'bad', r.outcome)),
                  el('td', { class: 'num mono' }, r.latency),
                  el('td', { class: 'mono' }, r.tokens),
                ),
              ),
            ),
          ),
        ),
  );
}

function chartSection(report: CapacityReport): HTMLElement | null {
  const chart = renderStageChart(report);
  if (chart === null) return null;
  return el(
    'section',
    { class: 'panel stack stack--tight' },
    el('h3', null, 'p95 latency and error rate per Stage'),
    scrollRegion('Chart of p95 latency and error rate per Stage', chart),
    el(
      'ul',
      { class: 'chart-legend' },
      el('li', null, el('span', { class: 'chart-legend__swatch chart-legend__swatch--line', 'aria-hidden': 'true' }), `p95 latency (left axis), limit ${report.thresholds.p95Ms} ms (dashed line)`),
      el('li', null, el('span', { class: 'chart-legend__swatch chart-legend__swatch--bar', 'aria-hidden': 'true' }), `Error rate (right axis), limit ${report.thresholds.errorRatePct}% (dotted line)`),
    ),
    el('p', { class: 'muted' }, 'The Stage table below holds the same numbers. Stages without metrics are not drawn.'),
  );
}

// ------------------------------------------------------------- render ----

export function renderReportView(
  root: HTMLElement,
  ctx: AppContext,
  report: CapacityReport,
  helpers?: ReportViewHelpers,
): ViewCleanup {
  let disposed = false;
  const aborter = new AbortController();

  // State is declared before the first use (buildRunsPanel runs during setup).
  let runListHost: HTMLElement;
  let compareHost: HTMLElement;
  let compareBtn: HTMLButtonElement;
  let checkboxes: HTMLInputElement[] = [];
  let comparing = false;
  let compareSeq = 0;
  let rerunBusy = false;
  let rerunBtn: HTMLButtonElement | null = null;
  let rerunProgress: HTMLElement | null = null;

  // ---- Header and headline ------------------------------------------------
  const header = el(
    'header',
    { class: 'stack stack--tight' },
    el('h2', { id: 'report-heading' }, 'Capacity report'),
    el('p', { class: 'plan-name' }, report.planName),
    el(
      'dl',
      { class: 'kv' },
      el('dt', null, 'Target'),
      el('dd', { class: 'mono' }, report.target),
      el('dt', null, 'Run ID'),
      el('dd', { class: 'mono' }, report.runId),
      el('dt', null, 'Plan hash'),
      el('dd', { class: 'mono' }, report.planHash),
      el('dt', null, 'Stop thresholds'),
      el('dd', { class: 'mono' }, `p95 ${report.thresholds.p95Ms} ms, error rate ${report.thresholds.errorRatePct}%`),
    ),
  );

  const headline = el(
    'section',
    { class: 'panel stack', 'aria-labelledby': 'report-headline-heading' },
    el('h3', { id: 'report-headline-heading' }, 'Headline values'),
    el(
      'dl',
      { class: 'headline' },
      headlineItems(report).map((item) =>
        el(
          'div',
          { class: 'headline__item' },
          el('dt', { class: 'headline__label' }, item.label),
          el('dd', { class: 'headline__value mono' }, item.badge !== undefined ? badge(item.badge, item.value) : item.value),
        ),
      ),
    ),
    reportNotices(report).length > 0
      ? el('ul', { class: 'report__notices' }, reportNotices(report).map((n) => el('li', null, n)))
      : null,
  );

  // ---- Tables -------------------------------------------------------------
  const routeTables = report.stages.filter((s) => s.routes.length > 0);

  // ---- Re-run, Run list, compare -----------------------------------------
  const runsPanel = buildRunsPanel();

  root.append(
    el(
      'article',
      { class: 'report stack stack--loose', 'aria-labelledby': 'report-heading' },
      header,
      headline,
      chartSection(report),
      el(
        'section',
        { class: 'panel stack' },
        el('h3', null, 'Stages'),
        stageTable(report),
        routeTables.length > 0
          ? el('div', { class: 'stack' }, el('h3', null, 'Routes per Stage'), routeTables.map(routeTable))
          : null,
      ),
      decisionsSection(report.decisions),
      eventsSection(report.events),
      aiSection(report),
      helpers?.modelCalls !== undefined ? modelCallsSection(helpers.modelCalls) : null,
      runsPanel,
    ),
  );

  void loadRuns();

  // ---- Runs panel ----------------------------------------------------------
  function buildRunsPanel(): HTMLElement {
    runListHost = el('div', { class: 'stack stack--tight' }, el('p', { class: 'muted', role: 'status' }, 'Loading runs.'));
    compareHost = el('div', { class: 'stack', 'aria-live': 'polite' });
    compareBtn = el(
      'button',
      {
        type: 'button',
        class: 'btn',
        disabled: true,
        onclick: () => void compareSelected(),
      },
      'Compare selected runs',
    );

    return el(
      'section',
      { class: 'panel stack', 'aria-labelledby': 'report-runs-heading' },
      el('h3', { id: 'report-runs-heading' }, 'Run again and compare'),
      canRerun(report.headline.status) ? rerunBlock() : null,
      el('h4', null, 'Runs of this plan'),
      runListHost,
      el('div', { class: 'row' }, compareBtn, el('span', { class: 'muted' }, 'Select two runs to compare them side by side.')),
      compareHost,
    );
  }

  function rerunBlock(): HTMLElement {
    const alert = el('div', { class: 'alert', role: 'alert' });
    const box = el('div', { class: 'turnstile' });
    const btn = el(
      'button',
      { type: 'button', class: 'btn btn--primary', onclick: () => void rerun(alert, box) },
      'Run this plan again',
    );
    const progress = el(
      'span',
      { class: 'progress', role: 'status', hidden: true },
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('span', null, 'Starting the run.'),
    );
    rerunBtn = btn;
    rerunProgress = progress;
    return el(
      'div',
      { class: 'stack stack--tight' },
      el('p', null, 'Start a new run of this same approved plan. The plan is not changed.'),
      box,
      el('div', { class: 'row' }, btn, progress),
      alert,
    );
  }

  function setRerunBusy(busy: boolean): void {
    rerunBusy = busy;
    if (rerunBtn) rerunBtn.disabled = busy;
    if (rerunProgress) rerunProgress.hidden = !busy;
  }

  async function rerun(alert: HTMLElement, box: HTMLElement): Promise<void> {
    if (rerunBusy || disposed) return;
    clear(alert);
    // One confirmation. Cancel sends nothing, not even a Turnstile request.
    const ok = window.confirm(
      `Run "${report.planName}" again against ${report.target}? This starts a new run of the same approved plan.`,
    );
    if (!ok) return;

    setRerunBusy(true);
    ctx.announce('Starting the run.');
    let result: Awaited<ReturnType<typeof postRun>>;
    try {
      const token = await getToken(ctx.config.turnstileSiteKey, box);
      result = await postRun({ planHash: report.planHash, turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      resetWidget();
    }
    if (disposed) return;

    if (result.ok) {
      // Stay busy: no second start while the page changes.
      ctx.navigate(`/run/${encodeURIComponent(result.data.runId)}`);
      return;
    }
    setRerunBusy(false);
    showError(alert, result.error);
    ctx.announce(result.error.message);
  }

  function showError(region: HTMLElement, err: ApiError): void {
    clear(region);
    region.append(renderApiError(err));
  }

  async function loadRuns(): Promise<void> {
    const res = await getRunsForPlan(report.planHash, aborter.signal);
    if (disposed) return;
    clear(runListHost);
    if (!res.ok) {
      runListHost.append(el('div', { class: 'alert', role: 'alert' }, renderApiError(res.error)));
      return;
    }
    const rows = runListRows(res.data.runs);
    if (rows.length === 0) {
      runListHost.append(el('p', { class: 'muted' }, 'No runs of this plan were found.'));
      return;
    }
    checkboxes = [];
    const body = rows.map((r) => {
      const box = el('input', {
        type: 'checkbox',
        value: r.runId,
        'aria-label': `Select run ${r.runId}`,
        onchange: updatePicker,
      });
      checkboxes.push(box);
      return el(
        'tr',
        null,
        el('td', null, box),
        el(
          'th',
          { scope: 'row', class: 'mono' },
          el('a', { href: `#/run/${encodeURIComponent(r.runId)}` }, r.runId),
          r.runId === report.runId ? el('span', { class: 'muted' }, ' (this run)') : null,
        ),
        el('td', { class: 'mono' }, r.started),
        el('td', null, badge(statusBadgeKind(r.status), r.status)),
        el('td', { class: 'num mono' }, r.safeCapacity),
        el('td', { class: 'num mono' }, r.breakingPoint),
      );
    });
    runListHost.append(
      scrollRegion(
        'Runs of this plan',
        el(
          'table',
          { class: 'table' },
          el('caption', null, `Most recent runs of this plan, newest first (up to ${MAX_LISTED_RUNS})`),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Select')),
              th('Run ID'),
              th('Started (UTC)'),
              th('Status'),
              th('Safe capacity (VUs)', true),
              th('Breaking point (VUs)', true),
            ),
          ),
          el('tbody', null, body),
        ),
      ),
    );
    updatePicker();
  }

  /** At most two runs can be ticked; the compare button needs exactly two. */
  function updatePicker(): void {
    const selected = checkboxes.filter((c) => c.checked).length;
    for (const c of checkboxes) c.disabled = comparing || (selected >= 2 && !c.checked);
    compareBtn.disabled = comparing || selected !== 2;
  }

  async function compareSelected(): Promise<void> {
    const ids = checkboxes.filter((c) => c.checked).map((c) => c.value);
    const a = ids[0];
    const b = ids[1];
    if (comparing || disposed || ids.length !== 2 || a === undefined || b === undefined || a === b) return;
    comparing = true;
    updatePicker();
    const seq = ++compareSeq;
    clear(compareHost);
    compareHost.append(el('p', { class: 'muted', role: 'status' }, 'Comparing runs.'));

    const res = await getCompare(a, b, aborter.signal);
    if (disposed || seq !== compareSeq) return;
    comparing = false;
    updatePicker();
    clear(compareHost);
    if (!res.ok) {
      compareHost.append(el('div', { class: 'alert', role: 'alert' }, renderApiError(res.error)));
      return;
    }
    const comparison = parseComparison(res.data);
    if (comparison === null) {
      compareHost.append(
        el('div', { class: 'alert', role: 'alert' }, el('p', { class: 'alert__message' }, 'The comparison could not be read. Please try again.')),
      );
      return;
    }
    renderCompareView(compareHost, comparison);
  }

  return () => {
    disposed = true;
    aborter.abort();
    disposeWidget();
  };
}
