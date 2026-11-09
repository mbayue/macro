// Run_Store: one SQLite file via bun:sqlite (WAL). All methods are synchronous.
// Only typed values are accepted; no secret or API key is ever written here.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DecisionSource,
  DecisionValue,
  EventType,
  RunKind,
  RunStatus,
  SandboxRuntime,
  StageMetrics,
  StageStatus,
  StageVerdict,
} from '../types.ts';

export const LIMIT_ROW_TTL_MS = 24 * 3_600_000;
export const PURGE_INTERVAL_MS = 3_600_000;

export type AgentName = 'planner' | 'supervisor' | 'reporter';
export type ModelOutcome = 'success' | 'error' | 'timeout';
/** State of the AI section of a stored report. */
export type ReportAiStatus = 'pending' | 'ready' | 'unavailable';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, traffic_event TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plans (hash TEXT PRIMARY KEY, text TEXT NOT NULL, approved_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('run','probe')),
  plan_hash TEXT REFERENCES plans(hash), status TEXT NOT NULL, status_reason TEXT,
  runtime TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  probe_result TEXT
);
CREATE INDEX IF NOT EXISTS runs_plan ON runs(plan_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at);
CREATE TABLE IF NOT EXISTS stages (
  run_id TEXT NOT NULL, idx INTEGER NOT NULL, vus INTEGER NOT NULL, duration_sec INTEGER NOT NULL,
  status TEXT NOT NULL, error_reason TEXT, metrics TEXT, verdict TEXT,
  generator_saturated INTEGER, started_at INTEGER, ended_at INTEGER,
  PRIMARY KEY (run_id, idx)
);
CREATE TABLE IF NOT EXISTS decisions (
  run_id TEXT NOT NULL, stage_idx INTEGER NOT NULL, decision TEXT NOT NULL,
  source TEXT NOT NULL, reason TEXT NOT NULL, reason_withheld INTEGER NOT NULL,
  PRIMARY KEY (run_id, stage_idx)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL,
  stage_idx INTEGER, payload TEXT, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY, body TEXT NOT NULL, ai TEXT, ai_status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id TEXT, run_id TEXT, agent TEXT NOT NULL,
  model TEXT NOT NULL, outcome TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER, completion_tokens INTEGER, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS planning_requests (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS client_starts (ip TEXT NOT NULL, ts INTEGER NOT NULL);
`;

// ---------------------------------------------------------------- public types

export interface DraftRow {
  id: string;
  trafficEvent: string;
  createdAt: number;
}

export interface PlanRow {
  hash: string;
  text: string;
  approvedAt: number;
}

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
}

export interface NewRun {
  id: string;
  kind: RunKind;
  planHash: string | null;
  runtime: SandboxRuntime;
  startedAt: number;
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

// ------------------------------------------------------------------ raw rows

interface RawDraft { id: string; traffic_event: string; created_at: number }
interface RawPlan { hash: string; text: string; approved_at: number }
interface RawRun {
  id: string; kind: RunKind; plan_hash: string | null; status: RunStatus; status_reason: string | null;
  runtime: SandboxRuntime; started_at: number; ended_at: number | null; probe_result: string | null;
}
interface RawStage {
  run_id: string; idx: number; vus: number; duration_sec: number; status: StageStatus;
  error_reason: string | null; metrics: string | null; verdict: StageVerdict | null;
  generator_saturated: number | null; started_at: number | null; ended_at: number | null;
}
interface RawDecision {
  run_id: string; stage_idx: number; decision: DecisionValue; source: DecisionSource;
  reason: string; reason_withheld: number;
}
interface RawEvent {
  id: number; run_id: string; type: EventType; stage_idx: number | null; payload: string | null; ts: number;
}
interface RawReport { run_id: string; body: string; ai: string | null; ai_status: ReportAiStatus }
interface RawModelCall {
  id: number; draft_id: string | null; run_id: string | null; agent: AgentName; model: string;
  outcome: ModelOutcome; latency_ms: number; prompt_tokens: number | null; completion_tokens: number | null; ts: number;
}
interface TsRow { ts: number }
interface CountRow { n: number }

const RUN_COLS =
  'id, kind, plan_hash, status, status_reason, runtime, started_at, ended_at, probe_result';

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

// --------------------------------------------------------------------- Store

export class Store {
  readonly db: Database;

  /** @param path SQLite file path, or `:memory:`. Parent directory is created when missing. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  /** Opens `${dataDir}/macro.db`. */
  static open(dataDir: string): Store {
    return new Store(join(dataDir, 'macro.db'));
  }

  close(): void {
    this.db.close();
  }

  /**
   * Runs `fn` in one write transaction (BEGIN IMMEDIATE; rolls back if `fn` throws).
   * `fn` must be synchronous; this is what makes check-and-insert admission atomic.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  // ------------------------------------------------------------------ drafts

  createDraft(draft: { id: string; trafficEvent: string; createdAt: number }): void {
    this.db
      .prepare('INSERT INTO drafts (id, traffic_event, created_at) VALUES (?, ?, ?)')
      .run(draft.id, draft.trafficEvent, draft.createdAt);
  }

  getDraft(id: string): DraftRow | null {
    const r = this.db
      .prepare<RawDraft, [string]>('SELECT id, traffic_event, created_at FROM drafts WHERE id = ?')
      .get(id);
    return r ? { id: r.id, trafficEvent: r.traffic_event, createdAt: r.created_at } : null;
  }

  // ------------------------------------------------------------------- plans

  /**
   * Stores an approved canonical plan. Idempotent by hash: an existing row is
   * left untouched. Returns true when a new row was inserted.
   */
  storeApprovedPlan(plan: { hash: string; text: string; approvedAt: number }): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO plans (hash, text, approved_at) VALUES (?, ?, ?)')
      .run(plan.hash, plan.text, plan.approvedAt);
    return res.changes > 0;
  }

  getPlan(hash: string): PlanRow | null {
    const r = this.db
      .prepare<RawPlan, [string]>('SELECT hash, text, approved_at FROM plans WHERE hash = ?')
      .get(hash);
    return r ? { hash: r.hash, text: r.text, approvedAt: r.approved_at } : null;
  }

  hasApprovedPlan(hash: string): boolean {
    return (
      this.db.prepare<CountRow, [string]>('SELECT COUNT(*) AS n FROM plans WHERE hash = ?').get(hash)?.n === 1
    );
  }

  // -------------------------------------------------------------------- runs

  /** Inserts a run with status `running`. Does not check the run slot; use admitStart for that. */
  createRun(run: NewRun): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, kind, plan_hash, status, runtime, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(run.id, run.kind, run.planHash, run.runtime, run.startedAt);
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
  setRunStatus(id: string, status: Exclude<RunStatus, 'running'>, reason: string | null, endedAt: number): boolean {
    const res = this.db
      .prepare("UPDATE runs SET status = ?, status_reason = ?, ended_at = ? WHERE id = ? AND status = 'running'")
      .run(status, reason, endedAt, id);
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

  /** Newest first, `limit` defaults to 20. */
  listRunsForPlan(planHash: string, limit = 20): RunRow[] {
    return this.db
      .prepare<RawRun, [string, number]>(
        `SELECT ${RUN_COLS} FROM runs WHERE plan_hash = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(planHash, limit)
      .map(toRun);
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
    return Number(res.lastInsertRowid);
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

  // ------------------------------------------------------------ limit tables

  // -------------------------------------------------------------- waitlist

  /** Adds a normalised email. Returns true when it was new, false when it was already on the list. */
  addWaitlistEmail(email: string, ts: number): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').run(email, ts).changes > 0;
  }

  /** Every waitlist entry, oldest first. */
  listWaitlist(): { email: string; createdAt: number }[] {
    return this.db
      .prepare<{ email: string; created_at: number }, []>('SELECT email, created_at FROM waitlist ORDER BY created_at, email')
      .all()
      .map((r) => ({ email: r.email, createdAt: r.created_at }));
  }

  /** Removes one email (a deletion request). Returns true when a row was deleted. */
  removeWaitlistEmail(email: string): boolean {
    return this.db.prepare('DELETE FROM waitlist WHERE email = ?').run(email).changes > 0;
  }

  recordPlanningRequest(ip: string, ts: number): void {
    this.db.prepare('INSERT INTO planning_requests (ip, ts) VALUES (?, ?)').run(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  planningRequestTimestamps(ip: string, sinceMs: number): number[] {
    return this.db
      .prepare<TsRow, [string, number]>('SELECT ts FROM planning_requests WHERE ip = ? AND ts > ? ORDER BY ts')
      .all(ip, sinceMs)
      .map((r) => r.ts);
  }

  recordClientStart(ip: string, ts: number): void {
    this.db.prepare('INSERT INTO client_starts (ip, ts) VALUES (?, ?)').run(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  clientStartTimestamps(ip: string, sinceMs: number): number[] {
    return this.db
      .prepare<TsRow, [string, number]>('SELECT ts FROM client_starts WHERE ip = ? AND ts > ? ORDER BY ts')
      .all(ip, sinceMs)
      .map((r) => r.ts);
  }

  /** Deletes planning_requests and client_starts rows older than 24 h. Returns rows deleted. */
  purgeOldLimitRows(now: number): number {
    const cutoff = now - LIMIT_ROW_TTL_MS;
    return this.transaction(() => {
      const a = this.db.prepare('DELETE FROM planning_requests WHERE ts < ?').run(cutoff).changes;
      const b = this.db.prepare('DELETE FROM client_starts WHERE ts < ?').run(cutoff).changes;
      return a + b;
    });
  }

  /**
   * Runs `purgeOldLimitRows` every hour (timer does not keep the process alive).
   * Returns a function that stops the timer.
   */
  startPurgeTimer(opts: { intervalMs?: number; clock?: () => number } = {}): () => void {
    const clock = opts.clock ?? Date.now;
    const timer = setInterval(() => {
      try {
        this.purgeOldLimitRows(clock());
      } catch (err) {
        console.error('limit-row purge failed:', err instanceof Error ? err.message : 'unknown error');
      }
    }, opts.intervalMs ?? PURGE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
