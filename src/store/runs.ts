import type { Database } from 'bun:sqlite';
import type {
  DecisionSource,
  DecisionValue,
  EventType,
  RunKind,
  RunStatus,
  SandboxRuntime,
  StageMetrics,
  StageSample,
  StageStatus,
  StageVerdict,
} from '../types.ts';

export type AgentName = 'planner' | 'supervisor' | 'reporter';
export type ModelOutcome = 'success' | 'error' | 'timeout';
/** State of the AI section of a stored report. */
export type ReportAiStatus = 'pending' | 'ready' | 'unavailable';

export type RunVisibility = 'public' | 'private';

export interface RunRow {
  id: string;
  kind: RunKind;
  planHash: string | null;
  status: RunStatus;
  statusReason: string | null;
  runtime: SandboxRuntime;
  startedAt: number;
  endedAt: number | null;
  /** Parsed JSON, probe runs only. */
  probeResult: unknown;
  ownerUserId: string | null;
  visibility: RunVisibility;
  /** Null on rows created before titles were stored. */
  title: string | null;
}

export interface NewRun {
  id: string;
  kind: RunKind;
  planHash: string | null;
  status?: 'running' | 'queued';
  runtime: SandboxRuntime;
  startedAt: number;
  ownerUserId?: string | null;
  visibility?: RunVisibility;
  title?: string | null;
}

