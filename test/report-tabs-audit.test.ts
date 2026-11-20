import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunSnapshot } from '../src/api-types.ts';
import { buildReport } from '../src/report/build.ts';
import type { StageMetrics, TestPlan } from '../src/types.ts';
import { KpiStrip, SignatureTiles } from '../web/landing/src/app/components/run/KpiStrip.tsx';
import { AI_WITHHELD_NOTE } from '../web/landing/src/app/lib/report-view.ts';
import { applyEvent, modelFromSnapshot } from '../web/landing/src/app/lib/run-view.ts';
import {
  auditRevisionKey,
  buildAuditLogModel,
  buildKpiStripItems,
  feedRevisionKey,
  plainReason,
  resolveActiveRunTab,
  stagesRevisionKey,
  verdictLine,
} from '../web/landing/src/app/components/run/report-tabs.ts';

function makePlan(overrides?: Partial<TestPlan>): TestPlan {
  return {
    name: 'Checkout spike',
    target: 'https://yue.macro.my.id',
    stages: [
      { vus: 25, durationSec: 30 },
      { vus: 50, durationSec: 30 },
      { vus: 100, durationSec: 30 },
    ],
    journey: [
      { route: 'store_home', probability: 60, thinkMs: 500 },
      { route: 'store_checkout', probability: 40, thinkMs: 700 },
    ],
    stopThresholds: { p95Ms: 1200, errorRatePct: 2 },
    ...overrides,
  };
}

function makeMetrics(p95: number, errorRatePct: number, routeOverrides?: Record<string, { p95: number; errorRatePct: number }>): StageMetrics {
  const home = routeOverrides?.['store_home'];
  const checkout = routeOverrides?.['store_checkout'];
  return {
    overall: {
      requests: 1200,
      rps: 40,
      errorRatePct,
      http429: 0,
      p50: Math.round(p95 * 0.45),
      p95,
      p99: Math.round(p95 * 1.2),
    },
    routes: {
      store_home: {
        requests: 700,
        rps: 23.3,
        errorRatePct: home?.errorRatePct ?? errorRatePct,
        http429: 0,
        p50: Math.round((home?.p95 ?? p95) * 0.4),
        p95: home?.p95 ?? p95,
        p99: Math.round((home?.p95 ?? p95) * 1.15),
      },
      store_checkout: {
        requests: 500,
        rps: 16.7,
        errorRatePct: checkout?.errorRatePct ?? errorRatePct,
        http429: 0,
        p50: Math.round((checkout?.p95 ?? p95) * 0.5),
        p95: checkout?.p95 ?? p95,
        p99: Math.round((checkout?.p95 ?? p95) * 1.25),
      },
    },
  };
}

function makeSnapshot(overrides?: Partial<RunSnapshot>): RunSnapshot {
  return {
    run: {
      id: 'run_abc123',
      kind: 'run',
      planHash: 'hash_plan_01',
      status: 'running',
      statusReason: null,
      runtime: 'runc',
      startedAt: 1_700_000_000_000,
      endedAt: null,
      visibility: 'public',
      probeResult: null,
    },
    plan: makePlan(),
    stages: [],
    decisions: [],
    events: [],
    report: null,
    modelCalls: [],
    routes: [
      { id: 'store_home', path: '/', method: 'GET', kind: 'page' },
      { id: 'store_checkout', path: '/checkout', method: 'GET', kind: 'page' },
    ],
    ...overrides,
  };
}

describe('resolveActiveRunTab', () => {
  test('falls back from ai to overview when no report exists yet, and allows all tabs once report is ready', () => {
    expect(resolveActiveRunTab('overview', false)).toBe('overview');
    expect(resolveActiveRunTab('stages', false)).toBe('stages');
    expect(resolveActiveRunTab('audit', false)).toBe('audit');
    expect(resolveActiveRunTab('ai', false)).toBe('overview');

    expect(resolveActiveRunTab('overview', true)).toBe('overview');
    expect(resolveActiveRunTab('stages', true)).toBe('stages');
    expect(resolveActiveRunTab('ai', true)).toBe('ai');
    expect(resolveActiveRunTab('audit', true)).toBe('audit');
  });
});

