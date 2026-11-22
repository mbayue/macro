import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InferenceMode, InferenceSource } from 'firebase/ai';
import type { CapacityReport } from '../src/report/build.ts';
import { HybridAvailabilityBadge, HybridBadge } from '../web/landing/src/app/components/HybridBadge.tsx';
import {
  AI_HELPER_UNAVAILABLE,
  DEFAULT_HYBRID_REMOTE_CONFIG,
  buildReportQaPrompt,
  buildScenarioPrompt,
  detectOnDeviceAvailability,
  mapInferenceSource,
  parseHybridRemoteConfig,
  resolveHybridAvailability,
  runHybridPrompt,
  summarizeReportForQa,
  verifyReportQaReply,
} from '../web/landing/src/app/lib/hybrid-ai.ts';

const SAMPLE_REPORT: CapacityReport = {
  runId: 'run-123',
  planHash: 'abc123',
  planName: 'Campaign spike',
  target: 'https://yue.macro.my.id',
  runtime: 'runsc',
  thresholds: { p95Ms: 1500, errorRatePct: 5 },
  headline: {
    status: 'stopped',
    safeCapacity: 100,
    breakingPoint: 200,
    firstDegradedRoute: 'store_home',
  },
  noStageMetrics: null,
  breakingPointNotReached: null,
  noSafeCapacity: null,
  noRouteExceeded: null,
  stages: [
    {
      index: 0,
      displayIndex: 1,
      vus: 100,
      durationSec: 60,
      status: 'done',
      errorReason: null,
      verdict: 'pass',
      overall: {
        raw: { requests: 1200, rps: 20, errorRatePct: 0.2, http429: 0, p50: 120, p95: 450, p99: 800 },
        display: {
          requests: '1,200',
          rps: '20.0',
          errorRatePct: '0.20%',
          http429: '0',
          p50: '120 ms',
          p95: '450 ms',
          p99: '800 ms',
        },
      },
      routes: [
        {
          route: 'store_home',
          exceedsThresholds: false,
          raw: { requests: 800, rps: 13.3, errorRatePct: 0, http429: 0, p50: 100, p95: 400, p99: 700 },
          display: {
            requests: '800',
            rps: '13.3',
            errorRatePct: '0.00%',
            http429: '0',
            p50: '100 ms',
            p95: '400 ms',
            p99: '700 ms',
          },
        },
      ],
    },
    {
      index: 1,
      displayIndex: 2,
      vus: 200,
      durationSec: 60,
      status: 'done',
      errorReason: null,
      verdict: 'fail',
      overall: {
        raw: { requests: 1800, rps: 30, errorRatePct: 2.5, http429: 12, p50: 400, p95: 1611, p99: 2400 },
        display: {
          requests: '1,800',
          rps: '30.0',
          errorRatePct: '2.50%',
          http429: '12',
          p50: '400 ms',
          p95: '1,611 ms',
          p99: '2,400 ms',
        },
      },
      routes: [
        {
          route: 'store_home',
          exceedsThresholds: true,
          raw: { requests: 1200, rps: 20, errorRatePct: 2.5, http429: 12, p50: 410, p95: 1611, p99: 2400 },
          display: {
            requests: '1,200',
            rps: '20.0',
            errorRatePct: '2.50%',
            http429: '12',
            p50: '410 ms',
            p95: '1,611 ms',
            p99: '2,400 ms',
          },
        },
      ],
    },
  ],
  decisions: [],
  events: [],
};

describe('mapInferenceSource', () => {
  test('maps on_device, in_cloud, and undefined', () => {
    expect(mapInferenceSource(InferenceSource.ON_DEVICE)).toBe('on-device');
    expect(mapInferenceSource(InferenceSource.IN_CLOUD)).toBe('cloud');
    expect(mapInferenceSource(undefined)).toBe('unknown');
  });
});

describe('buildScenarioPrompt', () => {
  test('includes draft, instruction, and available routes', () => {
    const prompt = buildScenarioPrompt({
      draft: '500 users browse the shop',
      instruction: 'Add ramp-up and spike',
      routes: ['/store', '/api/products'],
    });
    expect(prompt).toContain('500 users browse the shop');
    expect(prompt).toContain('Add ramp-up and spike');
    expect(prompt).toContain('/store');
    expect(prompt).toContain('/api/products');
  });
});

