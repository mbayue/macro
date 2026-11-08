/**
 * Live Run view (task 8.2, requirements 6.14, 9.2, 11.1-11.8).
 *
 *   #/run/<id>
 *
 * Data flow: GET /api/runs/:id gives a snapshot; an EventSource on
 * /api/runs/:id/events delivers EventViews that are reduced into a `RunModel`.
 * The reducer functions below are pure (they touch no DOM) and exported so they
 * can be exercised without a browser. Every API string reaches the page as a
 * text node through `el()`.
 */
import type {
  ContainmentEventPayload,
  DecisionView,
  EventView,
  ModelCallView,
  RunSnapshot,
  RunView,
  StageView,
} from '../src/api-types.ts';
import type { CapacityReport } from '../src/report/build.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../src/run/format.ts';
import type { ContainmentType, EventType, RunStatus, TestPlan } from '../src/types.ts';
import { getRun, stopRun } from './api.ts';
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { clear, el, renderApiError, scrollRegion, svg } from './dom.ts';
import { rememberRun } from './recent-runs.ts';
import { renderReportView } from './report-view.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Requirement 11.8: no update for this long while running shows the badge. */
export const STALE_AFTER_MS = 10_000;
/** Snapshot poll interval; a successful poll counts as liveness. */
export const POLL_MS = 5_000;
/** After a live end, keep polling/streaming this long to catch trailing Containment_Events. */
export const END_GRACE_MS = 15_000;
/** Wait at most this long for the report of a Run that has just ended. */
export const REPORT_WAIT_MS = 60_000;

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'halted', 'stopped', 'timed_out', 'failed', 'interrupted']);
const REPORT_STATUSES: ReadonlySet<string> = new Set(['completed', 'halted', 'stopped', 'timed_out']);
const RUN_STATUSES: ReadonlySet<string> = new Set(['running', ...TERMINAL]);
const EVENT_TYPES: readonly EventType[] = ['stage_start', 'stage_end', 'decision', 'status', 'containment', 'report'];
const CONTAINMENT_LABELS: Readonly<Record<ContainmentType, string>> = {
  sandbox_created: 'Sandbox created',
  egress_blocked: 'Egress blocked',
  memory_cap_hit: 'Memory cap hit',
  time_cap_hit: 'Time cap hit',
  sandbox_killed: 'Sandbox killed',
  sandbox_removed: 'Sandbox removed',
  runner_created: 'Runner created',
  runner_deleted: 'Runner deleted',
};
const WARN_CONTAINMENT: ReadonlySet<string> = new Set(['egress_blocked', 'memory_cap_hit', 'time_cap_hit']);

// ---------------------------------------------------------------------------
// View-model (pure)
// ---------------------------------------------------------------------------

export interface ContainmentEntry {
  id: number;
  ts: number;
  /** 0-based Stage index as stored; null when the event is not tied to a Stage. */
  stageIdx: number | null;
  type: ContainmentType;
  host?: string;
  port?: number;
}

export interface RunModel {
  run: RunView;
  plan: TestPlan | null;
  /** One entry per started Stage, ascending by index. */
  stages: StageView[];
  /** One entry per Stage (latest wins), ascending by Stage. */
  decisions: DecisionView[];
  /** Every Containment_Event, oldest first (ts, then id). */
  containment: ContainmentEntry[];
  report: CapacityReport | null;
  modelCalls: ModelCallView[];
  /** Ids of every event already reflected in this model (snapshot events + applied events). */
  seen: Set<number>;
  /** Events applied from the stream that the last snapshot did not contain. */
  extras: EventView[];
}

export interface ApplyResult {
  /** False when the event was a duplicate or unusable. */
  applied: boolean;
  /** True when the caller should refetch the snapshot (report ready). */
  needsSnapshot: boolean;
}

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