describe('buildKpiStripItems', () => {
  test('builds all 4 KPI items before stage 1 finishes with explicit stage wait notes', () => {
    const model = modelFromSnapshot(makeSnapshot());
    const items = buildKpiStripItems(model, 1_700_000_005_000);

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      label: 'Starting',
      value: '\u2013',
      unit: null,
      tone: 'live',
      sourceNote: 'preparing the first sandbox',
    });
    expect(items[1]?.label).toBe('p95 latency');
    expect(items[1]?.value).toBe('\u2013');
    expect(items[1]?.sourceNote).toContain('after stage 1 ends');
    expect(items[1]?.sourceNote).toContain('1200 ms');

    expect(items[2]?.label).toBe('Error rate');
    expect(items[2]?.value).toBe('\u2013');
    expect(items[2]?.sourceNote).toContain('after stage 1 ends');
    expect(items[2]?.sourceNote).toContain('2%');

    expect(items[3]).toMatchObject({
      label: 'Safe capacity so far',
      value: '\u2013',
      unit: null,
      sourceNote: 'no stage has passed yet',
    });
  });

  test('names "from stage N" across live KPI items while stage 2 runs after stage 1 passed', () => {
    const stage1Metrics = makeMetrics(320.4, 0.4);
    const model = modelFromSnapshot(
      makeSnapshot({
        stages: [
          {
            index: 0,
            vus: 25,
            durationSec: 30,
            status: 'done',
            errorReason: null,
            verdict: 'pass',
            metrics: stage1Metrics,
            startedAt: 1_700_000_000_000,
            endedAt: 1_700_000_030_000,
          },
          {
            index: 1,
            vus: 50,
            durationSec: 30,
            status: 'running',
            errorReason: null,
            verdict: null,
            metrics: null,
            startedAt: 1_700_000_032_000,
            endedAt: null,
          },
        ],
      }),
    );

    const items = buildKpiStripItems(model, 1_700_000_047_000);
    expect(items).toHaveLength(4);

    expect(items[0]).toMatchObject({
      label: 'Stage 2 of 3',
      value: '50',
      unit: 'VUs',
      tone: 'live',
      progress: 0.5,
    });
    expect(items[0]?.sourceNote).toContain('from stage 2');
    expect(items[0]?.sourceNote).toContain('15 s of 30 s');

    expect(items[1]?.label).toBe('p95 at stage 1');
    expect(items[1]?.value).toBe('320 ms');
    expect(items[1]?.sourceNote).toContain('from stage 1');
    expect(items[1]?.sourceNote).toContain('limit 1200 ms');

    expect(items[2]?.label).toBe('Error rate at stage 1');
    expect(items[2]?.value).toBe('0.4%');
    expect(items[2]?.sourceNote).toContain('from stage 1');
    expect(items[2]?.sourceNote).toContain('limit 2%');

    expect(items[3]?.label).toBe('Safe capacity so far');
    expect(items[3]?.value).toBe('25');
    expect(items[3]?.unit).toBe('VUs');
    expect(items[3]?.sourceNote).toContain('from stage 1');
  });

  test('builds all 4 report KPI items with explicit "from stage N" sources once report is ready', () => {
    const plan = makePlan();
    const s1 = makeMetrics(280, 0.1);
    const s2 = makeMetrics(620, 0.5);
    const s3 = makeMetrics(1510, 1.2, {
      store_home: { p95: 800, errorRatePct: 0.4 },
      store_checkout: { p95: 1850, errorRatePct: 1.9 },
    });

    const report = buildReport({
      runId: 'run_abc123',
      planHash: 'hash_plan_01',
      status: 'halted',
      runtime: 'runc',
      plan,
      stages: [
        { index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s1, verdict: 'pass' },
        { index: 1, vus: 50, durationSec: 30, status: 'done', metrics: s2, verdict: 'pass' },
        { index: 2, vus: 100, durationSec: 30, status: 'done', metrics: s3, verdict: 'fail' },
      ],
      decisions: [],
      events: [],
      routeOrder: ['store_home', 'store_checkout'],
    });

    const model = modelFromSnapshot(
      makeSnapshot({
        run: {
          id: 'run_abc123',
          kind: 'run',
          planHash: 'hash_plan_01',
          status: 'halted',
          statusReason: 'Stopped after Stage 3 by Supervisor_Agent.',
          runtime: 'runc',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_095_000,
          visibility: 'public',
          probeResult: null,
        },
        plan,
        report,
      }),
    );

    const items = buildKpiStripItems(model, 1_700_000_120_000);
    expect(items).toHaveLength(4);

    expect(items[0]).toMatchObject({
      label: 'Safe capacity (VUs)',
      value: '50',
      unit: 'VUs',
      tone: 'live',
    });
    expect(items[0]?.sourceNote).toContain('from stage 2');

    expect(items[1]).toMatchObject({
      label: 'Breaking point (VUs)',
      value: '100',
      unit: 'VUs',
      tone: 'bad',
    });
    expect(items[1]?.sourceNote).toContain('from stage 3');

    expect(items[2]).toMatchObject({
      label: 'First degraded route',
      value: 'store_checkout',
      unit: null,
      tone: 'warn',
    });
    expect(items[2]?.sourceNote).toContain('from stage 3');
    expect(items[2]?.sourceNote).toContain('1850 ms');

    expect(items[3]).toMatchObject({
      label: 'Tested up to',
      value: '100',
      unit: 'VUs',
      tone: 'neutral',
    });
    expect(items[3]?.sourceNote).toContain('from stage 3');
    expect(items[3]?.sourceNote).toContain('3 of 3 stages');
    expect(items[3]?.sourceNote).toContain('01:35');
  });

  test('handles report with no safe capacity and no breaking point / degraded route cleanly', () => {
    const plan = makePlan({ stages: [{ vus: 25, durationSec: 30 }] });
    const s1 = makeMetrics(400, 0.2);
    const passingReport = buildReport({
      runId: 'run_pass',
      planHash: 'hash_plan_01',
      status: 'completed',
      runtime: 'runc',
      plan,
      stages: [{ index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s1, verdict: 'pass' }],
      decisions: [],
      events: [],
      routeOrder: ['store_home', 'store_checkout'],
    });
    const passModel = modelFromSnapshot(
      makeSnapshot({
        run: {
          id: 'run_pass',
          kind: 'run',
          planHash: 'hash_plan_01',
          status: 'completed',
          statusReason: null,
          runtime: 'runc',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_030_000,
          visibility: 'public',
          probeResult: null,
        },
        plan,
        report: passingReport,
      }),
    );
    const passItems = buildKpiStripItems(passModel, 1_700_000_040_000);
    expect(passItems[0]?.value).toBe('25');
    expect(passItems[0]?.sourceNote).toContain('from stage 1');
    expect(passItems[1]?.value).toBe('not reached');
    expect(passItems[1]?.tone).toBe('neutral');
    expect(passItems[2]?.value).toBe('none');
    expect(passItems[2]?.tone).toBe('neutral');
    expect(passItems[3]?.sourceNote).toContain('1 of 1 stage');
  });
});

