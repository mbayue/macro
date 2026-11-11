// Start admission (requirements 5.3, 5.5, 6.13, 9.1, 9.5, 9.6, 9.9, 12.7).
// Call after Turnstile succeeded. Everything between the checks and the inserts
// runs in one synchronous transaction, so no other start can interleave.
// This module never starts a Sandbox.

import type { Config } from '../config.ts';
import type { RunVisibility, Store } from '../store/db.ts';
import type { RunKind } from '../types.ts';
import { parsePlan } from '../plan/parser.ts';
import { DAILY_MAX, START_LIMIT, dailyCheck, rollingCheck, utcDayStart } from './limits.ts';
import { PROBE_TITLE, normalizeRunTitle } from './title.ts';

export interface AdmissionDeps {
  store: Store;
  config: Pick<Config, 'sandbox'>;
  /** Run ID generator; defaults to `crypto.randomUUID()`. */
  newId?: () => string;
}

export interface StartRequest {
  kind: RunKind;
  /** Required for kind `run`; ignored for `probe`. */
  planHash?: string;
  ip: string;
  /** Epoch ms. */
  now: number;
  ownerUserId?: string | null;
  visibility?: RunVisibility;
}

export type AdmissionCode =
  | 'runtime_unavailable'
  | 'plan_not_approved'
  | 'run_active'
  | 'rate_limited'
  | 'daily_limit';

export type AdmissionResult =
  | { ok: true; runId: string }
  | {
      ok: false;
      code: AdmissionCode;
      message: string;
      retryAt?: number;
      resetAt?: number;
      /** Set for `run_active`. */
      activeRunId?: string;
    };

const PLAN_HASH_RE = /^[0-9a-f]{64}$/;

export function isPlanHash(value: unknown): value is string {
  return typeof value === 'string' && PLAN_HASH_RE.test(value);
}

/** `2026-01-31 14:05:09 UTC` */
export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export const NOT_APPROVED_MESSAGE = 'This Test_Plan is not approved. Approve the plan before starting a Run.';

function planName(text: string | undefined): string | null {
  if (text === undefined) return null;
  const parsed = parsePlan(text);
  return parsed.ok ? parsed.plan.name : null;
}

export function admitStart(deps: AdmissionDeps, req: StartRequest): AdmissionResult {
  const { store, config } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  return store.transaction((): AdmissionResult => {
    // 6.13: invalid SANDBOX_RUNTIME refuses every start.
    if (config.sandbox.runtimeError !== undefined) {
      return { ok: false, code: 'runtime_unavailable', message: config.sandbox.runtimeError };
    }

    // 5.5: Plan_Hash must be well formed and stored as approved.
    let planHash: string | null = null;
    if (req.kind === 'run') {
      if (!isPlanHash(req.planHash) || !store.hasApprovedPlan(req.planHash)) {
        return { ok: false, code: 'plan_not_approved', message: NOT_APPROVED_MESSAGE };
      }
      planHash = req.planHash;
    }

    // 9.1, 9.9, 12.7: one running Run or probe at a time.
    const active = store.getActiveRun();
    if (active !== null) {
      const message =
        active.kind === 'probe'
          ? `A Containment_Probe is in progress (Run ID ${active.id}). Wait for it to finish.`
          : `Run ${active.id} is already running. Wait for it to finish or stop it.`;
      return { ok: false, code: 'run_active', message, activeRunId: active.id };
    }

    // 9.5: per-IP rolling 6 starts / 60 minutes.
    const recent = store.clientStartTimestamps(req.ip, req.now - START_LIMIT.windowMs);
    const rolling = rollingCheck({
      timestamps: recent,
      now: req.now,
      windowMs: START_LIMIT.windowMs,
      max: START_LIMIT.max,
    });
    if (!rolling.allowed) {
      return {
        ok: false,
        code: 'rate_limited',
        message:
          `Start limit reached: at most ${START_LIMIT.max} Run or probe starts per 60 minutes per client. ` +
          `Try again after ${formatUtc(rolling.retryAt)}.`,
        retryAt: rolling.retryAt,
      };
    }

    // 9.6: 50 starts per UTC day, counted from the database so a restart does not reset it.
    const today = store.runStartTimestampsSince(utcDayStart(req.now));
    const daily = dailyCheck({ startedAtMs: today, now: req.now, max: DAILY_MAX });
    if (!daily.allowed) {
      return {
        ok: false,
        code: 'daily_limit',
        message: `The daily demo limit of ${DAILY_MAX} Runs and probes is reached. The limit resets at ${formatUtc(daily.resetAt)}.`,
        resetAt: daily.resetAt,
      };
    }

    const runId = newId();
    const title =
      req.kind === 'probe'
        ? PROBE_TITLE
        : normalizeRunTitle(planHash === null ? null : planName(store.getPlan(planHash)?.text));
    store.createRun({
      id: runId,
      kind: req.kind,
      planHash,
      runtime: config.sandbox.runtime,
      startedAt: req.now,
      ownerUserId: req.ownerUserId ?? null,
      visibility: req.visibility ?? 'public',
      title,
    });
    store.recordClientStart(req.ip, req.now);
    return { ok: true, runId };
  });
}