/** Terminal statuses for which the server builds a Capacity_Report. */
export function reportExpected(status: string): boolean {
  return REPORT_STATUSES.has(status);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStageView(v: unknown): v is StageView {
  return (
    isRecord(v) &&
    isNum(v['index']) &&
    isNum(v['vus']) &&
    isNum(v['durationSec']) &&
    (v['status'] === 'running' || v['status'] === 'done' || v['status'] === 'error')
  );
}

function isDecisionView(v: unknown): v is DecisionView {
  return (
    isRecord(v) &&
    isNum(v['stageIdx']) &&
    (v['decision'] === 'continue' || v['decision'] === 'stop') &&
    (v['source'] === 'agent' || v['source'] === 'fallback') &&
    typeof v['reason'] === 'string'
  );
}

function isContainmentType(v: unknown): v is ContainmentType {
  return typeof v === 'string' && Object.hasOwn(CONTAINMENT_LABELS, v);
}

function isContainmentPayload(v: unknown): v is ContainmentEventPayload {
  return isRecord(v) && isContainmentType(v['type']);
}

/** Parse the `data` of one SSE message. Returns null for anything that is not an EventView. */
export function parseEventView(data: unknown): EventView | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  const { id, type, runId, stageIdx, ts, payload } = json;
  if (!isNum(id) || !isNum(ts) || typeof runId !== 'string') return null;
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) return null;
  return {
    id,
    type: type as EventType,
    runId,
    stageIdx: isNum(stageIdx) ? stageIdx : null,
    payload,
    ts,
  };
}

function compareEntries(a: ContainmentEntry, b: ContainmentEntry): number {
  return a.ts - b.ts || a.id - b.id;
}

function toContainmentEntry(ev: EventView): ContainmentEntry | null {
  if (ev.type !== 'containment' || !isContainmentPayload(ev.payload)) return null;
  const entry: ContainmentEntry = { id: ev.id, ts: ev.ts, stageIdx: ev.stageIdx ?? null, type: ev.payload.type };
  if (typeof ev.payload.host === 'string' && ev.payload.host !== '') entry.host = ev.payload.host;
  if (isNum(ev.payload.port)) entry.port = ev.payload.port;
  return entry;
}

function upsertStage(stages: StageView[], incoming: StageView): void {
  const at = stages.findIndex((s) => s.index === incoming.index);
  if (at === -1) {
    stages.push(incoming);
    stages.sort((a, b) => a.index - b.index);
    return;
  }
  const existing = stages[at];
  // A replayed stage_start must not undo a stage that already ended.
  if (existing && existing.status !== 'running' && incoming.status === 'running') return;
  stages[at] = incoming;
}

function upsertDecision(decisions: DecisionView[], incoming: DecisionView): void {
  const at = decisions.findIndex((d) => d.stageIdx === incoming.stageIdx);
  if (at === -1) {
    decisions.push(incoming);
    decisions.sort((a, b) => a.stageIdx - b.stageIdx);
  } else {
    decisions[at] = incoming;
  }
}

/** Build a fresh model from a snapshot. Copies; never mutates the snapshot. */
export function modelFromSnapshot(snap: RunSnapshot): RunModel {
  const containment: ContainmentEntry[] = [];
  const seen = new Set<number>();
  for (const ev of snap.events) {
    seen.add(ev.id);
    const entry = toContainmentEntry(ev);
    if (entry) containment.push(entry);
  }
  containment.sort(compareEntries);
  const stages: StageView[] = [];
  for (const s of snap.stages) upsertStage(stages, { ...s });
  const decisions: DecisionView[] = [];
  for (const d of snap.decisions) upsertDecision(decisions, { ...d });
  return {
    run: { ...snap.run },
    plan: snap.plan,
    stages,
    decisions,
    containment,
    report: snap.report,
    modelCalls: snap.modelCalls,
    seen,
    extras: [],
  };
}

/**
 * Apply one stream event to the model (mutates `model`). Duplicates (same id as
 * an event already seen, from the snapshot or an earlier delivery) are ignored.
 */
export function applyEvent(model: RunModel, ev: EventView): ApplyResult {
  if (model.seen.has(ev.id)) return { applied: false, needsSnapshot: false };
  model.seen.add(ev.id);
  model.extras.push(ev);
  let needsSnapshot = false;
  switch (ev.type) {
    case 'stage_start':
    case 'stage_end':
      if (isStageView(ev.payload)) upsertStage(model.stages, { ...ev.payload });
      break;
    case 'decision':
      if (isDecisionView(ev.payload)) upsertDecision(model.decisions, { ...ev.payload });
      break;
    case 'status': {
      const p = ev.payload;
      if (isRecord(p) && typeof p['status'] === 'string' && RUN_STATUSES.has(p['status'])) {
        const next = p['status'] as RunStatus;
        // A terminal status is final.
        if (isTerminal(model.run.status) && !isTerminal(next)) break;
        model.run.status = next;
        model.run.statusReason = typeof p['reason'] === 'string' ? p['reason'] : null;
        if (isTerminal(next)) model.run.endedAt = model.run.endedAt ?? ev.ts;
      }
      break;
    }
    case 'containment': {
      const entry = toContainmentEntry(ev);
      if (entry) {
        model.containment.push(entry);
        model.containment.sort(compareEntries);
      }
      break;
    }
    case 'report':
      needsSnapshot = true;
      break;
  }
  return { applied: true, needsSnapshot };
}

