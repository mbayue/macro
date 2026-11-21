import type { DecisionView, ModelCallView, StageView } from '../../../../../../src/api-types.ts';
import type { CapacityReport, StageView as ReportStageView } from '../../../../../../src/report/build.ts';
import {
  displayBreakingPoint,
  displayFirstDegradedRoute,
  displaySafeCapacity,
} from '../../../../../../src/report/compare.ts';
import { fmtCount, fmtMs, fmtPct } from '../../../../../../src/run/format.ts';
import type { ContainmentType, RunStatus, SandboxRuntime, TestPlan } from '../../../../../../src/types.ts';
import { fmtGrouped, fmtUtc } from '../../lib/format.ts';
import { AI_WITHHELD_NOTE } from '../../lib/report-view.ts';
import {
  containmentLabel,
  currentStage,
  elapsedMs,
  formatElapsed,
  isTerminal,
  isWarnContainment,
  type RunModel,
} from '../../lib/run-view.ts';
import type { RunTab } from '../../router.ts';
import type { Tone } from '../ui.tsx';

const DASH = '\u2013';
type StopThresholds = TestPlan['stopThresholds'];

export interface RunTabMeta {
  id: RunTab;
  label: string;
}

export const RUN_TAB_ITEMS: readonly RunTabMeta[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'stages', label: 'Stages & Routes' },
  { id: 'ai', label: 'AI Insights & Report Q&A' },
  { id: 'audit', label: 'Audit Log' },
] as const;

export const AI_TAB_DISABLED_REASON = 'available when the report is ready';

export interface KpiStripItem {
  id: 'stage-or-safe' | 'p95-or-breaking' | 'error-or-route' | 'safe-or-peak';
  label: string;
  value: string;
  unit: string | null;
  sourceNote: string;
  tone: Tone;
  /** 0..1 progress along the bottom of the live stage tile when running. */
  progress?: number;
}

export interface AuditGateMetadata {
  verdictLabel: string;
  verdictTone: Tone;
  runId: string;
  status: RunStatus;
  statusReason: string | null;
  planName: string | null;
  planHash: string | null;
  target: string | null;
  stopThresholds: StopThresholds | null;
  runtime: SandboxRuntime;
  startedAtUtc: string;
  endedAtUtc: string | null;
}

export interface AuditDecisionItem {
  stageIndex: number;
  stageNumber: number;
  stageLabel: string;
  decision: DecisionView['decision'];
  decisionTone: Tone;
  source: DecisionView['source'];
  sourceLabel: string;
  reason: string;
  reasonWithheld: boolean;
  withheldNote: string | null;
}

export interface AuditContainmentItem {
  id: number;
  ts: number;
  utc: string;
  type: ContainmentType;
  label: string;
  warn: boolean;
  target: string | null;
  stageNumber: number | null;
  scopeLabel: string;
}

export interface AuditLogModel {
  gate: AuditGateMetadata;
  decisions: AuditDecisionItem[];
  containment: AuditContainmentItem[];
  modelCalls: readonly ModelCallView[];
}

export function resolveActiveRunTab(requestedTab: RunTab, hasReport: boolean): RunTab {
  if (requestedTab === 'ai' && !hasReport) return 'overview';
  return requestedTab;
}

function lastDoneStage(stages: readonly StageView[]): StageView | null {
  let top: StageView | null = null;
  for (const s of stages) {
    if (s.status === 'done' && s.metrics !== null && (top === null || s.index > top.index)) top = s;
  }
  return top;
}

function highestPassingStage(stages: readonly StageView[]): StageView | null {
  let best: StageView | null = null;
  for (const s of stages) {
    if (s.status === 'done' && s.verdict === 'pass' && (best === null || s.vus > best.vus || (s.vus === best.vus && s.index > best.index))) {
      best = s;
    }
  }
  return best;
}

