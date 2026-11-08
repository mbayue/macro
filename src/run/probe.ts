/**
 * Probe_Controller: runs the fixed Containment_Probe (src/k6/probe.js) once through the same
 * Sandbox path as a Stage (requirements 12.2, 12.6, 12.8, 6.14).
 *
 * The `runs` row (kind `probe`, plan_hash null, status `running`) already exists. Containment events
 * are emitted by the Sandbox_Runner itself, so this file writes only the `status` event.
 * The probe's own pass/fail lives in `runs.probe_result` (ProbeClassification);
 * the Run status is `completed` whenever the probe could be evaluated, `failed` when the
 * Sandbox infrastructure could not be created.
 */

import { join } from 'node:path';
import { classifyProbe, parseProbeLogs } from '../k6/probe-result.ts';
import type { Store } from '../store/db.ts';
import type { RunStatus } from '../types.ts';
import type { RunExecutor } from './controller.ts';

export const PROBE_STAGE_IDX = 1;
export const PROBE_DURATION_SEC = 1;
export const PROBE_INFRA_REASON = 'The Sandbox or its network could not be created, so the probe did not run.';
export const PROBE_SCRIPT_REASON = 'The probe script could not be loaded.';

export interface ProbeControllerDeps {
  store: Store;
  /** Accepted for symmetry with RunController; the probe needs no configuration of its own. */
  config?: unknown;
  executor: RunExecutor;
  now?: () => number;
  /** Test seam: supplies the probe script text instead of reading src/k6/probe.js. */
  loadScript?: () => Promise<string>;
  onRunEnded?: (runId: string, status: RunStatus) => void | Promise<void>;
  log?: (message: string) => void;
}

let cachedScript: Promise<string> | undefined;

/**
 * Reads src/k6/probe.js relative to this module (works when `src/` is copied into the image),
 * falling back to a Bun text import for bundled builds. Cached after the first success.
 */
export function loadProbeScript(): Promise<string> {
  if (cachedScript === undefined) {
    const p = (async (): Promise<string> => {
      const file = Bun.file(join(import.meta.dir, '..', 'k6', 'probe.js'));
      if (await file.exists()) return file.text();
      const specifier = '../k6/probe.js';
      const mod = (await import(specifier, { with: { type: 'text' } })) as { default?: unknown };
      if (typeof mod.default !== 'string') throw new Error('probe script is not text');
      return mod.default;
    })();
    cachedScript = p;
    p.catch(() => {
      cachedScript = undefined;
    });
  }
  return cachedScript;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface ActiveProbe {
  abort: AbortController;
  done: Promise<void>;
}

export class ProbeController {
  private readonly store: Store;
  private readonly executor: RunExecutor;
  private readonly now: () => number;
  private readonly loadScript: () => Promise<string>;
  private readonly onRunEnded: ProbeControllerDeps['onRunEnded'];
  private readonly log: (message: string) => void;
  private readonly active = new Map<string, ActiveProbe>();

  constructor(deps: ProbeControllerDeps) {
    this.store = deps.store;
    this.executor = deps.executor;
    this.now = deps.now ?? Date.now;
    this.loadScript = deps.loadScript ?? loadProbeScript;
    this.onRunEnded = deps.onRunEnded;
    this.log = deps.log ?? (() => {});
  }

  /** Schedules the probe and returns immediately. Never throws. */
  start(runId: string): void {
    try {
      if (this.active.has(runId)) return;
      const entry: ActiveProbe = { abort: new AbortController(), done: Promise.resolve() };
      this.active.set(runId, entry);
      entry.done = Promise.resolve()
        .then(() => this.execute(runId, entry))
        .catch((e: unknown) => this.log(`probe ${runId} crashed: ${errText(e)}`))
        .finally(() => {
          this.active.delete(runId);
        });
    } catch (e) {
      this.log(`probe start failed for ${runId}: ${errText(e)}`);
    }
  }

  /** Stops a running probe (status first, then abort). Returns whether the status changed. */
  stop(runId: string): boolean {
    const changed = this.finish(runId, 'stopped', null);
    this.active.get(runId)?.abort.abort();
    return changed;
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  whenDone(runId: string): Promise<void> {
    return this.active.get(runId)?.done ?? Promise.resolve();
  }

  private finish(runId: string, status: Exclude<RunStatus, 'running'>, reason: string | null): boolean {
    const changed = this.store.setRunStatus(runId, status, reason, this.now());
    if (changed) {
      this.store.appendEvent({
        type: 'status',
        runId,
        payload: reason === null ? { status } : { status, reason },
        ts: this.now(),
      });
    }
    return changed;
  }

  private async execute(runId: string, entry: ActiveProbe): Promise<void> {
    let openAttempted = false;
    try {
      const run = this.store.getRun(runId);
      if (run === null || run.status !== 'running' || run.kind !== 'probe') return;

      let script: string | undefined;
      try {
        script = await this.loadScript();
      } catch (e) {
        this.log(`probe script unavailable: ${errText(e)}`);
      }

      let stdout = '';
      let stderr = '';
      let oomKilled = false;
      let killed = false;
      let infraFailure: string | null = script === undefined ? PROBE_SCRIPT_REASON : null;

      if (script !== undefined) {
        openAttempted = true;
        try {
          await this.executor.openRun?.(runId);
          const result = await this.executor.run(
            { runId, stageIdx: PROBE_STAGE_IDX, script, durationSec: PROBE_DURATION_SEC, kind: 'probe' },
            entry.abort.signal,
          );
          oomKilled = result.oomKilled;
          killed = result.killed;
          stdout = result.logs?.stdout ?? '';
          stderr = result.logs?.stderr ?? '';
          // An `error` result with logs is a Sandbox that ran (memory-cap kill, time cap, non-zero exit):
          // classify it. Without logs, no container ran: infrastructure failure.
          if (result.status === 'error' && result.logs === undefined && !oomKilled && !killed) {
            infraFailure = PROBE_INFRA_REASON;
            this.log(`probe ${runId} infrastructure error: ${result.reason ?? 'unknown'}`);
          }
        } catch (e) {
          infraFailure = PROBE_INFRA_REASON;
          this.log(`probe ${runId} infrastructure error: ${errText(e)}`);
        }
      }

      const classification = classifyProbe(parseProbeLogs(stdout, stderr), { oomKilled, killedByMacro: killed });
      this.store.setProbeResult(runId, classification);
      if (infraFailure !== null) this.finish(runId, 'failed', infraFailure);
      else this.finish(runId, 'completed', null);
    } catch (e) {
      this.log(`probe ${runId} failed unexpectedly: ${errText(e)}`);
      try {
        this.finish(runId, 'failed', PROBE_INFRA_REASON);
      } catch (e2) {
        this.log(`could not record probe failure for ${runId}: ${errText(e2)}`);
      }
    } finally {
      if (openAttempted) {
        try {
          await this.executor.closeRun?.(runId);
        } catch (e) {
          this.log(`probe closeRun failed for ${runId}: ${errText(e)}`);
        }
      }
      if (this.onRunEnded) {
        try {
          const status = this.store.getRun(runId)?.status;
          if (status !== undefined) await this.onRunEnded(runId, status);
        } catch (e) {
          this.log(`probe onRunEnded failed for ${runId}: ${errText(e)}`);
        }
      }
    }
  }
}
