/**
 * Run_Controller: drives one approved Test_Plan through its Stages.
 *
 * One async task per Run with one AbortController. Every state change goes to
 * the Run_Store and is mirrored as an `events` row (stage_start, stage_end,
 * decision, status, report) for the SSE feed. Containment events are written
 * by the Sandbox_Runner's `emit` callback, not here.
 *
 * Status discipline: `Store.setRunStatus` only changes a `running` row, so the
 * first terminal status wins. Stop and the 15-minute timer write their status
 * BEFORE aborting the signal, and the loop re-checks `status === 'running'`
 * after every await, so a late Stage result or Supervisor answer is discarded
 * (requirements 8.9, 9.2, 9.3).
 *
 * Everything with a side effect is injectable: store, executor, clock, timers,
 * Supervisor hook, end-of-run hook.
 */

import type { StageView as ApiStageView } from '../api-types.ts';
import type { Config } from '../config.ts';
import { readSummary } from '../k6/metrics.ts';
import { generateStageScript } from '../k6/script.ts';
import { ORDER_PRODUCT_ID, PRODUCT_IDS } from '../plan/catalog.ts';
import { parsePlan } from '../plan/parser.ts';
import { evaluatePlan } from '../plan/policy.ts';
import { planHash } from '../plan/printer.ts';
import { buildReport } from '../report/build.ts';
import type { CapacityReport, ReportDecision, ReportEvent, ReportInput, ReportStageRow } from '../report/build.ts';
import { allowedNumbers, guardText } from '../report/number-guard.ts';
import type { StageExecutor } from '../sandbox/runner.ts';
import type { DiscoveredRoute } from '../plan/discover.ts';
import type { RunRow, StageRow, Store } from '../store/db.ts';
import type { ContainmentType, DecisionSource, DecisionValue, RunStatus, StageResult, TestPlan } from '../types.ts';
import { applyDecision } from './decide.ts';
import type { AgentDecision } from './decide.ts';
import { stageVerdict } from './verdict.ts';
import type { StopThresholds } from './verdict.ts';

// ---------------------------------------------------------------- constants

export const RUN_TIMEOUT_MS = 15 * 60_000;
export const SUPERVISE_TIMEOUT_MS = 30_000;

export const REASON_TIMED_OUT = 'The Run exceeded the 15-minute limit.';
export const REASON_INTERNAL = 'The Run stopped because of an internal error.';

// -------------------------------------------------------------------- types

/** Executor seam: `StageExecutor` plus the optional Run-network lifecycle (DockerStageExecutor has both). */
export type RunExecutor = StageExecutor & {
  openRun?(runId: string, allowHosts?: readonly string[]): Promise<unknown>;
  closeRun?(runId: string): Promise<unknown>;
};

export interface SuperviseContext {
  runId: string;
  /** 0-based index of the Stage that just finished. */
  stageIdx: number;
  /** Completed Stages with Stage_Metrics so far, in Stage order (includes the one that just finished). */
  stages: StageResult[];
  thresholds: StopThresholds;
  /** VU count of the next Stage. */
  nextVus: number;
  /** Aborts on Run stop, timeout, or the 30 s overall guard. */
  signal: AbortSignal;
}

/** The Supervisor_Agent hook (task 10.7). Resolve `null` for "no valid decision". */
export type SuperviseFn = (ctx: SuperviseContext) => Promise<{ decision: 'continue' | 'stop'; reason: string } | null>;

/** Cancels the timer when called. */
export type SetTimerFn = (fn: () => void, ms: number) => () => void;

export interface RunControllerDeps {
  store: Store;
  config: Config;
  executor: RunExecutor;
  now?: () => number;
  supervise?: SuperviseFn;
  /**
   * Called once per Run after its final status, report (for completed|halted|stopped|timed_out)
   * and `report` event are written. Also called for `failed` Runs, which have no report.
   * Errors are caught and logged.
   */
  onRunEnded?: (runId: string, status: RunStatus) => void | Promise<void>;
  /** Injectable timer (default: setTimeout). Used for the Run limit and the Supervisor guard. */
  setTimer?: SetTimerFn;
  runTimeoutMs?: number;
  superviseTimeoutMs?: number;
  log?: (message: string) => void;
}

