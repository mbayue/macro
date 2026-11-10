// Run_Store: one SQLite file via bun:sqlite (WAL). All methods are synchronous.
// Only typed values are accepted; no secret or API key is ever written here.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ContestedOriginError } from '../auth/types.ts';
import type {
  AccountDraftRow,
  PendingOriginVerificationRow,
  SessionRow,
  UserRow,
  VerifiedOriginRow,
} from '../auth/types.ts';
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

export type {
  AccountDraftRow,
  PendingOriginVerificationRow,
  SessionRow,
  UserRow,
  VerifiedOriginRow,
} from '../auth/types.ts';
export { ContestedOriginError } from '../auth/types.ts';

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
  probe_result TEXT,
  owner_user_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))
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
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL UNIQUE,
  github_login TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('email','github')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user ON auth_identities(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS verified_origins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  host TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  token TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_origin_verifications (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  host TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_drafts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  traffic_event TEXT NOT NULL,
  target_mode TEXT NOT NULL CHECK (target_mode IN ('demo','own')),
  target_origin TEXT,
  last_edited_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
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
}

export interface NewRun {
  id: string;
  kind: RunKind;
  planHash: string | null;
  runtime: SandboxRuntime;
  startedAt: number;
  ownerUserId?: string | null;
  visibility?: RunVisibility;
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
  owner_user_id: string | null; visibility: RunVisibility;
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
interface RawUser {
  id: string;
  primary_email: string;
  github_login: string | null;
  created_at: number;
}
interface RawSession {
  id: string;
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}
interface RawVerifiedOrigin {
  user_id: string;
  origin: string;
  host: string;
  verified_at: number;
  token: string;
}
interface RawPendingOriginVerification {
  user_id: string;
  origin: string;
  host: string;
  token: string;
  created_at: number;
}
interface RawAccountDraft {
  user_id: string;
  traffic_event: string;
  target_mode: 'demo' | 'own';
  target_origin: string | null;
  last_edited_at: number;
}

const RUN_COLS =
  'id, kind, plan_hash, status, status_reason, runtime, started_at, ended_at, probe_result, owner_user_id, visibility';

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

function toUser(r: RawUser): UserRow {
  return {
    id: r.id,
    primaryEmail: r.primary_email,
    githubLogin: r.github_login,
    createdAt: r.created_at,
  };
}

function toSession(r: RawSession): SessionRow {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  };
}

function toVerifiedOrigin(r: RawVerifiedOrigin): VerifiedOriginRow {
  return {
    userId: r.user_id,
    origin: r.origin,
    host: r.host,
    verifiedAt: r.verified_at,
    token: r.token,
  };
}

function toPendingOriginVerification(r: RawPendingOriginVerification): PendingOriginVerificationRow {
  return {
    userId: r.user_id,
    origin: r.origin,
    host: r.host,
    token: r.token,
    createdAt: r.created_at,
  };
}

function toAccountDraft(r: RawAccountDraft): AccountDraftRow {
  return {
    userId: r.user_id,
    trafficEvent: r.traffic_event,
    targetMode: r.target_mode,
    targetOrigin: r.target_origin,
    lastEditedAt: r.last_edited_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
    this.migrateRunsOwnership();
  }

  /** Add ownership columns on DBs created before account privacy. */
  private migrateRunsOwnership(): void {
    const cols = this.db
      .prepare<{ name: string }, []>('PRAGMA table_info(runs)')
      .all()
      .map((c) => c.name);
    if (!cols.includes('owner_user_id')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN owner_user_id TEXT');
    }
    if (!cols.includes('visibility')) {
      this.db.exec("ALTER TABLE runs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
    }
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
        `INSERT INTO runs (id, kind, plan_hash, status, runtime, started_at, owner_user_id, visibility)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.kind,
        run.planHash,
        run.runtime,
        run.startedAt,
        run.ownerUserId ?? null,
        run.visibility ?? 'public',
      );
  }

  /**
   * Claim public runs for a user. Skips missing / private / already-owned-by-claimant.
   * Never flips visibility. Returns the ids that changed.
   */
  claimPublicRuns(userId: string, runIds: readonly string[]): string[] {
    const claimed: string[] = [];
    this.transaction(() => {
      const update = this.db.prepare(
        `UPDATE runs SET owner_user_id = ?
         WHERE id = ? AND visibility = 'public'
           AND (owner_user_id IS NULL OR owner_user_id != ?)`,
      );
      for (const id of runIds) {
        const res = update.run(userId, id, userId);
        if (res.changes > 0) claimed.push(id);
      }
    });
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

  /** Newest first runs owned by the user (claimed or started while signed in). */
  listRunsForOwner(userId: string, limit = 50): RunRow[] {
    return this.db
      .prepare<RawRun, [string, number]>(
        `SELECT ${RUN_COLS} FROM runs WHERE owner_user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(userId, limit)
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

  // ------------------------------------------------------------------- auth

  createUser(email: string, now: number): UserRow {
    const primaryEmail = normalizeEmail(email);
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO users (id, primary_email, github_login, created_at) VALUES (?, ?, NULL, ?)')
      .run(id, primaryEmail, now);
    return { id, primaryEmail, githubLogin: null, createdAt: now };
  }

  findUserByEmail(email: string): UserRow | null {
    const r = this.db
      .prepare<RawUser, [string]>(
        'SELECT id, primary_email, github_login, created_at FROM users WHERE primary_email = ?',
      )
      .get(normalizeEmail(email));
    return r ? toUser(r) : null;
  }

  getUser(id: string): UserRow | null {
    const r = this.db
      .prepare<RawUser, [string]>('SELECT id, primary_email, github_login, created_at FROM users WHERE id = ?')
      .get(id);
    return r ? toUser(r) : null;
  }

  linkIdentity(userId: string, provider: 'email' | 'github', providerSubject: string): void {
    const subject = provider === 'email' ? normalizeEmail(providerSubject) : providerSubject;
    this.db
      .prepare(
        `INSERT INTO auth_identities (provider, provider_subject, user_id) VALUES (?, ?, ?)
         ON CONFLICT(provider, provider_subject) DO UPDATE SET user_id = excluded.user_id`,
      )
      .run(provider, subject, userId);
  }

  findUserByIdentity(provider: 'email' | 'github', providerSubject: string): UserRow | null {
    const subject = provider === 'email' ? normalizeEmail(providerSubject) : providerSubject;
    const r = this.db
      .prepare<RawUser, [string, string]>(
        `SELECT u.id, u.primary_email, u.github_login, u.created_at
         FROM auth_identities i
         JOIN users u ON u.id = i.user_id
         WHERE i.provider = ? AND i.provider_subject = ?`,
      )
      .get(provider, subject);
    return r ? toUser(r) : null;
  }

  createSession(userId: string, now: number, ttlMs: number): SessionRow {
    const id = crypto.randomUUID();
    const expiresAt = now + ttlMs;
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, userId, now, now, expiresAt);
    return { id, userId, createdAt: now, lastSeenAt: now, expiresAt };
  }

  getSession(id: string): SessionRow | null {
    const r = this.db
      .prepare<RawSession, [string]>(
        'SELECT id, user_id, created_at, last_seen_at, expires_at FROM sessions WHERE id = ?',
      )
      .get(id);
    return r ? toSession(r) : null;
  }

  touchSession(id: string, now: number, ttlMs: number): SessionRow | null {
    const expiresAt = now + ttlMs;
    const res = this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now, expiresAt, id);
    if (res.changes === 0) return null;
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  setVerifiedOrigin(userId: string, origin: string, host: string, token: string, now: number): void {
    this.transaction(() => {
      const owner = this.db
        .prepare<{ user_id: string }, [string]>('SELECT user_id FROM verified_origins WHERE host = ?')
        .get(host);
      if (owner !== null && owner.user_id !== userId) {
        throw new ContestedOriginError(host);
      }
      this.db.prepare('DELETE FROM verified_origins WHERE user_id = ?').run(userId);
      this.db
        .prepare(
          'INSERT INTO verified_origins (user_id, origin, host, verified_at, token) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, origin, host, now, token);
    });
  }

  clearVerifiedOrigin(userId: string): void {
    this.db.prepare('DELETE FROM verified_origins WHERE user_id = ?').run(userId);
  }

  getVerifiedOrigin(userId: string): VerifiedOriginRow | null {
    const r = this.db
      .prepare<RawVerifiedOrigin, [string]>(
        'SELECT user_id, origin, host, verified_at, token FROM verified_origins WHERE user_id = ?',
      )
      .get(userId);
    return r ? toVerifiedOrigin(r) : null;
  }

  findVerifiedOriginByHost(host: string): VerifiedOriginRow | null {
    const r = this.db
      .prepare<RawVerifiedOrigin, [string]>(
        'SELECT user_id, origin, host, verified_at, token FROM verified_origins WHERE host = ?',
      )
      .get(host);
    return r ? toVerifiedOrigin(r) : null;
  }

  setPendingOriginVerification(
    userId: string,
    origin: string,
    host: string,
    token: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO pending_origin_verifications (user_id, origin, host, token, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           origin = excluded.origin,
           host = excluded.host,
           token = excluded.token,
           created_at = excluded.created_at`,
      )
      .run(userId, origin, host, token, now);
  }

  getPendingOriginVerification(userId: string): PendingOriginVerificationRow | null {
    const r = this.db
      .prepare<RawPendingOriginVerification, [string]>(
        'SELECT user_id, origin, host, token, created_at FROM pending_origin_verifications WHERE user_id = ?',
      )
      .get(userId);
    return r ? toPendingOriginVerification(r) : null;
  }

  clearPendingOriginVerification(userId: string): void {
    this.db.prepare('DELETE FROM pending_origin_verifications WHERE user_id = ?').run(userId);
  }

  getAccountDraft(userId: string): AccountDraftRow | null {
    const r = this.db
      .prepare<RawAccountDraft, [string]>(
        `SELECT user_id, traffic_event, target_mode, target_origin, last_edited_at
         FROM account_drafts WHERE user_id = ?`,
      )
      .get(userId);
    return r ? toAccountDraft(r) : null;
  }

  /**
   * Store the draft when client lastEditedAt is >= stored (equal → body wins).
   * Returns `{ stored }` on accept, or `{ conflict: existing }` when the server draft is newer.
   */
  putAccountDraft(
    userId: string,
    draft: Omit<AccountDraftRow, 'userId'>,
  ): { stored: AccountDraftRow } | { conflict: AccountDraftRow } {
    return this.transaction(() => {
      const existing = this.getAccountDraft(userId);
      if (existing !== null && existing.lastEditedAt > draft.lastEditedAt) {
        return { conflict: existing };
      }
      this.db
        .prepare(
          `INSERT INTO account_drafts (user_id, traffic_event, target_mode, target_origin, last_edited_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             traffic_event = excluded.traffic_event,
             target_mode = excluded.target_mode,
             target_origin = excluded.target_origin,
             last_edited_at = excluded.last_edited_at`,
        )
        .run(userId, draft.trafficEvent, draft.targetMode, draft.targetOrigin, draft.lastEditedAt);
      return {
        stored: {
          userId,
          trafficEvent: draft.trafficEvent,
          targetMode: draft.targetMode,
          targetOrigin: draft.targetOrigin,
          lastEditedAt: draft.lastEditedAt,
        },
      };
    });
  }

  createMagicLinkToken(
    userId: string | null,
    email: string,
    tokenHash: string,
    now: number,
    ttlMs: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO magic_link_tokens (token_hash, email, user_id, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(tokenHash, normalizeEmail(email), userId, now, now + ttlMs);
  }

  consumeMagicLinkToken(
    tokenHash: string,
    now: number,
  ): { email: string; userId: string | null } | null {
    return this.transaction(() => {
      const row = this.db
        .prepare<{ email: string; user_id: string | null; expires_at: number; used_at: number | null }, [string]>(
          'SELECT email, user_id, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?',
        )
        .get(tokenHash);
      if (row === null) return null;
      if (row.used_at !== null) return null;
      if (row.expires_at < now) return null;
      this.db.prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
      return { email: row.email, userId: row.user_id };
    });
  }

  setUserGithubLogin(userId: string, login: string | null): void {
    this.db.prepare('UPDATE users SET github_login = ? WHERE id = ?').run(login, userId);
  }
}