function reportKpiItems(model: RunModel, report: CapacityReport, now: number): KpiStripItem[] {
  const th = report.thresholds;
  const ran = report.stages;
  const planned = Math.max(model.plan?.stages.length ?? 0, ran.length);

  const safe = report.headline.safeCapacity;
  let safeStage: ReportStageView | undefined;
  if (safe !== null) {
    for (const s of ran) {
      if (s.verdict === 'pass' && s.vus === safe) safeStage = s;
    }
  }
  const safeNote =
    safe !== null
      ? `${safeStage ? `from stage ${safeStage.displayIndex} · ` : ''}highest under ${fmtCount(th.p95Ms)} ms p95 and ${th.errorRatePct}% errors`
      : 'no stage stayed under both limits';

  const brk = report.headline.breakingPoint;
  const breakStage = brk !== null ? ran.find((s) => s.vus === brk && s.verdict === 'fail') : undefined;
  const breakNote =
    brk !== null
      ? `${breakStage ? `from stage ${breakStage.displayIndex} · ` : ''}first stage over a limit overall`
      : 'every stage stayed under both limits, all routes together';

  const firstRoute = report.headline.firstDegradedRoute;
  const where = firstRoute
    ? ran.map((s) => ({ s, r: s.routes.find((r) => r.route === firstRoute && r.exceedsThresholds) })).find((x) => x.r)
    : undefined;
  const routeNote = where?.r
    ? where.r.raw.p95 > th.p95Ms
      ? `this route alone: p95 ${where.r.display.p95} ms from stage ${where.s.displayIndex} (${fmtCount(where.s.vus)} VUs), limit ${fmtCount(th.p95Ms)} ms`
      : `this route alone: error rate ${where.r.display.errorRatePct} from stage ${where.s.displayIndex} (${fmtCount(where.s.vus)} VUs), limit ${th.errorRatePct}%`
    : firstRoute !== null
      ? `exceeded stop thresholds (${fmtCount(th.p95Ms)} ms p95 / ${th.errorRatePct}% errors)`
      : 'no single route went over a limit';

  let peakStage: ReportStageView | undefined;
  for (const s of ran) {
    if (!peakStage || s.vus > peakStage.vus) peakStage = s;
  }
  const elapsed = formatElapsed(elapsedMs(model.run, now));
  const stageWord = planned === 1 ? 'stage' : 'stages';
  const peakNote = peakStage
    ? `from stage ${peakStage.displayIndex} · ${ran.length} of ${planned} ${stageWord} · ${elapsed} in total`
    : `${ran.length} of ${planned} ${stageWord} · ${elapsed} in total`;

  return [
    {
      id: 'stage-or-safe',
      label: 'Safe capacity (VUs)',
      value: displaySafeCapacity(safe),
      unit: safe !== null ? 'VUs' : null,
      sourceNote: safeNote,
      tone: 'live',
    },
    {
      id: 'p95-or-breaking',
      label: 'Breaking point (VUs)',
      value: displayBreakingPoint(brk),
      unit: brk !== null ? 'VUs' : null,
      sourceNote: breakNote,
      tone: brk === null ? 'neutral' : 'bad',
    },
    {
      id: 'error-or-route',
      label: 'First degraded route',
      value: displayFirstDegradedRoute(firstRoute),
      unit: null,
      sourceNote: routeNote,
      tone: firstRoute === null ? 'neutral' : 'warn',
    },
    {
      id: 'safe-or-peak',
      label: 'Tested up to',
      value: peakStage ? fmtCount(peakStage.vus) : DASH,
      unit: peakStage ? 'VUs' : null,
      sourceNote: peakNote,
      tone: 'neutral',
    },
  ];
}

export function buildKpiStripItems(model: RunModel, now: number): KpiStripItem[] {
  const report = isTerminal(model.run.status) ? model.report : null;
  if (report !== null) {
    return reportKpiItems(model, report, now);
  }

  const cur = currentStage(model);
  const running = model.run.status === 'running';
  const top = model.stages.find((s) => s.index === (cur?.position ?? 0) - 1) ?? null;
  const stageSec =
    top?.startedAt != null && top.status === 'running'
      ? Math.max(0, Math.round((now - top.startedAt) / 1000))
      : null;
  const done = lastDoneStage(model.stages);
  const m = done?.metrics?.overall ?? null;
  const limit = model.plan?.stopThresholds ?? null;
  const safeStage = highestPassingStage(model.stages);

  const stageNote = cur
    ? stageSec !== null && top
      ? `from stage ${cur.position} · ${Math.min(stageSec, top.durationSec)} s of ${top.durationSec} s`
      : `from stage ${cur.position}`
    : 'preparing the first sandbox';
  const progress =
    stageSec !== null && top ? Math.min(1, stageSec / Math.max(1, top.durationSec)) : undefined;

  const p95Note = done
    ? `from stage ${done.index + 1}${limit ? ` · limit ${fmtMs(limit.p95Ms)} ms` : ''}`
    : `${limit ? `limit ${fmtMs(limit.p95Ms)} ms · ` : ''}after stage 1 ends`;

  const errNote = done
    ? `from stage ${done.index + 1}${limit ? ` · limit ${limit.errorRatePct}%` : ''}`
    : `${limit ? `limit ${limit.errorRatePct}% · ` : ''}after stage 1 ends`;

  const safeNote = safeStage
    ? `from stage ${safeStage.index + 1} · highest stage that passed`
    : 'no stage has passed yet';

  return [
    {
      id: 'stage-or-safe',
      label: cur ? (cur.total !== null ? `Stage ${cur.position} of ${cur.total}` : `Stage ${cur.position}`) : 'Starting',
      value: cur ? fmtCount(cur.vus) : DASH,
      unit: cur ? 'VUs' : null,
      sourceNote: stageNote,
      tone: running ? 'live' : 'neutral',
      ...(progress !== undefined ? { progress } : {}),
    },
    {
      id: 'p95-or-breaking',
      label: done ? `p95 at stage ${done.index + 1}` : 'p95 latency',
      value: m ? `${fmtMs(m.p95)} ms` : DASH,
      unit: null,
      sourceNote: p95Note,
      tone: 'neutral',
    },
    {
      id: 'error-or-route',
      label: done ? `Error rate at stage ${done.index + 1}` : 'Error rate',
      value: m ? fmtPct(m.errorRatePct) : DASH,
      unit: null,
      sourceNote: errNote,
      tone: 'neutral',
    },
    {
      id: 'safe-or-peak',
      label: 'Safe capacity so far',
      value: safeStage !== null ? fmtCount(safeStage.vus) : DASH,
      unit: safeStage !== null ? 'VUs' : null,
      sourceNote: safeNote,
      tone: 'neutral',
    },
  ];
}

