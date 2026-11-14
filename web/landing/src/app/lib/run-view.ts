/**
 * Live Run view-model (pure): snapshot/event reducers, polling rules, labels.
 */
import type {
  ContainmentEventPayload,
  DecisionView,
  EventView,
  ModelCallView,
  PlanRouteView,
  RunSnapshot,
  RunView,
  StageView,
} from '../../../../../src/api-types.ts';
import type { CapacityReport } from '../../../../../src/report/build.ts';
import type { ContainmentType, EventType, RunStatus, TestPlan } from '../../../../../src/types.ts';

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
const RUN_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', ...TERMINAL]);
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
  routes: PlanRouteView[];
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
    routes: snap.routes,
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
  if (status === 'queued' || status === 'running') return true;
  if (!isTerminal(status) || sinceTerminalMs === null) return false;
  if (liveTransition && sinceTerminalMs < END_GRACE_MS) return true;
  return reportExpected(status) && !hasReport && sinceTerminalMs < REPORT_WAIT_MS;
}
