// Run_Store: one SQLite file via bun:sqlite (WAL). All methods are synchronous.
// Only typed values are accepted; no secret or API key is ever written here.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AccountDraftRow,
  PendingOriginVerificationRow,
  SessionRow,
  UserRow,
  VerifiedOriginRow,
} from '../auth/types.ts';
import type { DiscoveredRoute } from '../plan/discover.ts';
import type {
  RunStatus,
  StageMetrics,
  StageSample,
  StageVerdict,
} from '../types.ts';
import { AuthStore } from './auth.ts';
import { LimitsStore } from './limits.ts';
import type { WaitlistRow } from './limits.ts';
import { PlansStore } from './plans.ts';
import type { DraftRow, PlanRow, PlanTargetRow } from './plans.ts';
import { RunsStore } from './runs.ts';
import type {
  AgentName,
  DecisionRow,
  ModelCallRow,
  ModelOutcome,
  NewEvent,
  NewModelCall,
  NewRun,
  ReportAiStatus,
  ReportRow,
  RunRow,
  RunVisibility,
  StageRow,
  StoredEvent,
} from './runs.ts';
import { configureDatabase, initializeSchema } from './schema.ts';
import { VerifyStore } from './verify.ts';

export type {
  AccountDraftRow,
  PendingOriginVerificationRow,
  SessionRow,
  UserRow,
  VerifiedOriginRow,
} from '../auth/types.ts';
export { ContestedOriginError } from '../auth/types.ts';
export { LIMIT_ROW_TTL_MS, PURGE_INTERVAL_MS } from './limits.ts';
export type { WaitlistRow } from './limits.ts';
export type { DraftRow, PlanRow, PlanTargetRow } from './plans.ts';
export type {
  AgentName,
  DecisionRow,
  ModelCallRow,
  ModelOutcome,
  NewEvent,
  NewModelCall,
  NewRun,
  ReportAiStatus,
  ReportRow,
  RunRow,
  RunVisibility,
  StageRow,
  StoredEvent,
} from './runs.ts';

/** Backward-compatible facade over the modularized SQLite persistence domains. */
export class Store {
  readonly db: Database;
  private readonly plans: PlansStore;
  private readonly runs: RunsStore;
  private readonly limits: LimitsStore;
  private readonly auth: AuthStore;
  private readonly verify: VerifyStore;

  /** @param path SQLite file path, or `:memory:`. Parent directory is created when missing. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    configureDatabase(this.db);
    initializeSchema(this.db);
    this.plans = new PlansStore(this.db);
    this.runs = new RunsStore(this.db);
    this.limits = new LimitsStore(this.db);
    this.auth = new AuthStore(this.db);
    this.verify = new VerifyStore(this.db);
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

  /** Subscribe to new events or status transitions for a run; returns an unsubscribe callback. */
  onRunUpdate(runId: string, listener: () => void): () => void {
    return this.runs.onRunUpdate(runId, listener);
  }

  // ------------------------------------------------------------------ drafts

  createDraft(draft: { id: string; trafficEvent: string; createdAt: number }): void {
    this.plans.createDraft(draft);
  }

  getDraft(id: string): DraftRow | null {
    return this.plans.getDraft(id);
  }

  latestDiscovery(origin: string): DraftRow | null {
    return this.plans.latestDiscovery(origin);
  }

  setDraftDiscovery(
    id: string,
    origin: string,
    routes: readonly DiscoveredRoute[],
    selectedIds?: readonly string[],
  ): void {
    this.plans.setDraftDiscovery(id, origin, routes, selectedIds);
  }

  storePlanTarget(row: PlanTargetRow): void {
    this.plans.storePlanTarget(row);
  }

  getPlanTarget(planHash: string): PlanTargetRow | null {
    return this.plans.getPlanTarget(planHash);
  }

  // ------------------------------------------------------------------- plans

  /**
   * Stores an approved canonical plan. Idempotent by hash: an existing row is
   * left untouched. Returns true when a new row was inserted.
   */
  storeApprovedPlan(plan: { hash: string; text: string; approvedAt: number }): boolean {
    return this.plans.storeApprovedPlan(plan);
  }