describe('buildAuditLogModel', () => {
  test('builds gate metadata, supervisor decisions, containment events, and model calls strictly from snapshot and stream events', () => {
    const model = modelFromSnapshot(
      makeSnapshot({
        run: {
          id: 'run_audit_1',
          kind: 'run',
          planHash: 'sha256_deadbeef',
          status: 'halted',
          statusReason: 'Stopped after Stage 2 by Supervisor_Agent.',
          runtime: 'runsc',
          startedAt: Date.UTC(2026, 4, 21, 14, 3, 7),
          endedAt: Date.UTC(2026, 4, 21, 14, 5, 19),
          visibility: 'public',
          probeResult: null,
        },
        decisions: [
          {
            stageIdx: 1,
            decision: 'stop',
            source: 'fallback',
            reason: 'p95 exceeded threshold',
            reasonWithheld: true,
          },
          {
            stageIdx: 0,
            decision: 'continue',
            source: 'agent',
            reason: 'Latency stayed well below stop threshold.',
            reasonWithheld: false,
          },
        ],
        events: [
          {
            id: 1,
            type: 'containment',
            runId: 'run_audit_1',
            stageIdx: null,
            payload: { type: 'sandbox_created' },
            ts: Date.UTC(2026, 4, 21, 14, 3, 8),
          },
          {
            id: 2,
            type: 'containment',
            runId: 'run_audit_1',
            stageIdx: 1,
            payload: { type: 'egress_blocked', host: '169.254.169.254', port: 80 },
            ts: Date.UTC(2026, 4, 21, 14, 4, 15),
          },
        ],
        modelCalls: [
          {
            agent: 'supervisor',
            model: 'gemini-2.5-flash',
            outcome: 'success',
            latencyMs: 312,
            promptTokens: 420,
            completionTokens: 48,
          },
        ],
      }),
    );

    // Also simulate a live containment event arriving over SSE before snapshot refresh.
    applyEvent(model, {
      id: 3,
      type: 'containment',
      runId: 'run_audit_1',
      stageIdx: null,
      payload: { type: 'sandbox_removed' },
      ts: Date.UTC(2026, 4, 21, 14, 5, 19),
    });

    const audit = buildAuditLogModel(model);

    expect(audit.gate).toEqual({
      verdictLabel: 'Accepted by Policy Gate',
      verdictTone: 'ok',
      runId: 'run_audit_1',
      status: 'halted',
      statusReason: 'Stopped after stage 2 by supervisor (AI).',
      planName: 'Checkout spike',
      planHash: 'sha256_deadbeef',
      target: 'https://yue.macro.my.id',
      stopThresholds: { p95Ms: 1200, errorRatePct: 2 },
      runtime: 'runsc',
      startedAtUtc: '2026-05-21 14:03:07 UTC',
      endedAtUtc: '2026-05-21 14:05:19 UTC',
    });

    expect(audit.decisions).toEqual([
      {
        stageIndex: 0,
        stageNumber: 1,
        stageLabel: 'Stage 1',
        decision: 'continue',
        decisionTone: 'ok',
        source: 'agent',
        sourceLabel: 'supervisor (AI)',
        reason: 'Latency stayed well below stop threshold.',
        reasonWithheld: false,
        withheldNote: null,
      },
      {
        stageIndex: 1,
        stageNumber: 2,
        stageLabel: 'Stage 2',
        decision: 'stop',
        decisionTone: 'warn',
        source: 'fallback',
        sourceLabel: 'fixed fallback rule',
        reason: 'p95 exceeded threshold',
        reasonWithheld: true,
        withheldNote: AI_WITHHELD_NOTE,
      },
    ]);

    expect(audit.containment).toEqual([
      {
        id: 1,
        ts: Date.UTC(2026, 4, 21, 14, 3, 8),
        utc: '2026-05-21 14:03:08 UTC',
        type: 'sandbox_created',
        label: 'Sandbox created',
        warn: false,
        target: null,
        stageNumber: null,
        scopeLabel: 'Run',
      },
      {
        id: 2,
        ts: Date.UTC(2026, 4, 21, 14, 4, 15),
        utc: '2026-05-21 14:04:15 UTC',
        type: 'egress_blocked',
        label: 'Egress blocked',
        warn: true,
        target: '169.254.169.254:80',
        stageNumber: 2,
        scopeLabel: 'Stage 2',
      },
      {
        id: 3,
        ts: Date.UTC(2026, 4, 21, 14, 5, 19),
        utc: '2026-05-21 14:05:19 UTC',
        type: 'sandbox_removed',
        label: 'Sandbox removed',
        warn: false,
        target: null,
        stageNumber: null,
        scopeLabel: 'Run',
      },
    ]);

    expect(audit.modelCalls).toHaveLength(1);
    expect(audit.modelCalls[0]?.agent).toBe('supervisor');
  });

  test('falls back safely when plan is absent or unrecorded without fabricating metadata', () => {
    const model = modelFromSnapshot(
      makeSnapshot({
        run: {
          id: 'run_no_plan',
          kind: 'run',
          planHash: null,
          status: 'failed',
          statusReason: null,
          runtime: 'runc',
          startedAt: Date.UTC(2026, 4, 21, 10, 0, 0),
          endedAt: null,
          visibility: 'public',
          probeResult: null,
        },
        plan: null,
        report: null,
      }),
    );

    const audit = buildAuditLogModel(model);
    expect(audit.gate.verdictLabel).toBe('Not recorded');
    expect(audit.gate.verdictTone).toBe('neutral');
    expect(audit.gate.planHash).toBeNull();
    expect(audit.gate.target).toBeNull();
    expect(audit.gate.stopThresholds).toBeNull();
    expect(audit.gate.endedAtUtc).toBeNull();
    expect(audit.decisions).toEqual([]);
    expect(audit.containment).toEqual([]);
    expect(audit.modelCalls).toEqual([]);
  });
});