export interface StageRow {
  runId: string;
  idx: number;
  vus: number;
  durationSec: number;
  status: StageStatus;
  errorReason: string | null;
  metrics: StageMetrics | null;
  verdict: StageVerdict | null;
  generatorSaturated: boolean | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface DecisionRow {
  runId: string;
  stageIdx: number;
  decision: DecisionValue;
  source: DecisionSource;
  reason: string;
  reasonWithheld: boolean;
}

export interface NewEvent {
  type: EventType;
  runId: string;
  stageIdx?: number;
  /** Any JSON-serialisable value. */
  payload?: unknown;
  ts: number;
}

export interface StoredEvent {
  /** SSE event id. */
  id: number;
  type: EventType;
  runId: string;
  stageIdx?: number;
  payload: unknown;
  ts: number;
}

export interface ReportRow {
  runId: string;
  /** Parsed JSON of the Capacity_Report body. */
  body: unknown;
  /** Parsed JSON of the AI section, or null. */
  ai: unknown;
  aiStatus: ReportAiStatus;
}

export interface NewModelCall {
  draftId?: string;
  runId?: string;
  agent: AgentName;
  model: string;
  outcome: ModelOutcome;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  ts: number;
}

export interface ModelCallRow {
  id: number;
  draftId: string | null;
  runId: string | null;
  agent: AgentName;
  model: string;
  outcome: ModelOutcome;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  ts: number;
}

interface RawRun {
  id: string;
  kind: RunKind;
  plan_hash: string | null;
  status: RunStatus;
  status_reason: string | null;
  runtime: SandboxRuntime;
  started_at: number;
  ended_at: number | null;
  probe_result: string | null;
  owner_user_id: string | null;
  visibility: RunVisibility;
  title: string | null;
}

interface RawStage {
  run_id: string;
  idx: number;
  vus: number;
  duration_sec: number;
  status: StageStatus;
  error_reason: string | null;
  metrics: string | null;
  verdict: StageVerdict | null;
  generator_saturated: number | null;
  started_at: number | null;
  ended_at: number | null;
}

interface RawDecision {
  run_id: string;
  stage_idx: number;
  decision: DecisionValue;
  source: DecisionSource;
  reason: string;
  reason_withheld: number;
}

interface RawEvent {
  id: number;
  run_id: string;
  type: EventType;
  stage_idx: number | null;
  payload: string | null;
  ts: number;
}

interface RawReport {
  run_id: string;
  body: string;
  ai: string | null;
  ai_status: ReportAiStatus;
}

interface RawModelCall {
  id: number;
  draft_id: string | null;
  run_id: string | null;
  agent: AgentName;
  model: string;
  outcome: ModelOutcome;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  ts: number;
}

interface TsRow {
  ts: number;
}

interface CountRow {
  n: number;
}

const RUN_COLS =
  'id, kind, plan_hash, status, status_reason, runtime, started_at, ended_at, probe_result, owner_user_id, visibility, title';

function parseJson(text: string | null): unknown {
  return text === null ? null : (JSON.parse(text) as unknown);
}

function toRun(r: RawRun): RunRow {
  return {
    id: r.id,
    kind: r.kind,
    planHash: r.plan_hash,
    status: r.status,
    statusReason: r.status_reason,
    runtime: r.runtime,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    probeResult: parseJson(r.probe_result),
    ownerUserId: r.owner_user_id,
    visibility: r.visibility ?? 'public',
    title: r.title,
  };
}

function toStage(r: RawStage): StageRow {
  return {
    runId: r.run_id,
    idx: r.idx,
    vus: r.vus,
    durationSec: r.duration_sec,
    status: r.status,
    errorReason: r.error_reason,
    metrics: parseJson(r.metrics) as StageMetrics | null,
    verdict: r.verdict,
    generatorSaturated: r.generator_saturated === null ? null : r.generator_saturated !== 0,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

function toEvent(r: RawEvent): StoredEvent {
  return {
    id: r.id,
    type: r.type,
    runId: r.run_id,
    ...(r.stage_idx !== null ? { stageIdx: r.stage_idx } : {}),
    payload: parseJson(r.payload),
    ts: r.ts,
  };
}

function toModelCall(r: RawModelCall): ModelCallRow {
  return {
    id: r.id,
    draftId: r.draft_id,
    runId: r.run_id,
    agent: r.agent,
    model: r.model,
    outcome: r.outcome,
    latencyMs: r.latency_ms,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    ts: r.ts,
  };
}

/** Persistence operations for runs, stages, samples, decisions, events, reports, model calls, and listeners. */
export class RunsStore {
  private readonly runListeners = new Map<string, Set<() => void>>();

  constructor(private readonly db: Database) {}

  /** Subscribe to new events or status transitions for a run; returns an unsubscribe callback. */
  onRunUpdate(runId: string, listener: () => void): () => void {
    let set = this.runListeners.get(runId);
    if (set === undefined) {
      set = new Set();
      this.runListeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.runListeners.delete(runId);
    };
  }

  private notifyRun(runId: string): void {
    const set = this.runListeners.get(runId);
    if (set === undefined) return;
    for (const fn of [...set]) {
      try {
        fn();
      } catch {
        // Listener failures must not break DB writes.
      }
    }
  }

  /** Notify SSE listeners of all currently queued runs (e.g. after a dequeue or cancel). */
  private notifyQueuedRuns(): void {
    const rows = this.db.prepare<{ id: string }, []>("SELECT id FROM runs WHERE status = 'queued'").all();
    for (const r of rows) this.notifyRun(r.id);
  }

  /** Inserts a run (default `running`). Does not check the run slot; use admitStart for that. */
  createRun(run: NewRun): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, kind, plan_hash, status, runtime, started_at, owner_user_id, visibility, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.kind,
        run.planHash,
        run.status ?? 'running',
        run.runtime,
        run.startedAt,
        run.ownerUserId ?? null,
        run.visibility ?? 'public',
        run.title ?? null,
      );
  }

  /**
   * Claim unowned public runs for a user. Skips missing, private, or already-owned runs.
   * Never flips visibility. Returns the ids that changed.
   */
  claimPublicRuns(userId: string, runIds: readonly string[]): string[] {
    const claimed: string[] = [];
    this.db
      .transaction(() => {
        const update = this.db.prepare(
          `UPDATE runs SET owner_user_id = ?
           WHERE id = ? AND visibility = 'public'
             AND owner_user_id IS NULL`,
        );
        for (const id of runIds) {
          const res = update.run(userId, id);
          if (res.changes > 0) claimed.push(id);
        }
      })
      .immediate();
    return claimed;
  }

  getRun(id: string): RunRow | null {
    const r = this.db.prepare<RawRun, [string]>(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(id);
    return r ? toRun(r) : null;
  }

  /**
   * Moves a run out of `running`. Only a run that is currently `running` changes
   * (so a `stopped` run is never overwritten by a late `failed`). Returns whether
   * a row changed.
   */
  setRunStatus(
    id: string,
    status: Exclude<RunStatus, 'running' | 'queued'>,
    reason: string | null,
    endedAt: number,
  ): boolean {
    const res = this.db
      .prepare("UPDATE runs SET status = ?, status_reason = ?, ended_at = ? WHERE id = ? AND status = 'running'")
      .run(status, reason, endedAt, id);
    if (res.changes > 0) this.notifyRun(id);
    return res.changes > 0;
  }

  setProbeResult(id: string, result: unknown): void {
    this.db.prepare('UPDATE runs SET probe_result = ? WHERE id = ?').run(JSON.stringify(result), id);
  }

  /** The run or probe with status `running`, if any. */
  getActiveRun(): RunRow | null {
    const r = this.db
      .prepare<RawRun, []>(`SELECT ${RUN_COLS} FROM runs WHERE status = 'running' ORDER BY started_at LIMIT 1`)
      .get();
    return r ? toRun(r) : null;
  }

  /** Number of runs currently waiting in the FIFO queue. */
  countQueuedRuns(): number {
    return this.db.prepare<CountRow, []>("SELECT COUNT(*) AS n FROM runs WHERE status = 'queued'").get()?.n ?? 0;
  }

  /** 1-based FIFO queue position for a `queued` run, or null otherwise. */
  getQueuePosition(id: string): number | null {
    const row = this.db
      .prepare<{ rowid: number; started_at: number; status: string }, [string]>(
        'SELECT rowid, started_at, status FROM runs WHERE id = ?',
      )
      .get(id);
    if (!row || row.status !== 'queued') return null;
    const count = this.db
      .prepare<CountRow, [number, number, number]>(
        `SELECT COUNT(*) AS n FROM runs
         WHERE status = 'queued'
           AND (started_at < ? OR (started_at = ? AND rowid <= ?))`,
      )
      .get(row.started_at, row.started_at, row.rowid);
    return count?.n ?? 1;
  }

  /**
   * Atomically promotes the oldest `queued` run to `running` if no run is active.
   * Returns the promoted RunRow, or null when a run is active or the queue is empty.
   */
  claimNextQueuedRun(startedAt: number): RunRow | null {
    const claimed = this.db
      .transaction((): RunRow | null => {
        if (this.getActiveRun() !== null) return null;
        const r = this.db
          .prepare<RawRun, []>(
            `SELECT ${RUN_COLS} FROM runs WHERE status = 'queued' ORDER BY started_at ASC, rowid ASC LIMIT 1`,
          )
          .get();
        if (!r) return null;
        const res = this.db
          .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
          .run(startedAt, r.id);
        if (res.changes === 0) return null;
        return toRun({ ...r, status: 'running', started_at: startedAt });
      })
      .immediate();
    if (claimed !== null) {
      this.notifyRun(claimed.id);
      this.notifyQueuedRuns();
    }
    return claimed;
  }

  /** Cancels a `queued` run before it starts. Returns whether a row changed. */
  stopQueuedRun(id: string, endedAt: number): boolean {
    const res = this.db
      .prepare("UPDATE runs SET status = 'stopped', status_reason = NULL, ended_at = ? WHERE id = ? AND status = 'queued'")
      .run(endedAt, id);
    if (res.changes > 0) {
      this.notifyRun(id);
      this.notifyQueuedRuns();
    }
    return res.changes > 0;
  }

  /** Newest first, `limit` defaults to 20. */
  listRunsForPlan(planHash: string, limit = 20): RunRow[] {
    return this.db
      .prepare<RawRun, [string, number]>(
        `SELECT ${RUN_COLS} FROM runs WHERE plan_hash = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(planHash, limit)
      .map(toRun);
  }

  /** Newest first runs owned by the user (claimed or started while signed in). */
  listRunsForOwner(userId: string, limit = 50): RunRow[] {
    return this.db
      .prepare<RawRun, [string, number]>(
        `SELECT ${RUN_COLS} FROM runs WHERE owner_user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(userId, limit)
      .map(toRun);
  }

  /** Most recent finished public demo run (`completed` or `halted`) that has a saved report, or null. */
  getLatestPublicCompletedRunId(): string | null {
    const row = this.db
      .prepare<{ id: string }, []>(
        `SELECT r.id FROM runs r
         JOIN reports rep ON rep.run_id = r.id
         WHERE r.visibility = 'public' AND r.kind = 'run' AND r.status IN ('completed', 'halted')
         ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`,
      )
      .get();
    return row?.id ?? null;
  }

  /** Runs and probes with `started_at >= sinceMs`. Pass the UTC day start for the daily limit. */
  countRunsStartedSince(sinceMs: number): number {
    return (
      this.db.prepare<CountRow, [number]>('SELECT COUNT(*) AS n FROM runs WHERE started_at >= ?').get(sinceMs)?.n ?? 0
    );
  }

  /** `started_at` of every run and probe since `sinceMs`, ascending (input for dailyCheck). */
  runStartTimestampsSince(sinceMs: number): number[] {
    return this.db
      .prepare<TsRow, [number]>('SELECT started_at AS ts FROM runs WHERE started_at >= ? ORDER BY started_at')
      .all(sinceMs)
      .map((r) => r.ts);
  }

  /** Startup recovery: every `running` run becomes `interrupted`. Returns the number changed. */
  markRunningInterrupted(endedAt: number): number {
    return this.db
      .prepare(
        "UPDATE runs SET status = 'interrupted', status_reason = 'macro-api restarted', ended_at = ? WHERE status = 'running'",
      )
      .run(endedAt).changes;
  }

  // ------------------------------------------------------------------ stages

  /** Inserts the stage row as `running`, or resets an existing row for the same (run, idx). */
  startStage(stage: { runId: string; idx: number; vus: number; durationSec: number; startedAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO stages (run_id, idx, vus, duration_sec, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)
         ON CONFLICT(run_id, idx) DO UPDATE SET
           vus = excluded.vus, duration_sec = excluded.duration_sec, status = 'running',
           error_reason = NULL, metrics = NULL, verdict = NULL, generator_saturated = NULL,
           started_at = excluded.started_at, ended_at = NULL`,
      )
      .run(stage.runId, stage.idx, stage.vus, stage.durationSec, stage.startedAt);
  }

  /** Marks the stage `done` with metrics and verdict. Returns whether the row existed. */
  finishStage(stage: {
    runId: string;
    idx: number;
    metrics: StageMetrics;
    verdict: StageVerdict;
    generatorSaturated?: boolean;
    endedAt: number;
  }): boolean {
    const sat = stage.generatorSaturated === undefined ? null : stage.generatorSaturated ? 1 : 0;
    return (
      this.db
        .prepare(
          `UPDATE stages SET status = 'done', metrics = ?, verdict = ?, generator_saturated = ?, ended_at = ?
           WHERE run_id = ? AND idx = ?`,
        )
        .run(JSON.stringify(stage.metrics), stage.verdict, sat, stage.endedAt, stage.runId, stage.idx).changes > 0
    );
  }

  /** Marks the stage `error` with a reason. Returns whether the row existed. */
  failStage(stage: { runId: string; idx: number; errorReason: string; endedAt: number }): boolean {
    return (
      this.db
        .prepare("UPDATE stages SET status = 'error', error_reason = ?, ended_at = ? WHERE run_id = ? AND idx = ?")
        .run(stage.errorReason, stage.endedAt, stage.runId, stage.idx).changes > 0
    );
  }

  getStage(runId: string, idx: number): StageRow | null {
    const r = this.db
      .prepare<RawStage, [string, number]>('SELECT * FROM stages WHERE run_id = ? AND idx = ?')
      .get(runId, idx);
    return r ? toStage(r) : null;
  }

  /** All stage rows of a run in index order. */
  getStages(runId: string): StageRow[] {
    return this.db
      .prepare<RawStage, [string]>('SELECT * FROM stages WHERE run_id = ? ORDER BY idx')
      .all(runId)
      .map(toStage);
  }

  // ----------------------------------------------------------- stage samples

  /** Replaces the samples of one stage in a single transaction. */
  storeStageSamples(runId: string, stageIdx: number, samples: readonly StageSample[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO stage_samples
       (run_id, stage_idx, second, route, requests, errors, latency_sum_ms, latency_max_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db
      .transaction(() => {
        this.db.prepare('DELETE FROM stage_samples WHERE run_id = ? AND stage_idx = ?').run(runId, stageIdx);
        for (const s of samples) {
          insert.run(runId, stageIdx, s.second, s.route, s.requests, s.errors, s.latencySumMs, s.latencyMaxMs);
        }
      })
      .immediate();
  }

  /** One stage's samples ordered by second then route. Empty for stages without samples. */
  readStageSamples(runId: string, stageIdx: number): StageSample[] {
    return this.db
      .prepare<
        { second: number; route: string; requests: number; errors: number; latency_sum_ms: number; latency_max_ms: number },
        [string, number]
      >(
        `SELECT second, route, requests, errors, latency_sum_ms, latency_max_ms
         FROM stage_samples WHERE run_id = ? AND stage_idx = ? ORDER BY second, route`,
      )
      .all(runId, stageIdx)
      .map((r) => ({
        second: r.second,
        route: r.route,
        requests: r.requests,
        errors: r.errors,
        latencySumMs: r.latency_sum_ms,
        latencyMaxMs: r.latency_max_ms,
      }));
  }

  // --------------------------------------------------------------- decisions

  /** One decision per (run, stage); a repeat replaces the earlier row. */
  saveDecision(d: DecisionRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO decisions (run_id, stage_idx, decision, source, reason, reason_withheld)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(d.runId, d.stageIdx, d.decision, d.source, d.reason, d.reasonWithheld ? 1 : 0);
  }

  getDecisions(runId: string): DecisionRow[] {
    return this.db
      .prepare<RawDecision, [string]>('SELECT * FROM decisions WHERE run_id = ? ORDER BY stage_idx')
      .all(runId)
      .map((r) => ({
        runId: r.run_id,
        stageIdx: r.stage_idx,
        decision: r.decision,
        source: r.source,
        reason: r.reason,
        reasonWithheld: r.reason_withheld !== 0,
      }));
  }

  // ------------------------------------------------------------------ events

  /** Appends an event and returns its id (the SSE event id). */
  appendEvent(e: NewEvent): number {
    const res = this.db
      .prepare('INSERT INTO events (run_id, type, stage_idx, payload, ts) VALUES (?, ?, ?, ?, ?)')
      .run(
        e.runId,
        e.type,
        e.stageIdx ?? null,
        e.payload === undefined ? null : JSON.stringify(e.payload),
        e.ts,
      );
    const id = Number(res.lastInsertRowid);
    this.notifyRun(e.runId);
    return id;
  }

  /** Events of `runId` with id > afterId, ascending (SSE replay; pass 0 for all). */
  readEventsAfter(runId: string, afterId: number, limit = 1000): StoredEvent[] {
    return this.db
      .prepare<RawEvent, [string, number, number]>(
        'SELECT id, run_id, type, stage_idx, payload, ts FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?',
      )
      .all(runId, afterId, limit)
      .map(toEvent);
  }

  // ----------------------------------------------------------------- reports

  /** Inserts or replaces the report for a run. */
  saveReport(r: { runId: string; body: unknown; ai?: unknown; aiStatus: ReportAiStatus }): void {
    this.db
      .prepare('INSERT OR REPLACE INTO reports (run_id, body, ai, ai_status) VALUES (?, ?, ?, ?)')
      .run(r.runId, JSON.stringify(r.body), r.ai === undefined ? null : JSON.stringify(r.ai), r.aiStatus);
  }

  /** Sets the AI section of an existing report. Returns whether the report existed. */
  setReportAi(runId: string, ai: unknown, aiStatus: ReportAiStatus): boolean {
    return (
      this.db
        .prepare('UPDATE reports SET ai = ?, ai_status = ? WHERE run_id = ?')
        .run(ai === undefined || ai === null ? null : JSON.stringify(ai), aiStatus, runId).changes > 0
    );
  }

  getReport(runId: string): ReportRow | null {
    const r = this.db
      .prepare<RawReport, [string]>('SELECT run_id, body, ai, ai_status FROM reports WHERE run_id = ?')
      .get(runId);
    return r ? { runId: r.run_id, body: parseJson(r.body), ai: parseJson(r.ai), aiStatus: r.ai_status } : null;
  }

  // ------------------------------------------------------------- model calls

  recordModelCall(c: NewModelCall): void {
    this.db
      .prepare(
        `INSERT INTO model_calls
           (draft_id, run_id, agent, model, outcome, latency_ms, prompt_tokens, completion_tokens, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.draftId ?? null,
        c.runId ?? null,
        c.agent,
        c.model,
        c.outcome,
        Math.round(c.latencyMs),
        c.promptTokens,
        c.completionTokens,
        c.ts,
      );
  }

  listModelCallsForDraft(draftId: string): ModelCallRow[] {
    return this.db
      .prepare<RawModelCall, [string]>('SELECT * FROM model_calls WHERE draft_id = ? ORDER BY id')
      .all(draftId)
      .map(toModelCall);
  }

  listModelCallsForRun(runId: string): ModelCallRow[] {
    return this.db
      .prepare<RawModelCall, [string]>('SELECT * FROM model_calls WHERE run_id = ? ORDER BY id')
      .all(runId)
      .map(toModelCall);
  }
}