  getPlan(hash: string): PlanRow | null {
    return this.plans.getPlan(hash);
  }

  hasApprovedPlan(hash: string): boolean {
    return this.plans.hasApprovedPlan(hash);
  }

  // -------------------------------------------------------------------- runs

  /** Inserts a run (default `running`). Does not check the run slot; use admitStart for that. */
  createRun(run: NewRun): void {
    this.runs.createRun(run);
  }

  /**
   * Claim unowned public runs for a user. Skips missing, private, or already-owned runs.
   * Never flips visibility. Returns the ids that changed.
   */
  claimPublicRuns(userId: string, runIds: readonly string[]): string[] {
    return this.runs.claimPublicRuns(userId, runIds);
  }

  getRun(id: string): RunRow | null {
    return this.runs.getRun(id);
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
    return this.runs.setRunStatus(id, status, reason, endedAt);
  }

  setProbeResult(id: string, result: unknown): void {
    this.runs.setProbeResult(id, result);
  }

  /** The run or probe with status `running`, if any. */
  getActiveRun(): RunRow | null {
    return this.runs.getActiveRun();
  }

  /** Number of runs currently waiting in the FIFO queue. */
  countQueuedRuns(): number {
    return this.runs.countQueuedRuns();
  }

  /** 1-based FIFO queue position for a `queued` run, or null otherwise. */
  getQueuePosition(id: string): number | null {
    return this.runs.getQueuePosition(id);
  }

  /**
   * Atomically promotes the oldest `queued` run to `running` if no run is active.
   * Returns the promoted RunRow, or null when a run is active or the queue is empty.
   */
  claimNextQueuedRun(startedAt: number): RunRow | null {
    return this.runs.claimNextQueuedRun(startedAt);
  }

  /** Cancels a `queued` run before it starts. Returns whether a row changed. */
  stopQueuedRun(id: string, endedAt: number): boolean {
    return this.runs.stopQueuedRun(id, endedAt);
  }

  /** Newest first, `limit` defaults to 20. */
  listRunsForPlan(planHash: string, limit = 20): RunRow[] {
    return this.runs.listRunsForPlan(planHash, limit);
  }

  /** Newest first runs owned by the user (claimed or started while signed in). */
  listRunsForOwner(userId: string, limit = 50): RunRow[] {
    return this.runs.listRunsForOwner(userId, limit);
  }

  /** Most recent finished public demo run (`completed` or `halted`) that has a saved report, or null. */
  getLatestPublicCompletedRunId(): string | null {
    return this.runs.getLatestPublicCompletedRunId();
  }

  /** Runs and probes with `started_at >= sinceMs`. Pass the UTC day start for the daily limit. */
  countRunsStartedSince(sinceMs: number): number {
    return this.runs.countRunsStartedSince(sinceMs);
  }

  /** `started_at` of every run and probe since `sinceMs`, ascending (input for dailyCheck). */
  runStartTimestampsSince(sinceMs: number): number[] {
    return this.runs.runStartTimestampsSince(sinceMs);
  }

  /** Startup recovery: every `running` run becomes `interrupted`. Returns the number changed. */
  markRunningInterrupted(endedAt: number): number {
    return this.runs.markRunningInterrupted(endedAt);
  }

  // ------------------------------------------------------------------ stages

  /** Inserts the stage row as `running`, or resets an existing row for the same (run, idx). */
  startStage(stage: { runId: string; idx: number; vus: number; durationSec: number; startedAt: number }): void {
    this.runs.startStage(stage);
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
    return this.runs.finishStage(stage);
  }

  /** Marks the stage `error` with a reason. Returns whether the row existed. */
  failStage(stage: { runId: string; idx: number; errorReason: string; endedAt: number }): boolean {
    return this.runs.failStage(stage);
  }

  getStage(runId: string, idx: number): StageRow | null {
    return this.runs.getStage(runId, idx);
  }

  /** All stage rows of a run in index order. */
  getStages(runId: string): StageRow[] {
    return this.runs.getStages(runId);
  }