describe('summarizeReportForQa & buildReportQaPrompt', () => {
  test('includes headline metrics, thresholds, and failing stage/route numbers', () => {
    const summary = summarizeReportForQa(SAMPLE_REPORT);
    expect(summary).toContain('Campaign spike');
    expect(summary).toContain('Safe capacity: 100 VUs');
    expect(summary).toContain('Breaking point: 200 VUs');
    expect(summary).toContain('First degraded route: store_home');
    expect(summary).toContain('1,611 ms');

    const prompt = buildReportQaPrompt(SAMPLE_REPORT, 'Why did stage 2 fail?');
    expect(prompt).toContain('Why did stage 2 fail?');
    expect(prompt).toContain('1,611 ms');

    const custom = buildReportQaPrompt(
      SAMPLE_REPORT,
      'Which route failed?',
      'Be ultra brief and cite the exact route ID.',
    );
    expect(custom).toContain('Be ultra brief and cite the exact route ID.');
    expect(custom).toContain('1,611 ms');
    expect(custom).toContain('Never invent numbers');
  });
});

describe('runHybridPrompt', () => {
  test('returns trimmed reply and origin on success', async () => {
    const res = await runHybridPrompt(
      async () => ({ text: '  Refined traffic description.  ', origin: 'on-device' }),
      'prompt',
    );
    expect(res).toEqual({
      ok: true,
      reply: { text: 'Refined traffic description.', origin: 'on-device' },
    });
  });

  test('returns error when model returns empty text', async () => {
    const res = await runHybridPrompt(async () => ({ text: '   ', origin: 'cloud' }), 'prompt');
    expect(res.ok).toBe(false);
  });

  test('catches runner errors cleanly, returns friendly copy, and logs details', async () => {
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const boom = new Error('Model unavailable (401)');
      const res = await runHybridPrompt(async () => {
        throw boom;
      }, 'prompt');
      expect(res).toEqual({ ok: false, error: AI_HELPER_UNAVAILABLE });
      expect(!res.ok && !res.aborted ? res.error : '').toBe("AI helper isn't available right now");
      expect(logged).toHaveLength(1);
      expect(logged[0]).toEqual(['Hybrid inference error:', boom]);
    } finally {
      console.error = originalError;
    }
  });

  test('notifies onChunk callback as chunks stream in real time', async () => {
    const chunks: string[] = [];
    const res = await runHybridPrompt(
      async (_prompt, onChunk) => {
        onChunk?.('Ramp from ');
        onChunk?.('Ramp from 10 to 100 users');
        return { text: 'Ramp from 10 to 100 users', origin: 'on-device' };
      },
      'prompt',
      (c) => chunks.push(c),
    );
    expect(res.ok).toBe(true);
    expect(chunks).toEqual(['Ramp from ', 'Ramp from 10 to 100 users']);
  });

  test('returns aborted without error when AbortSignal fires', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await runHybridPrompt(
      async (_prompt, _onChunk, signal) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return { text: 'done', origin: 'cloud' };
      },
      'prompt',
      undefined,
      controller.signal,
    );
    expect(res).toEqual({ ok: false, aborted: true });
  });
});

describe('detectOnDeviceAvailability', () => {
  test('maps Chrome LanguageModel availability strings and handles missing/throwing probes', async () => {
    expect(await detectOnDeviceAvailability(async () => 'available')).toBe('ready');
    expect(await detectOnDeviceAvailability(async () => 'readily')).toBe('ready');
    expect(await detectOnDeviceAvailability(async () => 'downloading')).toBe('downloading');
    expect(await detectOnDeviceAvailability(async () => 'downloadable')).toBe('downloading');
    expect(await detectOnDeviceAvailability(async () => 'after-download')).toBe('downloading');
    expect(await detectOnDeviceAvailability(async () => 'unavailable')).toBe('cloud-fallback');
    expect(await detectOnDeviceAvailability(async () => 'no')).toBe('cloud-fallback');
    expect(
      await detectOnDeviceAvailability(async () => {
        throw new Error('not supported');
      }),
    ).toBe('cloud-fallback');
  });
});

describe('verifyReportQaReply', () => {
  test('accepts grounded numbers from CapacityReport and flags invented numbers', () => {
    expect(verifyReportQaReply('Safe capacity is 100 VUs and p95 was 1611 ms.', SAMPLE_REPORT)).toEqual({
      ok: true,
    });
    const bad = verifyReportQaReply('Stage 2 handled 99999 requests at 777 ms.', SAMPLE_REPORT);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.offending).toEqual([99999, 777]);
    }
  });
});