/**
 * Fold a newer snapshot into the model: start from the snapshot, then re-apply
 * stream events the snapshot does not contain yet (the snapshot may have been
 * read before they were recorded). Returns a new model.
 */
export function mergeSnapshot(model: RunModel, snap: RunSnapshot): RunModel {
  const next = modelFromSnapshot(snap);
  for (const ev of model.extras) {
    if (!next.seen.has(ev.id)) applyEvent(next, ev);
  }
  // A status set locally (stop response) or by a newer event is not rolled back
  // by a snapshot that was read earlier.
  if (isTerminal(model.run.status) && !isTerminal(next.run.status)) {
    next.run = {
      ...next.run,
      status: model.run.status,
      statusReason: model.run.statusReason,
      endedAt: model.run.endedAt,
    };
  }
  return next;
}

/** Record a terminal status learned outside the stream (the stop response). */
export function applyLocalStatus(model: RunModel, status: RunStatus, now: number): void {
  if (isTerminal(model.run.status) || !isTerminal(status)) return;
  model.run.status = status;
  model.run.endedAt = model.run.endedAt ?? now;
}

export interface CurrentStage {
  /** 1-based position of the current Stage (highest started Stage). */
  position: number;
  /** Number of Stages in the plan; null when the plan is not available. */
  total: number | null;
  /** VU count from the plan (falls back to the Stage row). */
  vus: number;
}

/** The current Stage is the highest Stage that has started; null before the first stage_start. */
export function currentStage(model: Pick<RunModel, 'stages' | 'plan'>): CurrentStage | null {
  let top: StageView | undefined;
  for (const s of model.stages) if (!top || s.index > top.index) top = s;
  if (!top) return null;
  const planned = model.plan?.stages[top.index];
  return {
    position: top.index + 1,
    total: model.plan ? model.plan.stages.length : null,
    vus: planned ? planned.vus : top.vus,
  };
}

/** Milliseconds since start; frozen at `endedAt` once the Run has ended. Never negative. */
export function elapsedMs(run: Pick<RunView, 'startedAt' | 'endedAt'>, now: number): number {
  const end = run.endedAt ?? now;
  return Math.max(0, end - run.startedAt);
}

/** `mm:ss` (minutes are not capped at 59). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** UTC `HH:MM:SS`. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toISOString().slice(11, 19);
}

export function containmentLabel(type: ContainmentType): string {
  return CONTAINMENT_LABELS[type];
}

export function isWarnContainment(type: string): boolean {
  return WARN_CONTAINMENT.has(type);
}

export function statusWords(status: string): string {
  return status.replace(/_/g, ' ');
}

/** Requirement 11.8: the "may be out of date" badge applies while running and silent for 10 s. */
export function isStale(lastActivityAt: number, now: number, status: string): boolean {
  return status === 'running' && now - lastActivityAt >= STALE_AFTER_MS;
}

/**
 * Whether the view should keep refreshing. While running: yes. After the end:
 * during the grace window for a live transition (trailing Containment_Events),
 * and while a report is expected but not there yet (up to REPORT_WAIT_MS).
 */
export function shouldPoll(
  status: string,
  hasReport: boolean,
  sinceTerminalMs: number | null,
  liveTransition: boolean,
): boolean {
  if (status === 'running') return true;
  if (!isTerminal(status) || sinceTerminalMs === null) return false;
  if (liveTransition && sinceTerminalMs < END_GRACE_MS) return true;
  return reportExpected(status) && !hasReport && sinceTerminalMs < REPORT_WAIT_MS;
}

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
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

function warningIcon(): SVGElement {
  return svg(
    'svg',
    { class: 'icon', viewBox: '0 0 16 16', width: 16, height: 16, role: 'img', 'aria-label': 'Warning', focusable: 'false' },
    svg('path', {
      d: 'M8 1.6 15 14H1z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
    }),
    svg('path', {
      d: 'M8 6.2v3.6M8 11.6v.8',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
    }),
  );
}