  // ----------------------------------------------------------- stage samples

  /** Replaces the samples of one stage in a single transaction. */
  storeStageSamples(runId: string, stageIdx: number, samples: readonly StageSample[]): void {
    this.runs.storeStageSamples(runId, stageIdx, samples);
  }

  /** One stage's samples ordered by second then route. Empty for stages without samples. */
  readStageSamples(runId: string, stageIdx: number): StageSample[] {
    return this.runs.readStageSamples(runId, stageIdx);
  }

  // --------------------------------------------------------------- decisions

  /** One decision per (run, stage); a repeat replaces the earlier row. */
  saveDecision(d: DecisionRow): void {
    this.runs.saveDecision(d);
  }

  getDecisions(runId: string): DecisionRow[] {
    return this.runs.getDecisions(runId);
  }

  // ------------------------------------------------------------------ events

  /** Appends an event and returns its id (the SSE event id). */
  appendEvent(e: NewEvent): number {
    return this.runs.appendEvent(e);
  }

  /** Events of `runId` with id > afterId, ascending (SSE replay; pass 0 for all). */
  readEventsAfter(runId: string, afterId: number, limit = 1000): StoredEvent[] {
    return this.runs.readEventsAfter(runId, afterId, limit);
  }

  // ----------------------------------------------------------------- reports

  /** Inserts or replaces the report for a run. */
  saveReport(r: { runId: string; body: unknown; ai?: unknown; aiStatus: ReportAiStatus }): void {
    this.runs.saveReport(r);
  }

  /** Sets the AI section of an existing report. Returns whether the report existed. */
  setReportAi(runId: string, ai: unknown, aiStatus: ReportAiStatus): boolean {
    return this.runs.setReportAi(runId, ai, aiStatus);
  }

  getReport(runId: string): ReportRow | null {
    return this.runs.getReport(runId);
  }

  // ------------------------------------------------------------- model calls

  recordModelCall(c: NewModelCall): void {
    this.runs.recordModelCall(c);
  }

  listModelCallsForDraft(draftId: string): ModelCallRow[] {
    return this.runs.listModelCallsForDraft(draftId);
  }

  listModelCallsForRun(runId: string): ModelCallRow[] {
    return this.runs.listModelCallsForRun(runId);
  }

  // -------------------------------------------------------------- waitlist

  /** Adds a normalised email. Returns true when it was new, false when it was already on the list. */
  addWaitlistEmail(email: string, ts: number): boolean {
    return this.limits.addWaitlistEmail(email, ts);
  }

  /** Every waitlist entry, oldest first, with the invite funnel times. */
  listWaitlist(): WaitlistRow[] {
    return this.limits.listWaitlist();
  }

  /** One waitlist row, or null. */
  getWaitlist(email: string): WaitlistRow | null {
    return this.limits.getWaitlist(email);
  }

  /** Marks the invite as sent. Overwrites the time, so a forced re-send moves it. */
  markWaitlistInvited(email: string, ts: number): void {
    this.limits.markWaitlistInvited(email, ts);
  }

  /**
   * Stamps the first sign-in after an invite. True only when the row exists, is
   * invited, and had no joined time yet.
   */
  markWaitlistJoined(email: string, ts: number): boolean {
    return this.limits.markWaitlistJoined(email, ts);
  }

  /** Removes one email (a deletion request). Returns true when a row was deleted. */
  removeWaitlistEmail(email: string): boolean {
    return this.limits.removeWaitlistEmail(email);
  }

  // ------------------------------------------------------------ limit tables