describe('HybridAvailabilityBadge', () => {
  test('renders pre-flight status labels without inline styles', () => {
    const ready = renderToStaticMarkup(createElement(HybridAvailabilityBadge, { availability: 'ready' }));
    expect(ready).toContain('On-Device Model: Gemini Nano');
    expect(ready).not.toMatch(/\sstyle=/i);

    const downloading = renderToStaticMarkup(
      createElement(HybridAvailabilityBadge, { availability: 'downloading' }),
    );
    expect(downloading).toContain('Gemini Nano downloading');

    const cloud = renderToStaticMarkup(
      createElement(HybridAvailabilityBadge, { availability: 'cloud-fallback' }),
    );
    expect(cloud).toContain('Cloud Model: Gemini');

    const cloudNamed = renderToStaticMarkup(
      createElement(HybridAvailabilityBadge, {
        availability: 'cloud-fallback',
        cloudModel: 'gemini-2.5-flash',
      }),
    );
    expect(cloudNamed).toContain('Cloud Model: gemini-2.5-flash');
    expect(cloudNamed).not.toMatch(/\sstyle=/i);

    const unavailable = renderToStaticMarkup(
      createElement(HybridAvailabilityBadge, { availability: 'on-device-unavailable' }),
    );
    expect(unavailable).toContain('On-Device Only: Unavailable');
    expect(unavailable).not.toMatch(/\sstyle=/i);

    const originCloud = renderToStaticMarkup(
      createElement(HybridBadge, { origin: 'cloud', cloudModel: 'gemini-2.5-flash' }),
    );
    expect(originCloud).toContain('Cloud Model: gemini-2.5-flash');
    expect(originCloud).not.toMatch(/\sstyle=/i);
  });
});

describe('parseHybridRemoteConfig', () => {
  test('returns safe defaults when remote values are empty or invalid', () => {
    expect(parseHybridRemoteConfig({})).toEqual(DEFAULT_HYBRID_REMOTE_CONFIG);
    expect(
      parseHybridRemoteConfig({
        hybrid_ai_enabled: 'true',
        hybrid_inference_mode: 'bogus_mode',
        hybrid_cloud_model: '   ',
        scenario_assistant_instruction: '',
        report_qa_system_instruction: '   ',
      }),
    ).toEqual(DEFAULT_HYBRID_REMOTE_CONFIG);
  });

  test('applies valid remote overrides including kill switch and mode', () => {
    const parsed = parseHybridRemoteConfig({
      hybrid_ai_enabled: 'false',
      hybrid_inference_mode: 'only_in_cloud',
      hybrid_cloud_model: 'gemini-2.5-flash-lite',
      scenario_assistant_instruction: 'Focus on checkout spikes.',
      report_qa_system_instruction: 'Answer in one sentence using only measured numbers.',
    });
    expect(parsed).toEqual({
      enabled: false,
      mode: InferenceMode.ONLY_IN_CLOUD,
      cloudModel: 'gemini-2.5-flash-lite',
      scenarioAssistantInstruction: 'Focus on checkout spikes.',
      reportQaSystemInstruction: 'Answer in one sentence using only measured numbers.',
    });
  });
});

describe('resolveHybridAvailability', () => {
  test('honors Remote Config inference mode over raw on-device probe', () => {
    expect(resolveHybridAvailability('ready', InferenceMode.PREFER_ON_DEVICE)).toBe('ready');
    expect(resolveHybridAvailability('downloading', InferenceMode.PREFER_ON_DEVICE)).toBe('downloading');
    expect(resolveHybridAvailability('cloud-fallback', InferenceMode.PREFER_ON_DEVICE)).toBe('cloud-fallback');

    expect(resolveHybridAvailability('ready', InferenceMode.ONLY_IN_CLOUD)).toBe('cloud-fallback');
    expect(resolveHybridAvailability('ready', InferenceMode.PREFER_IN_CLOUD)).toBe('cloud-fallback');

    expect(resolveHybridAvailability('ready', InferenceMode.ONLY_ON_DEVICE)).toBe('ready');
    expect(resolveHybridAvailability('downloading', InferenceMode.ONLY_ON_DEVICE)).toBe('downloading');
    expect(resolveHybridAvailability('cloud-fallback', InferenceMode.ONLY_ON_DEVICE)).toBe('on-device-unavailable');
  });
});

describe('remoteconfig.template.json', () => {
  test('defines all 5 Hybrid AI parameters matching in-app defaults', () => {
    const rawJson = readFileSync(join(import.meta.dir, '..', 'remoteconfig.template.json'), 'utf8');
    const template = JSON.parse(rawJson) as {
      parameters: Record<string, { defaultValue: { value: string }; valueType: string; description: string }>;
    };
    const keys = [
      'hybrid_ai_enabled',
      'hybrid_inference_mode',
      'hybrid_cloud_model',
      'scenario_assistant_instruction',
      'report_qa_system_instruction',
    ] as const;

    const rawValues: Record<string, string> = {};
    for (const key of keys) {
      expect(template.parameters[key]).toBeDefined();
      expect(template.parameters[key]!.description.length).toBeGreaterThan(0);
      rawValues[key] = template.parameters[key]!.defaultValue.value;
    }

    expect(rawValues.hybrid_ai_enabled).toBe('true');
    expect(rawValues.hybrid_inference_mode).toBe('prefer_on_device');
    expect(rawValues.hybrid_cloud_model).toBe('gemini-2.5-flash');
    expect(parseHybridRemoteConfig(rawValues)).toEqual(DEFAULT_HYBRID_REMOTE_CONFIG);
  });
});