describe('plainReason, verdictLine, and revision keys', () => {
  test('plainReason translates requirement terms into plain language', () => {
    expect(plainReason("Stopped after Stage 2 by the Supervisor_Agent's decision over Stop_Thresholds.")).toBe(
      'Stopped after stage 2 by the supervisor (AI) decision over stop thresholds.',
    );
  });

  test('verdictLine summarizes passing/breaking capacity and degraded route path', () => {
    const plan = makePlan();
    const s1 = makeMetrics(280, 0.1);
    const s2 = makeMetrics(1510, 1.2, {
      store_home: { p95: 700, errorRatePct: 0.4 },
      store_checkout: { p95: 1850, errorRatePct: 1.9 },
    });
    const report = buildReport({
      runId: 'run_verdict_1',
      planHash: 'hash_v1',
      status: 'halted',
      runtime: 'runc',
      plan,
      stages: [
        { index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s1, verdict: 'pass' },
        { index: 1, vus: 50, durationSec: 30, status: 'done', metrics: s2, verdict: 'fail' },
      ],
      decisions: [],
      events: [],
      routeOrder: ['store_home', 'store_checkout'],
    });
    expect(verdictLine(report, [{ id: 'store_checkout', path: '/checkout' }])).toBe(
      'Holds 25 VUs. At 50 VUs, p95 latency went over the 1,200 ms limit (1510 ms). store_checkout (/checkout) was the first route over the 1,200 ms p95 limit, at 50 VUs.',
    );
  });

  test('revision keys stay stable across time ticks and change when events mutate the model', () => {
    const model = modelFromSnapshot(makeSnapshot());
    const s0 = stagesRevisionKey(model);
    const f0 = feedRevisionKey(model);
    const a0 = auditRevisionKey(model);

    expect(stagesRevisionKey(model)).toBe(s0);
    expect(feedRevisionKey(model)).toBe(f0);
    expect(auditRevisionKey(model)).toBe(a0);

    applyEvent(model, {
      id: 11,
      type: 'containment',
      runId: 'run_abc123',
      stageIdx: 0,
      payload: { type: 'sandbox_created' },
      ts: 1_700_000_001_000,
    });
    expect(stagesRevisionKey(model)).toBe(s0);
    expect(feedRevisionKey(model)).not.toBe(f0);
    expect(auditRevisionKey(model)).not.toBe(a0);
  });
});