  recordPlanningRequest(ip: string, ts: number): void {
    this.limits.recordPlanningRequest(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  planningRequestTimestamps(ip: string, sinceMs: number): number[] {
    return this.limits.planningRequestTimestamps(ip, sinceMs);
  }

  recordClientStart(ip: string, ts: number): void {
    this.limits.recordClientStart(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  clientStartTimestamps(ip: string, sinceMs: number): number[] {
    return this.limits.clientStartTimestamps(ip, sinceMs);
  }

  /** Deletes planning_requests and client_starts rows older than 24 h. Returns rows deleted. */
  purgeOldLimitRows(now: number): number {
    return this.limits.purgeOldLimitRows(now);
  }

  /**
   * Runs `purgeOldLimitRows` every hour (timer does not keep the process alive).
   * Returns a function that stops the timer.
   */
  startPurgeTimer(opts: { intervalMs?: number; clock?: () => number } = {}): () => void {
    return this.limits.startPurgeTimer(opts);
  }

  // ------------------------------------------------------------------- auth

  createUser(email: string, now: number): UserRow {
    return this.auth.createUser(email, now);
  }

  findUserByEmail(email: string): UserRow | null {
    return this.auth.findUserByEmail(email);
  }

  getUser(id: string): UserRow | null {
    return this.auth.getUser(id);
  }

  /**
   * Deletes a user account, its sessions/identities/verifications/drafts (via CASCADE),
   * and all private runs owned by the user; public demo runs are unlinked.
   */
  deleteUser(userId: string): boolean {
    return this.auth.deleteUser(userId);
  }

  linkIdentity(userId: string, provider: 'email' | 'github' | 'google', providerSubject: string): void {
    this.auth.linkIdentity(userId, provider, providerSubject);
  }

  findUserByIdentity(provider: 'email' | 'github' | 'google', providerSubject: string): UserRow | null {
    return this.auth.findUserByIdentity(provider, providerSubject);
  }

  createSession(userId: string, now: number, ttlMs: number): SessionRow {
    return this.auth.createSession(userId, now, ttlMs);
  }

  getSession(id: string): SessionRow | null {
    return this.auth.getSession(id);
  }

  touchSession(id: string, now: number, ttlMs: number): SessionRow | null {
    return this.auth.touchSession(id, now, ttlMs);
  }

  deleteSession(id: string): void {
    this.auth.deleteSession(id);
  }

  createMagicLinkToken(
    userId: string | null,
    email: string,
    tokenHash: string,
    now: number,
    ttlMs: number,
  ): void {
    this.auth.createMagicLinkToken(userId, email, tokenHash, now, ttlMs);
  }

  consumeMagicLinkToken(
    tokenHash: string,
    now: number,
  ): { email: string; userId: string | null } | null {
    return this.auth.consumeMagicLinkToken(tokenHash, now);
  }

  setUserGithubLogin(userId: string, login: string | null): void {
    this.auth.setUserGithubLogin(userId, login);
  }

  // ----------------------------------------------------------------- verify

  setVerifiedOrigin(userId: string, origin: string, host: string, token: string, now: number): void {
    this.verify.setVerifiedOrigin(userId, origin, host, token, now);
  }

  clearVerifiedOrigin(userId: string): void {
    this.verify.clearVerifiedOrigin(userId);
  }

  getVerifiedOrigin(userId: string): VerifiedOriginRow | null {
    return this.verify.getVerifiedOrigin(userId);
  }

  findVerifiedOriginByHost(host: string): VerifiedOriginRow | null {
    return this.verify.findVerifiedOriginByHost(host);
  }

  setPendingOriginVerification(
    userId: string,
    origin: string,
    host: string,
    token: string,
    now: number,
  ): void {
    this.verify.setPendingOriginVerification(userId, origin, host, token, now);
  }

  getPendingOriginVerification(userId: string): PendingOriginVerificationRow | null {
    return this.verify.getPendingOriginVerification(userId);
  }

  clearPendingOriginVerification(userId: string): void {
    this.verify.clearPendingOriginVerification(userId);
  }

  getAccountDraft(userId: string): AccountDraftRow | null {
    return this.verify.getAccountDraft(userId);
  }

  /**
   * Store the draft when client lastEditedAt is >= stored (equal → body wins).
   * Returns `{ stored }` on accept, or `{ conflict: existing }` when the server draft is newer.
   */
  putAccountDraft(
    userId: string,
    draft: Omit<AccountDraftRow, 'userId'>,
  ): { stored: AccountDraftRow } | { conflict: AccountDraftRow } {
    return this.verify.putAccountDraft(userId, draft);
  }
}