function stagePosition(stageIdx: number | null): (Node | string)[] {
  if (stageIdx === null) {
    return [
      'Stage ',
      el('span', { 'aria-hidden': 'true' }, '\u2013'),
      el('span', { class: 'visually-hidden' }, 'none'),
    ];
  }
  return [`Stage ${stageIdx + 1}`];
}

const DASH = '\u2013';

const METRIC_HEADERS = ['Requests', 'Requests/s', 'Error rate', 'HTTP 429', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)'] as const;

function fillStages(box: HTMLElement, stages: readonly StageView[], plan: TestPlan | null, status: RunStatus): void {
  clear(box);
  // Stages from the plan that have not started yet: "pending" while the Run is running,
  // "not run" after it ended early.
  const started = new Set(stages.map((s) => s.index));
  const unstarted = (plan?.stages ?? [])
    .map((p, index) => ({ index, vus: p.vus, durationSec: p.durationSec }))
    .filter((p) => !started.has(p.index));
  if (stages.length === 0 && unstarted.length === 0) {
    box.append(el('p', { class: 'muted' }, 'No Stage has started yet.'));
    return;
  }
  const rows = stages.map((s) => {
    const cells: HTMLElement[] = [
      el('th', { scope: 'row', class: 'num' }, fmtCount(s.index + 1)),
      el('td', { class: 'num' }, fmtCount(s.vus)),
      el('td', { class: 'num' }, `${fmtCount(s.durationSec)} s`),
    ];
    if (s.status === 'error') {
      cells.push(
        el('td', null, el('span', { class: 'badge badge--bad' }, 'error')),
        el('td', { colspan: METRIC_HEADERS.length, class: 'stage-error' }, s.errorReason ?? 'No reason was recorded.'),
      );
    } else {
      const m = s.status === 'done' ? (s.metrics?.overall ?? null) : null;
      const result =
        s.status === 'running'
          ? el('span', { class: 'badge' }, 'running')
          : s.verdict
            ? el('span', { class: s.verdict === 'pass' ? 'badge badge--ok' : 'badge badge--bad' }, s.verdict)
            : DASH;
      cells.push(el('td', null, result));
      const values = m
        ? [fmtCount(m.requests), fmtRps(m.rps), fmtPct(m.errorRatePct), fmtCount(m.http429), fmtMs(m.p50), fmtMs(m.p95), fmtMs(m.p99)]
        : METRIC_HEADERS.map(() => DASH);
      for (const v of values) cells.push(el('td', { class: 'num' }, v));
    }
    return el('tr', null, cells);
  });
  const pendingLabel = status === 'running' ? 'pending' : 'not run';
  for (const p of unstarted) {
    rows.push(
      el(
        'tr',
        { class: 'is-pending' },
        el('th', { scope: 'row', class: 'num' }, fmtCount(p.index + 1)),
        el('td', { class: 'num' }, fmtCount(p.vus)),
        el('td', { class: 'num' }, `${fmtCount(p.durationSec)} s`),
        el('td', null, el('span', { class: 'badge' }, pendingLabel)),
        METRIC_HEADERS.map(() => el('td', { class: 'num' }, DASH)),
      ),
    );
  }
  const table = el(
    'table',
    { class: 'table' },
    el('caption', null, 'Stages'),
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        el('th', { scope: 'col', class: 'num' }, 'Stage'),
        el('th', { scope: 'col', class: 'num' }, 'VUs'),
        el('th', { scope: 'col', class: 'num' }, 'Duration'),
        el('th', { scope: 'col' }, 'Result'),
        METRIC_HEADERS.map((h) => el('th', { scope: 'col', class: 'num' }, h)),
      ),
    ),
    el('tbody', null, rows),
  );
  box.append(scrollRegion('Stages', table));
}

function fillDecisions(box: HTMLElement, decisions: readonly DecisionView[]): void {
  clear(box);
  if (decisions.length === 0) {
    box.append(el('p', { class: 'muted' }, 'No decision has been made yet.'));
    return;
  }
  box.append(
    el(
      'ul',
      { class: 'timeline' },
      decisions.map((d) =>
        el(
          'li',
          { class: 'timeline__item' },
          el(
            'div',
            { class: 'row' },
            el('strong', null, `Stage ${d.stageIdx + 1}`),
            el('span', { class: d.decision === 'continue' ? 'badge badge--ok' : 'badge badge--warn' }, d.decision),
            el('span', { class: 'muted' }, `source: ${d.source}`),
            d.reasonWithheld ? el('span', { class: 'badge badge--warn' }, 'AI explanation withheld: unverified number') : null,
          ),
          el('p', { class: 'prose' }, d.reason),
        ),
      ),
    ),
  );
}