interface ActiveRun {
  abort: AbortController;
  cancelTimer: () => void;
  done: Promise<void>;
}

const defaultSetTimer: SetTimerFn = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

const CONTAINMENT_TYPES: ReadonlySet<string> = new Set<ContainmentType>([
  'sandbox_created',
  'egress_blocked',
  'memory_cap_hit',
  'time_cap_hit',
  'sandbox_killed',
  'sandbox_removed',
  'runner_created',
  'runner_deleted',
]);

const MAX_EVENT_ROWS = 100_000;
const MAX_REASON_CHARS = 300;

// ------------------------------------------------------------------ helpers

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function clip(s: string): string {
  return s.length > MAX_REASON_CHARS ? `${s.slice(0, MAX_REASON_CHARS)}…` : s;
}

/** StageView (src/api-types.ts) of a stored Stage row; the payload of stage_start and stage_end. */
export function toStageViewPayload(r: StageRow): ApiStageView {
  return {
    index: r.idx,
    vus: r.vus,
    durationSec: r.durationSec,
    status: r.status,
    errorReason: r.errorReason,
    verdict: r.verdict,
    metrics: r.metrics,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

/** Stored `containment` events mapped into the `ReportInput.events` shape. */
export function containmentReportEvents(store: Store, runId: string): ReportEvent[] {
  const out: ReportEvent[] = [];
  for (const e of store.readEventsAfter(runId, 0, MAX_EVENT_ROWS)) {
    if (e.type !== 'containment') continue;
    const p = e.payload;
    if (typeof p !== 'object' || p === null) continue;
    const rec = p as Record<string, unknown>;
    const type = rec['type'];
    if (typeof type !== 'string' || !CONTAINMENT_TYPES.has(type)) continue;
    const ev: ReportEvent = { type: type as ContainmentType, stageIdx: e.stageIdx ?? null, ts: e.ts };
    if (typeof rec['host'] === 'string') ev.host = rec['host'];
    if (typeof rec['port'] === 'number') ev.port = rec['port'];
    out.push(ev);
  }
  return out;
}

function stagesForReport(rows: readonly StageRow[]): ReportStageRow[] {
  const out: ReportStageRow[] = [];
  for (const r of rows) {
    if (r.status === 'done' && r.metrics !== null && r.verdict !== null) {
      out.push({
        index: r.idx,
        vus: r.vus,
        durationSec: r.durationSec,
        status: 'done',
        metrics: r.metrics,
        verdict: r.verdict,
      });
    } else if (r.status === 'error') {
      const row: ReportStageRow = { index: r.idx, vus: r.vus, durationSec: r.durationSec, status: 'error' };
      if (r.errorReason !== null) row.errorReason = r.errorReason;
      out.push(row);
    }
    // 'running' rows are never reported: the controller closes them before the Run ends.
  }
  return out;
}

function decisionsForReport(store: Store, runId: string): ReportDecision[] {
  return store.getDecisions(runId).map((d) => ({
    stageIdx: d.stageIdx,
    decision: d.decision,
    source: d.source,
    reason: d.reason,
    reasonWithheld: d.reasonWithheld,
  }));
}

/** Plan text → verified, parsed, gate-checked plan (requirements 5.3, 5.4, 5.7). */
function loadApprovedPlan(
  store: Store,
  config: Config,
  planHashValue: string | null,
  run: RunRow,
):
  | { ok: true; plan: TestPlan; webOrigin: string; apiOrigin: string; routes: DiscoveredRoute[] | null }
  | { ok: false; reason: string } {
  if (planHashValue === null) return { ok: false, reason: 'The Run has no approved plan.' };
  const row = store.getPlan(planHashValue);
  if (row === null) return { ok: false, reason: 'The approved plan was not found in the store.' };
  if (planHash(row.text) !== planHashValue) {
    return { ok: false, reason: 'The stored plan does not match its Plan_Hash.' };
  }
  const parsed = parsePlan(row.text);
  if (!parsed.ok) return { ok: false, reason: `The stored plan no longer parses: ${clip(parsed.error.reason)}` };
  const stored = store.getPlanTarget(planHashValue);
  if (stored === null) {
    const gate = evaluatePlan(parsed.plan, config.target.allowlist);
    if (gate.status === 'rejected') {
      const summary = gate.violations.map((v) => `[${v.rule}] ${v.path}: ${v.message}`).join('; ');
      return { ok: false, reason: `The plan no longer passes the Policy_Gate: ${clip(summary)}` };
    }
    return {
      ok: true,
      plan: parsed.plan,
      webOrigin: config.target.webOrigin,
      apiOrigin: config.target.apiOrigin,
      routes: null,
    };
  }
  const verified = run.ownerUserId === null ? null : store.getVerifiedOrigin(run.ownerUserId);
  if (verified === null || verified.origin !== stored.webOrigin) {
    return { ok: false, reason: 'The verified origin changed before the run started.' };
  }
  const gate = evaluatePlan(parsed.plan, [stored.webOrigin], stored.routes);
  if (gate.status === 'rejected') {
    const summary = gate.violations.map((v) => `[${v.rule}] ${v.path}: ${v.message}`).join('; ');
    return { ok: false, reason: `The plan no longer passes the Policy_Gate: ${clip(summary)}` };
  }
  return {
    ok: true,
    plan: parsed.plan,
    webOrigin: stored.webOrigin,
    apiOrigin: stored.apiOrigin,
    routes: stored.routes,
  };
}

// --------------------------------------------------------------- controller

export class RunController {
  private readonly store: Store;
  private readonly config: Config;
  private readonly executor: RunExecutor;
  private readonly now: () => number;
  private readonly supervise: SuperviseFn | undefined;
  private readonly onRunEnded: RunControllerDeps['onRunEnded'];
  private readonly setTimer: SetTimerFn;
  private readonly runTimeoutMs: number;
  private readonly superviseTimeoutMs: number;
  private readonly log: (message: string) => void;
  private readonly active = new Map<string, ActiveRun>();

  constructor(deps: RunControllerDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.executor = deps.executor;
    this.now = deps.now ?? Date.now;
    this.supervise = deps.supervise;
    this.onRunEnded = deps.onRunEnded;
    this.setTimer = deps.setTimer ?? defaultSetTimer;
    this.runTimeoutMs = deps.runTimeoutMs ?? RUN_TIMEOUT_MS;
    this.superviseTimeoutMs = deps.superviseTimeoutMs ?? SUPERVISE_TIMEOUT_MS;
    this.log = deps.log ?? (() => {});
  }

  /**
   * Schedules `execute(runId)` and returns immediately. Admission has already inserted the
   * `running` row. Never throws. A second call for a Run that is already active is ignored.
   */
  start(runId: string): void {
    try {
      if (this.active.has(runId)) return;
      const abort = new AbortController();
      const entry: ActiveRun = { abort, cancelTimer: () => {}, done: Promise.resolve() };
      entry.cancelTimer = this.setTimer(() => {
        try {
          this.terminate(runId, 'timed_out', REASON_TIMED_OUT);
        } catch (e) {
          this.log(`timeout handler failed: ${errText(e)}`);
        }
      }, this.runTimeoutMs);
      this.active.set(runId, entry);
      entry.done = Promise.resolve()
        .then(() => this.execute(runId, entry))
        .catch((e: unknown) => this.log(`run ${runId} crashed: ${errText(e)}`));
    } catch (e) {
      this.log(`start failed for ${runId}: ${errText(e)}`);
    }
  }

  /**
   * User stop (requirement 9.2). Writes `stopped` (only if the Run is still `running`), appends the
   * status event, THEN aborts so the executor kills the Sandbox. Returns whether the status changed.
   */
  stop(runId: string): boolean {
    return this.terminate(runId, 'stopped', null);
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Resolves when the Run's task (including report and `onRunEnded`) has finished. For shutdown and tests. */
  whenDone(runId: string): Promise<void> {
    return this.active.get(runId)?.done ?? Promise.resolve();
  }

  // ----------------------------------------------------------- status writes

  private appendStatusEvent(runId: string, status: RunStatus, reason: string | null): void {
    this.store.appendEvent({
      type: 'status',
      runId,
      payload: reason === null ? { status } : { status, reason },
      ts: this.now(),
    });
  }

  /** Moves a `running` Run to a terminal status and mirrors it as an event. False when already terminal. */
  private finish(runId: string, status: Exclude<RunStatus, 'running'>, reason: string | null): boolean {
    const changed = this.store.setRunStatus(runId, status, reason, this.now());
    if (changed) this.appendStatusEvent(runId, status, reason);
    return changed;
  }

  private terminate(runId: string, status: 'stopped' | 'timed_out', reason: string | null): boolean {
    const changed = this.finish(runId, status, reason);
    this.active.get(runId)?.abort.abort(); // status first, then kill
    return changed;
  }

  private isActive(runId: string): boolean {
    return this.store.getRun(runId)?.status === 'running';
  }

  // --------------------------------------------------------------- execution

  private async execute(runId: string, entry: ActiveRun): Promise<void> {
    const state = { openAttempted: false };
    try {
      await this.drive(runId, entry.abort.signal, state);
    } catch (e) {
      this.log(`run ${runId} failed unexpectedly: ${errText(e)}`);
      try {
        this.finish(runId, 'failed', REASON_INTERNAL);
      } catch (e2) {
        this.log(`could not record failure for ${runId}: ${errText(e2)}`);
      }
    } finally {
      entry.cancelTimer();
      await this.cleanup(runId, state.openAttempted);
      this.active.delete(runId);
    }
  }

  private async cleanup(runId: string, openAttempted: boolean): Promise<void> {
    if (openAttempted) {
      try {
        await this.executor.closeRun?.(runId);
      } catch (e) {
        this.log(`closeRun failed for ${runId}: ${errText(e)}`);
      }
    }
    let status: RunStatus | undefined;
    try {
      let run = this.store.getRun(runId);
      if (run?.status === 'running') {
        // Safety net: nothing may leave a Run `running` once its task is over.
        this.finish(runId, 'failed', REASON_INTERNAL);
        run = this.store.getRun(runId);
      }
      status = run?.status;
      if (run !== null && (status === 'completed' || status === 'halted' || status === 'stopped' || status === 'timed_out')) {
        this.writeReport(run);
      }
    } catch (e) {
      this.log(`report for ${runId} failed: ${errText(e)}`);
    }
    if (status !== undefined && this.onRunEnded) {
      try {
        await this.onRunEnded(runId, status);
      } catch (e) {
        this.log(`onRunEnded failed for ${runId}: ${errText(e)}`);
      }
    }
  }

  private reportInput(
    run: RunRow,
    plan: TestPlan,
    status: RunStatus,
    withEvents: boolean,
    routeOrder: readonly string[] | null,
  ): ReportInput {
    return {
      runId: run.id,
      planHash: run.planHash ?? '',
      status,
      runtime: run.runtime,
      plan,
      stages: stagesForReport(this.store.getStages(run.id)),
      decisions: decisionsForReport(this.store, run.id),
      events: withEvents ? containmentReportEvents(this.store, run.id) : [],
      ...(routeOrder === null ? {} : { routeOrder }),
    };
  }

  private writeReport(run: RunRow): void {
    const loaded = loadApprovedPlan(this.store, this.config, run.planHash, run);
    if (!loaded.ok) {
      this.log(`no report for ${run.id}: ${loaded.reason}`);
      return;
    }
    const report = buildReport(
      this.reportInput(run, loaded.plan, run.status, true, loaded.routes?.map((r) => r.id) ?? null),
    );
    this.store.saveReport({ runId: run.id, body: report, aiStatus: 'pending' });
    this.store.appendEvent({ type: 'report', runId: run.id, payload: { ready: true }, ts: this.now() });
  }

  private async drive(runId: string, signal: AbortSignal, state: { openAttempted: boolean }): Promise<void> {
    const run = this.store.getRun(runId);
    if (run === null || run.status !== 'running') return;

    // (1) Re-check at start: hash, parse, Policy_Gate. No Sandbox on failure.
    const loaded = loadApprovedPlan(this.store, this.config, run.planHash, run);
    if (!loaded.ok) {
      this.finish(runId, 'failed', loaded.reason);
      return;
    }
    const plan = loaded.plan;
    const scriptRoutes =
      loaded.routes === null
        ? undefined
        : loaded.routes.map((r) => ({ id: r.id, role: 'web' as const, method: r.method, path: r.path }));

    // (2) Run network.
    state.openAttempted = true;
    try {
      const hosts = scriptRoutes === undefined ? undefined : [new URL(loaded.webOrigin).hostname];
      await this.executor.openRun?.(runId, hosts);
    } catch (e) {
      this.finish(runId, 'failed', `The Sandbox network could not be created: ${clip(errText(e))}`);
      return;
    }

    // (3)-(4) Stages.
    const lastIdx = plan.stages.length - 1;
    for (const [i, stage] of plan.stages.entries()) {
      if (!this.isActive(runId)) return;
      const displayIndex = i + 1;

      this.store.startStage({ runId, idx: i, vus: stage.vus, durationSec: stage.durationSec, startedAt: this.now() });
      this.appendStageEvent('stage_start', runId, i);

      const failStage = (reason: string): void => {
        this.store.failStage({ runId, idx: i, errorReason: reason, endedAt: this.now() });
        this.appendStageEvent('stage_end', runId, i);
      };

      let script: string;
      try {
        script = generateStageScript({
          runId,
          stageIndex: i,
          vus: stage.vus,
          durationSec: stage.durationSec,
          journey: plan.journey,
          origins: { web: loaded.webOrigin, api: loaded.apiOrigin },
          productIds: PRODUCT_IDS,
          orderProductId: ORDER_PRODUCT_ID,
          ...(scriptRoutes === undefined ? {} : { routes: scriptRoutes }),
        });
      } catch (e) {
        const reason = `The k6 script could not be generated: ${clip(errText(e))}`;
        failStage(reason);
        this.finish(runId, 'failed', `Stage ${displayIndex} failed: ${reason}`);
        return;
      }

      let result: Awaited<ReturnType<RunExecutor['run']>>;
      try {
        result = await this.executor.run(
          { runId, stageIdx: i, script, durationSec: stage.durationSec, kind: 'stage' },
          signal,
        );
      } catch (e) {
        result = { status: 'error', reason: `Sandbox run failed: ${clip(errText(e))}`, oomKilled: false, killed: false };
      }

      // Late result after stop/timeout: close the Stage, keep no metrics (8.9, 9.2).
      if (!this.isActive(runId)) {
        failStage(this.endedReason(runId));
        return;
      }

      if (result.status === 'error') {
        const reason = result.reason ?? 'The Sandbox reported an error.';
        failStage(reason);
        this.finish(runId, 'failed', `Stage ${displayIndex} failed: ${reason}`);
        return;
      }
      if (result.summaryJson === undefined) {
        const reason = 'k6 produced no summary.';
        failStage(reason);
        this.finish(runId, 'failed', `Stage ${displayIndex} failed: ${reason}`);
        return;
      }
      const read = readSummary(result.summaryJson, loaded.routes?.map((r) => r.id));
      if (!read.ok) {
        failStage(read.reason);
        this.finish(runId, 'failed', `Stage ${displayIndex} failed: ${read.reason}`);
        return;
      }
      const metrics = read.metrics;

      // Verdict is stored BEFORE any Supervisor call (7.5).
      const verdict = stageVerdict(metrics.overall, plan.stopThresholds);
      this.store.finishStage({ runId, idx: i, metrics, verdict, endedAt: this.now() });
      this.appendStageEvent('stage_end', runId, i);

      const isLast = i === lastIdx;

      // Supervisor (never for the last Stage, 8.7).
      let agent: AgentDecision = null;
      if (!isLast && this.supervise) {
        const next = plan.stages[i + 1];
        agent = await this.callSupervise(
          {
            runId,
            stageIdx: i,
            stages: this.completedStages(runId),
            thresholds: plan.stopThresholds,
            nextVus: next?.vus ?? 0,
          },
          signal,
        );
        if (!this.isActive(runId)) return; // discard the late answer (8.9)
      }

      const applied = applyDecision(isLast, verdict, agent);
      if (!applied.record) {
        if (applied.action === 'complete') this.finish(runId, 'completed', null);
        else this.finish(runId, 'halted', `Stage ${displayIndex} failed the Stop_Thresholds.`);
        return;
      }

      let reason = applied.reason;
      let reasonWithheld = false;
      if (applied.source === 'agent') {
        const guarded = this.guardAgentReason(run, plan, reason);
        if (!guarded.ok) {
          reason = `Decision: ${applied.decision}. Stage verdict: ${verdict}.`;
          reasonWithheld = true;
        }
      }
      this.recordDecision(runId, i, applied.decision, applied.source, reason, reasonWithheld);

      if (applied.action === 'halt') {
        this.finish(
          runId,
          'halted',
          verdict === 'fail'
            ? `Stage ${displayIndex} failed the Stop_Thresholds.`
            : `Stopped after Stage ${displayIndex} on the Supervisor_Agent's decision.`,
        );
        return;
      }
    }

    // Unreachable for a gate-accepted plan (at least one Stage); keep the Run from hanging.
    this.finish(runId, 'failed', 'The plan has no Stages.');
  }

  private endedReason(runId: string): string {
    const status = this.store.getRun(runId)?.status;
    if (status === 'stopped') return 'The Run was stopped before this Stage finished.';
    if (status === 'timed_out') return 'The Run timed out before this Stage finished.';
    return 'The Run ended before this Stage finished.';
  }

  private appendStageEvent(type: 'stage_start' | 'stage_end', runId: string, idx: number): void {
    const row = this.store.getStage(runId, idx);
    this.store.appendEvent({
      type,
      runId,
      stageIdx: idx,
      payload: row === null ? null : toStageViewPayload(row),
      ts: this.now(),
    });
  }

  private recordDecision(
    runId: string,
    stageIdx: number,
    decision: DecisionValue,
    source: DecisionSource,
    reason: string,
    reasonWithheld: boolean,
  ): void {
    this.store.saveDecision({ runId, stageIdx, decision, source, reason, reasonWithheld });
    this.store.appendEvent({
      type: 'decision',
      runId,
      stageIdx,
      payload: { stageIdx, decision, source, reason, reasonWithheld },
      ts: this.now(),
    });
  }

  /** Done Stages with Stage_Metrics, in order. */
  private completedStages(runId: string): StageResult[] {
    const out: StageResult[] = [];
    for (const r of this.store.getStages(runId)) {
      if (r.status === 'done' && r.metrics !== null && r.verdict !== null) {
        out.push({ index: r.idx, vus: r.vus, durationSec: r.durationSec, metrics: r.metrics, verdict: r.verdict });
      }
    }
    return out;
  }

  /**
   * Number_Guard on a Supervisor reason (8.8, 10.7, 10.8). Allowed_Numbers come from a partial
   * report over the Stages so far, plus every planned Stage (the reason may name the next Stage's VUs).
   */
  private guardAgentReason(run: RunRow, plan: TestPlan, reason: string): { ok: boolean } {
    const partial: CapacityReport = buildReport(this.reportInput(run, plan, 'running', false, null));
    const allowed = allowedNumbers(partial);
    for (const [i, s] of plan.stages.entries()) {
      allowed.add(i);
      allowed.add(i + 1);
      allowed.add(s.vus);
      allowed.add(s.durationSec);
    }
    return guardText(reason, allowed);
  }

  /** Calls the Supervisor hook under a 30 s overall guard. Throw, timeout, abort, or junk → null. */
  private async callSupervise(
    ctx: Omit<SuperviseContext, 'signal'>,
    runSignal: AbortSignal,
  ): Promise<AgentDecision> {
    const supervise = this.supervise;
    if (!supervise || runSignal.aborted) return null;

    const guard = new AbortController();
    const onRunAbort = (): void => guard.abort();
    runSignal.addEventListener('abort', onRunAbort, { once: true });
    const cancelTimer = this.setTimer(() => guard.abort(), this.superviseTimeoutMs);
    try {
      const aborted = new Promise<null>((resolve) => {
        if (guard.signal.aborted) resolve(null);
        else guard.signal.addEventListener('abort', () => resolve(null), { once: true });
      });
      const call = Promise.resolve()
        .then(() => supervise({ ...ctx, signal: guard.signal }))
        .catch((e: unknown) => {
          this.log(`supervisor failed for ${ctx.runId}: ${errText(e)}`);
          return null;
        });
      const raw = await Promise.race([call, aborted]);
      if (raw === null || typeof raw !== 'object') return null;
      const { decision, reason } = raw as { decision?: unknown; reason?: unknown };
      if ((decision !== 'continue' && decision !== 'stop') || typeof reason !== 'string' || reason.length === 0) {
        return null;
      }
      return { decision, reason };
    } finally {
      cancelTimer();
      runSignal.removeEventListener('abort', onRunAbort);
    }
  }
}