describe('KpiStrip and SignatureTiles rendering', () => {
  test('KpiStrip delegates sticky positioning to its wrapper, renders single-line flex cells with preserved from stage N notes, and emits zero style= attributes', () => {
    const plan = makePlan();
    const s1 = makeMetrics(280, 0.1);
    const s2 = makeMetrics(620, 0.5);
    const s3 = makeMetrics(1510, 1.2, {
      store_home: { p95: 800, errorRatePct: 0.4 },
      store_checkout: { p95: 1850, errorRatePct: 1.9 },
    });
    const report = buildReport({
      runId: 'run_kpi_1',
      planHash: 'hash_plan_01',
      status: 'halted',
      runtime: 'runc',
      plan,
      stages: [
        { index: 0, vus: 25, durationSec: 30, status: 'done', metrics: s1, verdict: 'pass' },
        { index: 1, vus: 50, durationSec: 30, status: 'done', metrics: s2, verdict: 'pass' },
        { index: 2, vus: 100, durationSec: 30, status: 'done', metrics: s3, verdict: 'fail' },
      ],
      decisions: [],
      events: [],
      routeOrder: ['store_home', 'store_checkout'],
    });
    const model = modelFromSnapshot(
      makeSnapshot({
        run: {
          id: 'run_kpi_1',
          kind: 'run',
          planHash: 'hash_plan_01',
          status: 'halted',
          statusReason: null,
          runtime: 'runc',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_095_000,
          visibility: 'public',
          probeResult: null,
        },
        plan,
        report,
      }),
    );
    const items = buildKpiStripItems(model, 1_700_000_120_000);

    const stripHtml = renderToStaticMarkup(createElement(KpiStrip, { items }));
    expect(stripHtml).not.toContain('sticky');
    expect(stripHtml).toContain('border-bar');
    expect(stripHtml).toContain('flex-wrap');
    expect(stripHtml).toContain('Safe capacity (VUs)');
    expect(stripHtml).toContain('50 VUs');
    expect(stripHtml).toContain('from stage 2');
    expect(stripHtml).toContain('from stage 3');
    expect(stripHtml).not.toMatch(/\sstyle=/i);

    const tilesHtml = renderToStaticMarkup(createElement(SignatureTiles, { items, reportMode: true }));
    expect(tilesHtml).toContain('Safe capacity (VUs)');
    expect(tilesHtml).toContain('from stage 2');
    expect(tilesHtml).not.toMatch(/\sstyle=/i);
  });
});