function fillTimeline(box: HTMLElement, events: readonly ContainmentEntry[]): void {
  clear(box);
  if (events.length === 0) {
    box.append(el('p', { class: 'muted' }, 'No containment event has been recorded yet.'));
    return;
  }
  box.append(
    el(
      'ul',
      { class: 'timeline' },
      events.map((e) => {
        const warn = isWarnContainment(e.type);
        const iso = new Date(e.ts).toISOString();
        return el(
          'li',
          { class: warn ? 'timeline__item timeline__item--warn' : 'timeline__item' },
          el('time', { class: 'timeline__time', datetime: iso }, formatClock(e.ts)),
          warn ? warningIcon() : null,
          el('strong', { class: 'timeline__label' }, containmentLabel(e.type)),
          ' \u00b7 ',
          stagePosition(e.stageIdx),
          e.host !== undefined
            ? [' \u00b7 ', el('span', { class: 'mono' }, e.port !== undefined ? `${e.host}:${e.port}` : e.host)]
            : e.port !== undefined
              ? [' \u00b7 ', el('span', { class: 'mono' }, `port ${e.port}`)]
              : null,
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function showLoadError(root: HTMLElement, error: Parameters<typeof renderApiError>[0], retry: () => void): void {
  clear(root);
  root.append(
    el(
      'section',
      { class: 'panel stack' },
      el('h1', null, 'Run'),
      el('div', { class: 'alert', role: 'alert' }, renderApiError(error)),
      el(
        'div',
        { class: 'row' },
        el('button', { type: 'button', class: 'btn', onclick: retry }, 'Try again'),
        el('a', { href: '#/' }, 'Back to the planner'),
      ),
    ),
  );
}

export function renderRunView(root: HTMLElement, ctx: AppContext, params: RouteParams): void | ViewCleanup {
  const id = params['id'] ?? '';
  const abort = new AbortController();
  let disposed = false;

  let model: RunModel | null = null;
  let es: EventSource | null = null;
  let esOpens = 0;
  let tickTimer: number | undefined;

  let lastActivity = Date.now();
  let lastPollAt = Date.now();
  let stale = false;
  let lastStatus: string = '';
  let terminalSince: number | null = null;
  let liveTransition = false;
  let fetchSeq = 0;
  let appliedSeq = 0;
  let stopPending = false;
  const keys = { stages: '', decisions: '', timeline: '' };
  let reportRendered = false;
  let reportCleanup: ViewCleanup | null = null;

  // ---- static DOM, built once the first snapshot arrives ----
  const statusBadge = el('span', { class: 'badge' }, '');
  const staleBadge = el('span', { class: 'badge badge--warn' }, 'Progress may be out of date');
  staleBadge.hidden = true;
  const planName = el('p', { class: 'plan-name' }, '');
  const runtimeDd = el('dd', { class: 'mono' }, '');
  const stageDt = el('dt', null, 'Stage');
  const stageDd = el('dd', null, '');
  const vusDt = el('dt', null, 'VUs');
  const vusDd = el('dd', null, '');
  const elapsedDt = el('dt', null, 'Elapsed');
  const elapsedDd = el('dd', { class: 'mono' }, '00:00');
  const stopErr = el('div', { class: 'alert', role: 'alert' });
  const stopBtn = el('button', { type: 'button', class: 'btn btn--danger', onclick: () => void onStop() }, 'Stop run');
  const stopWrap = el('div', { class: 'stack stack--tight' }, el('div', { class: 'row' }, stopBtn), stopErr);
  const reasonBox = el('div', { class: 'stack stack--tight' });
  const stagesBox = el('div');
  const decisionsBox = el('div');
  const timelineBox = el('div');
  const reportBox = el('div', { class: 'stack' });

  function currentModel(): RunModel {
    if (!model) throw new Error('Run model is not loaded');
    return model;
  }

  // ---- rendering ----

  function renderHeader(): void {
    const m = currentModel();
    const running = m.run.status === 'running';
    statusBadge.className = statusBadgeClass(m.run.status);
    statusBadge.textContent = statusWords(m.run.status);
    planName.textContent = m.plan?.name ?? '';
    planName.hidden = !m.plan;
    runtimeDd.textContent = m.run.runtime;

    const cur = currentStage(m);
    stageDt.hidden = stageDd.hidden = vusDt.hidden = vusDd.hidden = !running;
    if (running) {
      stageDd.textContent = cur
        ? cur.total !== null
          ? `Stage ${cur.position} of ${cur.total}`
          : `Stage ${cur.position}`
        : 'Starting';
      vusDd.textContent = cur ? fmtCount(cur.vus) : DASH;
    }
    elapsedDt.textContent = running ? 'Elapsed' : 'Total time';
    updateElapsed(Date.now());

    if (!running && stopWrap.isConnected) stopWrap.remove();
    staleBadge.hidden = !(running && stale);
  }

  function updateElapsed(now: number): void {
    if (!model) return;
    elapsedDd.textContent = formatElapsed(elapsedMs(model.run, now));
  }

  function renderReasonBox(): void {
    const m = currentModel();
    clear(reasonBox);
    const reason = m.run.statusReason;
    if (!isTerminal(m.run.status) || reason === null || reason === '') return;
    const bad = (m.run.status === 'failed' || m.run.status === 'interrupted') && m.report === null;
    reasonBox.append(
      bad
        ? el('div', { class: 'alert' }, el('p', { class: 'alert__message' }, `Run ${statusWords(m.run.status)}`), el('p', null, reason))
        : el('p', { class: 'muted' }, reason),
    );
  }

  function renderSections(): void {
    const m = currentModel();
    const stagesKey = JSON.stringify([m.stages, m.run.status, m.plan?.stages.length ?? 0]);
    if (stagesKey !== keys.stages) {
      keys.stages = stagesKey;
      fillStages(stagesBox, m.stages, m.plan, m.run.status);
    }
    const decisionsKey = JSON.stringify(m.decisions);
    if (decisionsKey !== keys.decisions) {
      keys.decisions = decisionsKey;
      fillDecisions(decisionsBox, m.decisions);
    }
    const timelineKey = JSON.stringify(m.containment);
    if (timelineKey !== keys.timeline) {
      keys.timeline = timelineKey;
      fillTimeline(timelineBox, m.containment);
    }
  }

  function renderReportIfReady(): void {
    const m = currentModel();
    if (reportRendered || !m.report || !isTerminal(m.run.status)) return;
    reportRendered = true;
    clear(reportBox);
    try {
      const result = renderReportView(reportBox, ctx, m.report, {
        runId: id,
        run: m.run,
        plan: m.plan,
        modelCalls: m.modelCalls,
      });
      if (typeof result === 'function') reportCleanup = result;
    } catch {
      clear(reportBox);
      reportBox.append(
        el('div', { class: 'alert', role: 'alert' }, el('p', null, 'The report could not be shown. Reload the page to try again.')),
      );
    }
  }

  /** Re-render everything that depends on the model and run lifecycle transitions. */
  function update(): void {
    const m = currentModel();
    const status = m.run.status;
    const wasRunning = lastStatus === 'running';
    lastStatus = status;
    if (isTerminal(status)) {
      if (terminalSince === null) {
        terminalSince = Date.now();
        liveTransition = wasRunning;
      }
      stale = false;
      if (wasRunning) {
        ctx.announce(`Run ${statusWords(status)}.`);
        void refetch();
      }
    }
    renderHeader();
    renderReasonBox();
    renderSections();
    renderReportIfReady();
  }

  // ---- data ----

  async function refetch(): Promise<void> {
    if (disposed) return;
    const seq = ++fetchSeq;
    const res = await getRun(id, abort.signal);
    if (disposed || !res.ok || seq < appliedSeq) return;
    appliedSeq = seq;
    lastActivity = Date.now();
    setStale(false);
    model = model ? mergeSnapshot(model, res.data) : modelFromSnapshot(res.data);
    update();
  }

  function setStale(next: boolean): void {
    if (next === stale) return;
    stale = next;
    staleBadge.hidden = !(stale && model?.run.status === 'running');
    if (model?.run.status === 'running') {
      ctx.announce(stale ? 'Progress may be out of date.' : 'Progress updates resumed.');
    }
  }

  function onMessage(data: unknown): void {
    if (disposed || !model) return;
    lastActivity = Date.now();
    setStale(false);
    const ev = parseEventView(data);
    if (!ev || ev.runId !== id) return;
    const result = applyEvent(model, ev);
    if (!result.applied) return;
    update();
    if (result.needsSnapshot) void refetch();
  }

  function openStream(): void {
    const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
    es = source;
    const handler = (ev: Event): void => onMessage((ev as MessageEvent).data);
    source.onmessage = handler;
    for (const type of EVENT_TYPES) source.addEventListener(type, handler);
    source.addEventListener('open', () => {
      esOpens += 1;
      // The first connection replays from the start and is deduped; after a
      // reconnect the snapshot also catches anything the replay might miss.
      if (esOpens > 1) void refetch();
    });
  }

  function closeStream(): void {
    if (es) {
      es.close();
      es = null;
    }
  }

  async function onStop(): Promise<void> {
    if (stopPending || !model || model.run.status !== 'running') return;
    stopPending = true;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping\u2026';
    clear(stopErr);
    // No abort signal: leaving the page must not cancel a stop the user asked for.
    const res = await stopRun(id);
    stopPending = false;
    if (disposed || !model) return;
    if (!res.ok) {
      stopErr.append(renderApiError(res.error));
    } else {
      if (isTerminal(res.data.status)) applyLocalStatus(model, res.data.status, Date.now());
      update();
      void refetch();
    }
    if (model.run.status === 'running') {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop run';
    }
  }

  // ---- timers ----

  function tick(): void {
    if (disposed || !model) return;
    const now = Date.now();
    updateElapsed(now);
    const status = model.run.status;
    if (status === 'running') setStale(isStale(lastActivity, now, status));
    const since = terminalSince === null ? null : now - terminalSince;
    if (shouldPoll(status, model.report !== null, since, liveTransition)) {
      if (now - lastPollAt >= POLL_MS) {
        lastPollAt = now;
        void refetch();
      }
    } else {
      if (es) {
        closeStream();
        void refetch();
      } else if (isTerminal(status)) {
        window.clearInterval(tickTimer);
        tickTimer = undefined;
      }
    }
  }

  // ---- mount ----

  function mount(snapshot: RunSnapshot): void {
    model = modelFromSnapshot(snapshot);
    lastStatus = model.run.status;
    lastActivity = Date.now();
    lastPollAt = Date.now();
    clear(root);

    root.append(
      el(
        'section',
        { class: 'panel panel--hero run-header stack' },
        el('div', { class: 'row row--between' }, el('div', { class: 'row' }, el('h1', null, 'Run'), statusBadge, staleBadge)),
        planName,
        el(
          'dl',
          { class: 'kv' },
          el('dt', null, 'Sandbox runtime'),
          runtimeDd,
          stageDt,
          stageDd,
          vusDt,
          vusDd,
          elapsedDt,
          elapsedDd,
        ),
        stopWrap,
        reasonBox,
        el('p', null, el('a', { href: '#/' }, 'Back to the planner')),
      ),
      el('section', { class: 'panel stack' }, el('h2', null, 'Stages'), stagesBox),
      el('section', { class: 'panel stack' }, el('h2', null, 'Decisions'), decisionsBox),
      el(
        'section',
        { class: 'panel stack' },
        el('h2', null, 'Containment timeline'),
        el('p', { class: 'muted' }, 'Oldest first. Times are UTC.'),
        timelineBox,
      ),
      reportBox,
    );

    update();
    if (model.run.status === 'running') openStream();
    tickTimer = window.setInterval(tick, 1000);
  }

  async function load(): Promise<void> {
    clear(root);
    root.append(el('p', { class: 'muted', role: 'status' }, 'Loading the run'));
    const res = await getRun(id, abort.signal);
    if (disposed) return;
    if (!res.ok) {
      showLoadError(root, res.error, () => void load());
      return;
    }
    if (res.data.run.kind === 'probe') {
      ctx.navigate(`/probe/${encodeURIComponent(id)}`);
      return;
    }
    rememberRun({
      id,
      kind: 'run',
      name: res.data.plan?.name ?? 'Load test',
      startedAt: res.data.run.startedAt,
    });
    mount(res.data);
  }

  void load();

  return () => {
    disposed = true;
    abort.abort();
    closeStream();
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    tickTimer = undefined;
    if (reportCleanup) {
      try {
        reportCleanup();
      } catch {
        // A failing report cleanup must not block navigation.
      }
      reportCleanup = null;
    }
  };
}
