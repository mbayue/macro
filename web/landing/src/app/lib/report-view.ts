/**
 * Capacity_Report view-model (pure). Headline tiles, notices, AI section model,
 * model-call rows and runs-of-this-plan rows. No DOM.
 */
import type { ModelCallView, RunListItem } from '../../../../../src/api-types.ts';
import type {
  AiSection,
  CapacityReport,
  ReportEvent,
} from '../../../../../src/report/build.ts';
import {
  displayBreakingPoint,
  displayFirstDegradedRoute,
  displaySafeCapacity,
} from '../../../../../src/report/compare.ts';
import { fmtMs } from '../../../../../src/run/format.ts';
import type { ContainmentType, RunStatus } from '../../../../../src/types.ts';
import { fmtUtc } from './format.ts';

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
  /** Color of the value: what the measured result says. */
  tone?: BadgeKind;
  /** One of the three answers the report exists for (drawn large). */
  key?: boolean;
}

/** Headline values with the shared wording for null values (13.2, 10.11). */
export function headlineItems(report: CapacityReport): HeadlineItem[] {
  const h = report.headline;
  return [
    {
      label: 'Safe capacity (VUs)',
      value: displaySafeCapacity(h.safeCapacity),
      tone: h.safeCapacity === null ? 'bad' : 'ok',
      key: true,
    },
    {
      label: 'Breaking point (VUs)',
      value: displayBreakingPoint(h.breakingPoint),
      tone: h.breakingPoint === null ? 'neutral' : 'bad',
      key: true,
    },
    {
      label: 'First degraded route',
      value: displayFirstDegradedRoute(h.firstDegradedRoute),
      tone: h.firstDegradedRoute === null ? 'neutral' : 'warn',
      key: true,
    },
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