/**
 * Status reasons are written by the server with requirement terms (Supervisor_Agent, Stage_Verdict,
 * Stop_Thresholds). Say them in plain words on screen.
 */
export function plainReason(text: string): string {
  return text
    .replace(/the Supervisor_Agent's decision/g, 'the supervisor (AI) decision')
    .replace(/Supervisor_Agent/g, 'supervisor (AI)')
    .replace(/Stop_Thresholds?/g, 'stop thresholds')
    .replace(/Stage_Verdicts?/g, 'stage verdict')
    .replace(/\b([A-Z][a-z]+)_([A-Z][a-z]+)\b/g, (_m, a: string, b: string) => `${a.toLowerCase()} ${b.toLowerCase()}`)
    .replace(/\bStage (\d)/g, 'stage $1');
}

/**
 * The report's answer in one sentence, built only from the headline values and stage rows
 * (never from AI text): how much load held, where it broke, and the first route to go over.
 */
export function verdictLine(report: CapacityReport, routes: readonly { id: string; path: string }[] = []): string {
  const { safeCapacity: safe, breakingPoint: brk, firstDegradedRoute: route } = report.headline;
  const th = report.thresholds;
  const measured = report.stages.filter((s) => s.overall !== null);
  if (measured.length === 0) return 'No stage produced metrics, so this run has no capacity answer.';
  const fmtN = fmtGrouped;
  const top = Math.max(...measured.map((s) => s.vus));
  const brkStage = brk === null ? undefined : measured.find((s) => s.vus === brk && s.verdict === 'fail');

  const overWhat = (s: ReportStageView): string => {
    const m = s.overall;
    if (m === null) return 'a stop threshold';
    const p95 = m.raw.p95 > th.p95Ms;
    const err = m.raw.errorRatePct > th.errorRatePct;
    if (p95 && err) return `p95 latency (${m.display.p95} ms) and error rate (${m.display.errorRatePct}) went over their limits`;
    if (p95) return `p95 latency went over the ${fmtN(th.p95Ms)} ms limit (${m.display.p95} ms)`;
    if (err) return `error rate went over the ${th.errorRatePct}% limit (${m.display.errorRatePct})`;
    return 'a stop threshold was crossed';
  };

  let line: string;
  if (safe !== null && brk === null) {
    line = `Holds ${fmtN(top)} VUs, the most this run tested: across all routes, every stage stayed under both stop limits.`;
  } else if (safe !== null && brk !== null) {
    line = `Holds ${fmtN(safe)} VUs. At ${fmtN(brk)} VUs, ${brkStage ? overWhat(brkStage) : 'a stop threshold was crossed'}.`;
  } else if (brk !== null) {
    line = `No stage held: at ${fmtN(brk)} VUs, the first stage measured, ${brkStage ? overWhat(brkStage) : 'a stop threshold was crossed'}.`;
  } else {
    line = `Tested up to ${fmtN(top)} VUs.`;
  }

  if (route) {
    const hit = measured.map((s) => ({ s, r: s.routes.find((r) => r.route === route && r.exceedsThresholds) })).find((x) => x.r);
    if (hit?.r) {
      // The stop limits judge all routes together; a single route over a limit is a warning, not the
      // Breaking Point. Say so, with the route's own reading, so the two never read as a contradiction.
      const overP95 = hit.r.raw.p95 > th.p95Ms;
      const reading = overP95
        ? `p95 ${hit.r.display.p95} ms, over the ${fmtN(th.p95Ms)} ms limit`
        : `${hit.r.display.errorRatePct} errors, over the ${th.errorRatePct}% limit`;
      const path = routes.find((r) => r.id === route)?.path;
      const label = path === undefined ? route : `${route} (${path})`;
      line += ` On its own, ${label} was the first route to go over: ${reading} at ${fmtN(hit.s.vus)} VUs.`;
    }
  }
  return line;
}

/** Lightweight revision keys so memoized live panels skip re-renders on 1 s clock ticks. */
export function stagesRevisionKey(model: Pick<RunModel, 'stages'>): string {
  return model.stages
    .map((s) => `${s.index}:${s.status}:${s.verdict ?? ''}:${s.endedAt ?? ''}:${s.samples?.length ?? 0}`)
    .join(',');
}

export function feedRevisionKey(model: Pick<RunModel, 'stages' | 'decisions' | 'containment'>): string {
  const s = stagesRevisionKey(model);
  const d = model.decisions.map((x) => `${x.stageIdx}:${x.decision}:${x.source}:${x.reasonWithheld ? 1 : 0}`).join(',');
  return `${s}|d:${d}|c:${model.containment.length}`;
}

export function auditRevisionKey(model: RunModel): string {
  const f = feedRevisionKey(model);
  return `${model.run.status}:${model.run.statusReason ?? ''}:${model.run.endedAt ?? ''}|${f}|mc:${model.modelCalls.length}`;
}

export function buildAuditLogModel(model: RunModel): AuditLogModel {
  const report = isTerminal(model.run.status) ? model.report : null;
  const planHash = model.run.planHash ?? report?.planHash ?? null;
  const planName = model.plan?.name ?? report?.planName ?? null;
  const target = model.plan?.target ?? report?.target ?? null;
  const stopThresholds = model.plan?.stopThresholds ?? report?.thresholds ?? null;
  const hasApproval = planHash !== null || model.plan !== null;

  const decisions: AuditDecisionItem[] = [...model.decisions]
    .sort((a, b) => a.stageIdx - b.stageIdx)
    .map((d) => ({
      stageIndex: d.stageIdx,
      stageNumber: d.stageIdx + 1,
      stageLabel: `Stage ${d.stageIdx + 1}`,
      decision: d.decision,
      decisionTone: d.decision === 'continue' ? 'ok' : 'warn',
      source: d.source,
      sourceLabel: d.source === 'agent' ? 'supervisor (AI)' : 'fixed fallback rule',
      reason: d.reason,
      reasonWithheld: d.reasonWithheld,
      withheldNote: d.reasonWithheld ? AI_WITHHELD_NOTE : null,
    }));

  const containment: AuditContainmentItem[] = [...model.containment]
    .sort((a, b) => a.ts - b.ts || a.id - b.id)
    .map((e) => {
      const targetHost =
        e.host !== undefined
          ? e.port !== undefined
            ? `${e.host}:${e.port}`
            : e.host
          : e.port !== undefined
            ? `port ${e.port}`
            : null;
      return {
        id: e.id,
        ts: e.ts,
        utc: fmtUtc(e.ts),
        type: e.type,
        label: containmentLabel(e.type),
        warn: isWarnContainment(e.type),
        target: targetHost,
        stageNumber: e.stageIdx !== null ? e.stageIdx + 1 : null,
        scopeLabel: e.stageIdx !== null ? `Stage ${e.stageIdx + 1}` : 'Run',
      };
    });

  return {
    gate: {
      verdictLabel: hasApproval ? 'Accepted by Policy Gate' : 'Not recorded',
      verdictTone: hasApproval ? 'ok' : 'neutral',
      runId: model.run.id,
      status: model.run.status,
      statusReason: model.run.statusReason === null ? null : plainReason(model.run.statusReason),
      planName,
      planHash,
      target,
      stopThresholds,
      runtime: model.run.runtime,
      startedAtUtc: fmtUtc(model.run.startedAt),
      endedAtUtc: model.run.endedAt !== null ? fmtUtc(model.run.endedAt) : null,
    },
    decisions,
    containment,
    modelCalls: model.modelCalls,
  };
}
