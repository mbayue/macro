import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { REASON_INTERNAL, REASON_TIMED_OUT, RunController } from '../src/run/controller.ts';
import type { RunExecutor, SetTimerFn, SuperviseFn } from '../src/run/controller.ts';
import { fallbackReason } from '../src/run/decide.ts';
import { planHash, printPlan } from '../src/plan/printer.ts';
import type { StageRunResult, StageSpec } from '../src/sandbox/runner.ts';
import { Store } from '../src/store/db.ts';
import type { RunStatus, TestPlan } from '../src/types.ts';
import { planWithVus, samplePlan, storedPlan, summaryJson, testConfig } from './arb-agents.ts';

const RUN_ID = 'run-0001-abcd';
const RUN_TIMEOUT = 111_111;
const SUPERVISE_TIMEOUT = 222_222;

// ---- fakes -----------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function until(cond: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

class FakeTimers {
  readonly entries: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  readonly setTimer: SetTimerFn = (fn, ms) => {
    const entry = { fn, ms, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  /** Fires the first live timer with this delay. */
  fire(ms: number): boolean {
    const entry = this.entries.find((e) => e.ms === ms && !e.cancelled);
    if (entry === undefined) return false;
    entry.cancelled = true;
    entry.fn();
    return true;
  }
}

const done = (p95 = 200, errorRatePct = 0): StageRunResult => ({
  status: 'done',
  summaryJson: summaryJson({ p95, errorRatePct }),
  oomKilled: false,
  killed: false,
});
const errored = (reason: string): StageRunResult => ({ status: 'error', reason, oomKilled: false, killed: false });

interface SetupOptions {
  plan?: TestPlan;
  run?: (spec: StageSpec, signal: AbortSignal, n: number) => Promise<StageRunResult> | StageRunResult;
  supervise?: SuperviseFn;
  openRun?: () => Promise<unknown>;
  seed?: (store: Store) => void;
  /** Skip creating the plan/run rows (the test seeds its own). */
  noSeed?: boolean;
}

function setup(options: SetupOptions = {}) {
  const store = new Store(':memory:');
  const timers = new FakeTimers();
  const calls: StageSpec[] = [];
  const signals: AbortSignal[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const ended: { runId: string; status: RunStatus }[] = [];
  const logs: string[] = [];

  const executor: RunExecutor = {
    async run(spec, signal) {
      calls.push(spec);
      signals.push(signal);
      return (options.run ?? (() => done()))(spec, signal, calls.length);
    },
    async openRun(runId) {
      opened.push(runId);
      if (options.openRun) await options.openRun();
    },
    async closeRun(runId) {
      closed.push(runId);
    },
  };

  if (options.noSeed !== true) {
    const { hash, text } = storedPlan(options.plan ?? planWithVus([10, 20]));
    store.storeApprovedPlan({ hash, text, approvedAt: 1 });
    store.createRun({ id: RUN_ID, kind: 'run', planHash: hash, runtime: 'runsc', startedAt: 1 });
  }
  options.seed?.(store);

  let clock = 1_000;
  const controller = new RunController({
    store,
    config: testConfig(),
    executor,
    now: () => (clock += 1),
    ...(options.supervise !== undefined ? { supervise: options.supervise } : {}),
    onRunEnded: (runId, status) => {
      ended.push({ runId, status });
    },
    setTimer: timers.setTimer,
    runTimeoutMs: RUN_TIMEOUT,
    superviseTimeoutMs: SUPERVISE_TIMEOUT,
    log: (m) => logs.push(m),
  });

  const eventTypes = (): string[] => store.readEventsAfter(RUN_ID, 0).map((e) => e.type);
  const status = (): RunStatus | undefined => store.getRun(RUN_ID)?.status;
  return { store, controller, timers, calls, signals, opened, closed, ended, logs, eventTypes, status };
}

async function runToEnd(h: ReturnType<typeof setup>): Promise<void> {
  h.controller.start(RUN_ID);
  await h.controller.whenDone(RUN_ID);
}

const decideContinue: SuperviseFn = async () => ({ decision: 'continue', reason: 'Looks fine.' });

// ---- 7.5 / 8.1: ordering ----------------------------------------------------------

describe('metrics are stored before the Supervisor call', () => {
  test('Stage_Metrics, the verdict, and the stage_end event exist when the Supervisor is asked', async () => {
    let snapshot: { status: string | undefined; verdict: string | null | undefined; hasMetrics: boolean; events: string[] } | undefined;
    const holder: { h?: ReturnType<typeof setup> } = {};
    const supervise: SuperviseFn = async (ctx) => {
      const h = holder.h as ReturnType<typeof setup>;
      const row = h.store.getStage(RUN_ID, ctx.stageIdx);
      snapshot = { status: row?.status, verdict: row?.verdict, hasMetrics: row?.metrics != null, events: h.eventTypes() };
      expect(ctx.stages.map((s) => s.index)).toEqual([0]);
      expect(ctx.stages[0]?.verdict).toBe('pass');
      return { decision: 'continue', reason: 'ok' };
    };
    const h = setup({ supervise });
    holder.h = h;
    await runToEnd(h);
    expect(snapshot).toEqual({ status: 'done', verdict: 'pass', hasMetrics: true, events: ['stage_start', 'stage_end'] });
    expect(h.status()).toBe('completed');
  });

  test('the Supervisor context carries all completed Stages, the thresholds, and the next Stage VUs', async () => {
    const seen: { idx: number; indexes: number[]; next: number; thresholds: unknown }[] = [];
    const supervise: SuperviseFn = async (ctx) => {
      seen.push({ idx: ctx.stageIdx, indexes: ctx.stages.map((s) => s.index), next: ctx.nextVus, thresholds: ctx.thresholds });
      return { decision: 'continue', reason: 'ok' };
    };
    const h = setup({ plan: planWithVus([10, 20, 30]), supervise });
    await runToEnd(h);
    expect(seen).toEqual([
      { idx: 0, indexes: [0], next: 20, thresholds: { p95Ms: 1500, errorRatePct: 2 } },
      { idx: 1, indexes: [0, 1], next: 30, thresholds: { p95Ms: 1500, errorRatePct: 2 } },
    ]);
  });

  test('the next Stage starts only after the decision is recorded', async () => {
    const h = setup({ supervise: decideContinue });
    const decisionsAtStart: number[] = [];
    const original = h.store.startStage.bind(h.store);
    h.store.startStage = (stage) => {
      decisionsAtStart.push(h.store.getDecisions(RUN_ID).length);
      original(stage);
    };
    await runToEnd(h);
    expect(decisionsAtStart).toEqual([0, 1]);
  });
});

// ---- 8.7: last Stage --------------------------------------------------------------

describe('the last Stage skips the Supervisor', () => {
  test('a three-Stage Run asks twice, records two decisions, and completes', async () => {
    const asked: number[] = [];
    const h = setup({
      plan: planWithVus([10, 20, 30]),
      supervise: async (ctx) => {
        asked.push(ctx.stageIdx);
        return { decision: 'continue', reason: 'fine' };
      },
    });
    await runToEnd(h);
    expect(asked).toEqual([0, 1]);
    expect(h.status()).toBe('completed');
    expect(h.store.getDecisions(RUN_ID).map((d) => d.stageIdx)).toEqual([0, 1]);
    expect(h.calls.map((c) => c.stageIdx)).toEqual([0, 1, 2]);
  });

  test('a one-Stage Run never asks and completes', async () => {
    let asked = 0;
    const h = setup({ plan: planWithVus([10]), supervise: async () => (asked += 1, null) });
    await runToEnd(h);
    expect(asked).toBe(0);
    expect(h.status()).toBe('completed');
    expect(h.store.getDecisions(RUN_ID)).toEqual([]);
  });

  test('a failing last Stage halts without a decision record', async () => {
    let asked = 0;
    const h = setup({
      supervise: async () => (asked += 1, { decision: 'continue', reason: 'x' }),
      run: (_s, _sig, n) => (n === 1 ? done(200) : done(5000)),
    });
    await runToEnd(h);
    expect(h.status()).toBe('halted');
    expect(asked).toBe(1);
    expect(h.store.getDecisions(RUN_ID).map((d) => d.stageIdx)).toEqual([0]);
    expect(h.store.getStage(RUN_ID, 1)?.verdict).toBe('fail');
  });
});

// ---- 8.2 - 8.5: decisions ---------------------------------------------------------

describe('applying decisions', () => {
  test('a fail verdict halts whatever the Supervisor says, recorded as a fallback override', async () => {
    const h = setup({ plan: planWithVus([10, 20, 30]), supervise: decideContinue, run: () => done(5000) });
    await runToEnd(h);
    expect(h.status()).toBe('halted');
    expect(h.calls).toHaveLength(1);
    expect(h.store.getDecisions(RUN_ID)).toEqual([
      { runId: RUN_ID, stageIdx: 0, decision: 'stop', source: 'fallback', reason: fallbackReason('fail_override'), reasonWithheld: false },
    ]);
  });

  test('a pass verdict with an agent stop halts and records source agent', async () => {
    const h = setup({
      plan: planWithVus([10, 20, 30]),
      supervise: async () => ({ decision: 'stop', reason: 'Latency is climbing.' }),
    });
    await runToEnd(h);
    expect(h.status()).toBe('halted');
    expect(h.calls).toHaveLength(1);
    expect(h.store.getDecisions(RUN_ID)[0]).toMatchObject({ decision: 'stop', source: 'agent', reason: 'Latency is climbing.', reasonWithheld: false });
  });

  test.each([
    ['no Supervisor hook', undefined],
    ['a Supervisor that throws', (async () => { throw new Error('boom'); }) as SuperviseFn],
    ['a Supervisor that resolves null', (async () => null) as SuperviseFn],
    ['an invalid decision value', (async () => ({ decision: 'maybe', reason: 'x' })) as unknown as SuperviseFn],
    ['an empty reason', (async () => ({ decision: 'stop', reason: '' })) as SuperviseFn],
  ])('%s applies the verdict alone: pass continues with a fallback record', async (_label, supervise) => {
    const h = setup({ plan: planWithVus([10, 20]), ...(supervise !== undefined ? { supervise } : {}) });
    await runToEnd(h);
    expect(h.status()).toBe('completed');
    expect(h.calls).toHaveLength(2);
    const [d] = h.store.getDecisions(RUN_ID);
    // Even without a Supervisor request, applying a decision records the fixed fallback.
    expect(d).toMatchObject({ decision: 'continue', source: 'fallback', reason: fallbackReason('no_valid_decision') });
  });

  test('the 30 second guard turns a silent Supervisor into a fallback and the Run goes on', async () => {
    const never = new Promise<never>(() => {});
    const h = setup({ supervise: () => never });
    h.controller.start(RUN_ID);
    await until(() => h.timers.entries.some((e) => e.ms === SUPERVISE_TIMEOUT && !e.cancelled), 'supervise guard armed');
    expect(h.timers.fire(SUPERVISE_TIMEOUT)).toBe(true);
    await h.controller.whenDone(RUN_ID);
    expect(h.status()).toBe('completed');
    expect(h.calls).toHaveLength(2);
    expect(h.store.getDecisions(RUN_ID)[0]).toMatchObject({ decision: 'continue', source: 'fallback', reason: fallbackReason('no_valid_decision') });
  });
});

// ---- 8.8 / 10.7: Number_Guard on reasons ---------------------------------------------

describe('Number_Guard on a Supervisor reason', () => {
  test('a reason with an unverified number is replaced by the fixed sentence and marked withheld', async () => {
    const h = setup({ supervise: async () => ({ decision: 'continue', reason: 'p95 is about 987654 ms, all good' }) });
    await runToEnd(h);
    const [d] = h.store.getDecisions(RUN_ID);
    expect(d).toMatchObject({
      decision: 'continue',
      source: 'agent',
      reason: 'Decision: continue. Stage verdict: pass.',
      reasonWithheld: true,
    });
    const event = h.store.readEventsAfter(RUN_ID, 0).find((e) => e.type === 'decision');
    expect(event?.payload).toMatchObject({ reason: 'Decision: continue. Stage verdict: pass.', reasonWithheld: true });
    expect(JSON.stringify(h.store.readEventsAfter(RUN_ID, 0))).not.toContain('987654');
  });

  test('a reason quoting measured numbers is kept as written', async () => {
    const reason = 'Stage 1 ran 10 VUs with p95 200 ms, rps 33.3; next Stage uses 20 VUs.';
    const h = setup({ supervise: async () => ({ decision: 'continue', reason }) });
    await runToEnd(h);
    expect(h.store.getDecisions(RUN_ID)[0]).toMatchObject({ source: 'agent', reason, reasonWithheld: false });
  });

  test('a withheld stop reason names the stop and the verdict', async () => {
    const h = setup({ plan: planWithVus([10, 20, 30]), supervise: async () => ({ decision: 'stop', reason: 'Only 31337 left' }) });
    await runToEnd(h);
    expect(h.store.getDecisions(RUN_ID)[0]).toMatchObject({ decision: 'stop', reason: 'Decision: stop. Stage verdict: pass.', reasonWithheld: true });
  });

  test('every stored reason passes the guard: foreign numbers never survive (Property 22, Supervisor reasons)', async () => {
    // Feature: macro, Property 22: AI text shown is bounded and verified
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    const allowedNumber = fc.constantFrom('1', '2', '10', '20', '30', '100', '200', '210', '1000', '1500', '33.3', '0');
    const foreignNumber = fc.integer({ min: 1_000_000, max: 9_999_999 }).map(String);
    const reasonArb = fc
      .array(fc.oneof({ weight: 5, arbitrary: word }, { weight: 3, arbitrary: allowedNumber }, { weight: 1, arbitrary: foreignNumber }), { minLength: 1, maxLength: 40 })
      .map((parts) => parts.join(' '));
    await fc.assert(
      fc.asyncProperty(reasonArb, fc.constantFrom('continue' as const, 'stop' as const), async (reason, decision) => {
        const h = setup({ plan: planWithVus([10, 20, 30]), supervise: async () => ({ decision, reason }) });
        await runToEnd(h);
        const [d] = h.store.getDecisions(RUN_ID);
        const hasForeign = /\b\d{7}\b/.test(reason);
        if (hasForeign) {
          expect(d).toMatchObject({ reason: `Decision: ${decision}. Stage verdict: pass.`, reasonWithheld: true, source: 'agent' });
        } else {
          expect(d).toMatchObject({ reason, reasonWithheld: false, source: 'agent' });
        }
        h.store.close();
      }),
      { numRuns: 100 },
    );
  });
});

// ---- 5.4 / 5.7: approved plan re-check ----------------------------------------------

describe('the stored plan is re-checked before any Sandbox starts', () => {
  function expectNoSandbox(h: ReturnType<typeof setup>, reason: RegExp): void {
    const run = h.store.getRun(RUN_ID);
    expect(run?.status).toBe('failed');
    expect(run?.statusReason ?? '').toMatch(reason);
    expect(h.calls).toHaveLength(0);
    expect(h.opened).toEqual([]);
    expect(h.store.getStages(RUN_ID)).toEqual([]);
    expect(h.store.getReport(RUN_ID)).toBeNull();
  }

  test('a hash that does not match the stored text fails the Run', async () => {
    const { text } = storedPlan(planWithVus([10, 20]));
    const wrong = 'f'.repeat(64);
    const h = setup({
      noSeed: true,
      seed: (store) => {
        store.storeApprovedPlan({ hash: wrong, text, approvedAt: 1 });
        store.createRun({ id: RUN_ID, kind: 'run', planHash: wrong, runtime: 'runsc', startedAt: 1 });
      },
    });
    await runToEnd(h);
    expectNoSandbox(h, /does not match/);
    expect(h.ended).toEqual([{ runId: RUN_ID, status: 'failed' }]);
  });

  test('a missing plan row fails the Run', async () => {
    const h = setup({
      noSeed: true,
      seed: (store) => store.createRun({ id: RUN_ID, kind: 'run', planHash: null, runtime: 'runsc', startedAt: 1 }),
    });
    await runToEnd(h);
    expectNoSandbox(h, /no approved plan/);
  });

  test('a stored text that no longer parses fails the Run', async () => {
    const text = '{"name":';
    const hash = planHash(text);
    const h = setup({
      noSeed: true,
      seed: (store) => {
        store.storeApprovedPlan({ hash, text, approvedAt: 1 });
        store.createRun({ id: RUN_ID, kind: 'run', planHash: hash, runtime: 'runsc', startedAt: 1 });
      },
    });
    await runToEnd(h);
    expectNoSandbox(h, /no longer parses/);
  });

  test('a plan that no longer passes the Policy_Gate fails the Run', async () => {
    const bad = samplePlan({ stages: [{ vus: 600, durationSec: 30 }] });
    const text = printPlan(bad);
    const hash = planHash(text);
    const h = setup({
      noSeed: true,
      seed: (store) => {
        store.storeApprovedPlan({ hash, text, approvedAt: 1 });
        store.createRun({ id: RUN_ID, kind: 'run', planHash: hash, runtime: 'runsc', startedAt: 1 });
      },
    });
    await runToEnd(h);
    expectNoSandbox(h, /Policy_Gate/);
  });
});

// ---- 7.6: Stage error ------------------------------------------------------------------

describe('a Stage error ends the Run as failed and keeps earlier Stages', () => {
  test('an error on the second Stage keeps the first Stage metrics and verdict and starts nothing more', async () => {
    const h = setup({
      plan: planWithVus([10, 20, 30]),
      supervise: decideContinue,
      run: (_s, _sig, n) => (n === 1 ? done(250, 0.5) : errored('The Sandbox ran out of memory.')),
    });
    await runToEnd(h);
    expect(h.status()).toBe('failed');
    expect(h.store.getRun(RUN_ID)?.statusReason).toBe('Stage 2 failed: The Sandbox ran out of memory.');
    expect(h.calls).toHaveLength(2);
    const stages = h.store.getStages(RUN_ID);
    expect(stages.map((s) => [s.idx, s.status])).toEqual([[0, 'done'], [1, 'error']]);
    expect(stages[0]?.metrics?.overall.p95).toBe(250);
    expect(stages[0]?.verdict).toBe('pass');
    // No verdict and no metrics for the failed Stage; its reason is stored.
    expect(stages[1]?.verdict).toBeNull();
    expect(stages[1]?.metrics).toBeNull();
    expect(stages[1]?.errorReason).toBe('The Sandbox ran out of memory.');
    // One decision (after Stage 1); none for the failed Stage.
    expect(h.store.getDecisions(RUN_ID).map((d) => d.stageIdx)).toEqual([0]);
    // A failed Run has no Capacity_Report; the Run network is still closed.
    expect(h.store.getReport(RUN_ID)).toBeNull();
    expect(h.closed).toEqual([RUN_ID]);
    expect(h.ended).toEqual([{ runId: RUN_ID, status: 'failed' }]);
  });

  test.each([
    ['the executor throws', () => { throw new Error('docker exploded'); }, /Sandbox run failed: docker exploded/],
    ['no summary is produced', () => ({ status: 'done', oomKilled: false, killed: false }) as StageRunResult, /k6 produced no summary/],
    ['the summary is not valid JSON', () => ({ status: 'done', summaryJson: '{nope', oomKilled: false, killed: false }) as StageRunResult, /not valid JSON/],
    ['the summary reports zero requests', () => ({ status: 'done', summaryJson: summaryJson({ p95: 1, count: 0 }), oomKilled: false, killed: false }) as StageRunResult, /0 requests/],
  ])('%s: the first Stage errors and the Run fails', async (_label, run, reason) => {
    const h = setup({ run: run as () => StageRunResult });
    await runToEnd(h);
    expect(h.status()).toBe('failed');
    const [stage] = h.store.getStages(RUN_ID);
    expect(stage?.status).toBe('error');
    expect(stage?.errorReason ?? '').toMatch(reason);
    expect(stage?.verdict).toBeNull();
    expect(h.calls).toHaveLength(1);
  });

  test('the Run network is closed and onRunEnded runs even when opening it fails', async () => {
    const h = setup({ openRun: async () => { throw new Error('no network'); } });
    await runToEnd(h);
    expect(h.status()).toBe('failed');
    expect(h.store.getRun(RUN_ID)?.statusReason).toContain('The Sandbox network could not be created');
    expect(h.calls).toHaveLength(0);
    expect(h.closed).toEqual([RUN_ID]);
    expect(h.ended).toHaveLength(1);
  });
});

// ---- 8.9 / 9.2 / 9.3: stop and timeout -----------------------------------------------------

describe('stop and timeout while waiting for the Supervisor', () => {
  async function waitingForSupervisor(kind: 'stop' | 'timeout') {
    const gate = deferred<{ decision: 'continue' | 'stop'; reason: string } | null>();
    let supervisorSignal: AbortSignal | undefined;
    const h = setup({
      plan: planWithVus([10, 20, 30]),
      supervise: (ctx) => {
        supervisorSignal = ctx.signal;
        return gate.promise;
      },
    });
    h.controller.start(RUN_ID);
    await until(() => supervisorSignal !== undefined, 'supervisor called');
    if (kind === 'stop') expect(h.controller.stop(RUN_ID)).toBe(true);
    else expect(h.timers.fire(RUN_TIMEOUT)).toBe(true);
    // The late answer arrives after the status change.
    gate.resolve({ decision: 'continue', reason: 'late but valid' });
    await h.controller.whenDone(RUN_ID);
    return { h, supervisorSignal: supervisorSignal as AbortSignal };
  }

  test('stop: status stays stopped, the answer is discarded, and no further Stage starts', async () => {
    const { h, supervisorSignal } = await waitingForSupervisor('stop');
    expect(h.status()).toBe('stopped');
    expect(supervisorSignal.aborted).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.store.getDecisions(RUN_ID)).toEqual([]);
    expect(h.store.getStages(RUN_ID).map((s) => s.idx)).toEqual([0]);
    // The finished Stage keeps its metrics; a report is written for the stopped Run.
    expect(h.store.getStage(RUN_ID, 0)?.status).toBe('done');
    expect(h.store.getReport(RUN_ID)?.aiStatus).toBe('pending');
    expect(h.eventTypes()).toEqual(['stage_start', 'stage_end', 'status', 'report']);
  });

  test('timeout: status is timed_out with the fixed reason and the answer is discarded', async () => {
    const { h } = await waitingForSupervisor('timeout');
    expect(h.status()).toBe('timed_out');
    expect(h.store.getRun(RUN_ID)?.statusReason).toBe(REASON_TIMED_OUT);
    expect(h.calls).toHaveLength(1);
    expect(h.store.getDecisions(RUN_ID)).toEqual([]);
    expect(h.store.getReport(RUN_ID)).not.toBeNull();
  });
});

describe('a stop is never overwritten by a later result', () => {
  test('the status is written before the Sandbox is aborted, and a late good result is discarded', async () => {
    const gate = deferred<StageRunResult>();
    let statusAtAbort: RunStatus | undefined;
    let started = false;
    let supervised = 0;
    const holder: { h?: ReturnType<typeof setup> } = {};
    const h = setup({
      supervise: async () => (supervised += 1, null),
      run: (_spec, signal) => {
        signal.addEventListener('abort', () => {
          statusAtAbort = holder.h?.store.getRun(RUN_ID)?.status;
        });
        started = true;
        return gate.promise;
      },
    });
    holder.h = h;
    h.controller.start(RUN_ID);
    await until(() => started, 'executor running');
    expect(h.controller.stop(RUN_ID)).toBe(true);
    expect(statusAtAbort).toBe('stopped');
    gate.resolve(done(200)); // a perfectly good result, but too late
    await h.controller.whenDone(RUN_ID);

    expect(h.status()).toBe('stopped');
    expect(supervised).toBe(0);
    expect(h.calls).toHaveLength(1);
    const stage = h.store.getStage(RUN_ID, 0);
    expect(stage?.status).toBe('error');
    expect(stage?.metrics).toBeNull();
    expect(stage?.verdict).toBeNull();
    expect(stage?.errorReason).toContain('stopped');
    expect(h.store.getDecisions(RUN_ID)).toEqual([]);
  });

  test('a late executor error does not turn stopped into failed', async () => {
    const gate = deferred<StageRunResult>();
    let started = false;
    const h = setup({ run: () => ((started = true), gate.promise) });
    h.controller.start(RUN_ID);
    await until(() => started, 'executor running');
    h.controller.stop(RUN_ID);
    gate.resolve(errored('container killed'));
    await h.controller.whenDone(RUN_ID);
    expect(h.status()).toBe('stopped');
    expect(h.store.getRun(RUN_ID)?.statusReason).toBeNull();
    expect(h.store.setRunStatus(RUN_ID, 'failed', 'late', 9)).toBe(false);
    expect(h.status()).toBe('stopped');
  });

  test('a second stop and a stop after the end change nothing', async () => {
    const gate = deferred<StageRunResult>();
    let started = false;
    const h = setup({ run: () => ((started = true), gate.promise) });
    h.controller.start(RUN_ID);
    await until(() => started, 'executor running');
    expect(h.controller.stop(RUN_ID)).toBe(true);
    expect(h.controller.stop(RUN_ID)).toBe(false);
    gate.resolve(done());
    await h.controller.whenDone(RUN_ID);
    expect(h.controller.stop(RUN_ID)).toBe(false);
    expect(h.status()).toBe('stopped');
    expect(h.eventTypes().filter((t) => t === 'status')).toHaveLength(1);
  });

  test('a timeout during a Stage ends the Run as timed_out and later results are discarded', async () => {
    const gate = deferred<StageRunResult>();
    let started = false;
    const h = setup({ run: () => ((started = true), gate.promise) });
    h.controller.start(RUN_ID);
    await until(() => started, 'executor running');
    expect(h.timers.fire(RUN_TIMEOUT)).toBe(true);
    gate.resolve(done());
    await h.controller.whenDone(RUN_ID);
    expect(h.status()).toBe('timed_out');
    expect(h.store.getStage(RUN_ID, 0)?.errorReason).toContain('timed out');
    expect(h.calls).toHaveLength(1);
  });
});

// ---- lifecycle and events ------------------------------------------------------------------

describe('lifecycle', () => {
  test('a clean two-Stage Run: events in order, report stored, network opened and closed once', async () => {
    const h = setup({ supervise: decideContinue });
    await runToEnd(h);
    expect(h.status()).toBe('completed');
    expect(h.eventTypes()).toEqual(['stage_start', 'stage_end', 'decision', 'stage_start', 'stage_end', 'status', 'report']);
    expect(h.opened).toEqual([RUN_ID]);
    expect(h.closed).toEqual([RUN_ID]);
    expect(h.ended).toEqual([{ runId: RUN_ID, status: 'completed' }]);
    const report = h.store.getReport(RUN_ID);
    expect(report?.aiStatus).toBe('pending');
    expect(report?.body).toMatchObject({ runId: RUN_ID, headline: { status: 'completed', safeCapacity: 20, breakingPoint: null } });
    expect(h.controller.isRunning(RUN_ID)).toBe(false);
  });

  test('each Stage script is generated for its own Stage and the approved plan', async () => {
    const h = setup({ plan: planWithVus([10, 20]), supervise: decideContinue });
    await runToEnd(h);
    expect(h.calls.map((c) => [c.runId, c.stageIdx, c.durationSec, c.kind])).toEqual([
      [RUN_ID, 0, 30, 'stage'],
      [RUN_ID, 1, 30, 'stage'],
    ]);
    expect(h.calls[0]?.script).toContain('constant-vus');
    expect(h.calls[1]?.script).toContain('20');
  });

  test('a second start for an active Run is ignored', async () => {
    const gate = deferred<StageRunResult>();
    let started = 0;
    const h = setup({ run: () => ((started += 1), gate.promise) });
    h.controller.start(RUN_ID);
    h.controller.start(RUN_ID);
    await until(() => started > 0, 'executor running');
    expect(h.controller.isRunning(RUN_ID)).toBe(true);
    gate.resolve(done());
    await h.controller.whenDone(RUN_ID);
    expect(h.calls.length).toBeLessThanOrEqual(2);
    expect(h.opened).toEqual([RUN_ID]);
  });

  test('a Run that is not running is left alone', async () => {
    const h = setup({
      seed: (store) => {
        store.setRunStatus(RUN_ID, 'stopped', null, 5);
      },
    });
    await runToEnd(h);
    expect(h.status()).toBe('stopped');
    expect(h.calls).toHaveLength(0);
    expect(h.opened).toEqual([]);
  });

  test('an unexpected crash still leaves no Run in running', async () => {
    const h = setup({ supervise: decideContinue });
    h.store.finishStage = () => {
      throw new Error('disk full');
    };
    await runToEnd(h);
    expect(h.status()).toBe('failed');
    expect(h.store.getRun(RUN_ID)?.statusReason).toBe(REASON_INTERNAL);
    expect(h.logs.join('\n')).toContain('disk full');
  });

  test('onRunEnded failures are swallowed', async () => {
    const store = new Store(':memory:');
    const { hash, text } = storedPlan(planWithVus([10]));
    store.storeApprovedPlan({ hash, text, approvedAt: 1 });
    store.createRun({ id: RUN_ID, kind: 'run', planHash: hash, runtime: 'runsc', startedAt: 1 });
    const logs: string[] = [];
    const controller = new RunController({
      store,
      config: testConfig(),
      executor: { run: async () => done() },
      onRunEnded: () => {
        throw new Error('hook failed');
      },
      log: (m) => logs.push(m),
    });
    controller.start(RUN_ID);
    await controller.whenDone(RUN_ID);
    expect(store.getRun(RUN_ID)?.status).toBe('completed');
    expect(logs.join('\n')).toContain('hook failed');
  });
});
