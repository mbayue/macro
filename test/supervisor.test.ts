import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import { decideNextStageTool, makeSupervisor, supervisorUserMessage } from '../src/agents/supervisor.ts';
import { validateSupervisorToolCall } from '../src/run/decide.ts';
import { Store } from '../src/store/db.ts';
import { asFetch, chatResponse, hangUntilAborted, metricsOf, stageMetricsOf, testConfig, toolCallOf } from './arb-agents.ts';

// ---- generators --------------------------------------------------------------

const GLYPHS = ['a', 'z', 'é', '日', '😀', ' '] as const;
/** A reason of exactly `n` code points (astral glyphs make UTF-16 length differ). */
const arbReasonOfLength = (n: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...GLYPHS), { minLength: n, maxLength: n }).map((a) => a.join(''));

const arbDecisionValue: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom('continue', 'stop') },
  { weight: 3, arbitrary: fc.constantFrom('Continue', 'STOP', ' stop', 'stop ', 'halt', 'abort', '', 'continue\n') },
  { weight: 1, arbitrary: fc.constantFrom(null, 0, 1, true, undefined, ['stop'], { decision: 'stop' }) },
);

const arbArgsObject: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    arbDecisionValue,
    fc.integer({ min: 0, max: 600 }).chain(arbReasonOfLength),
    fc.constantFrom('keep', 'no-reason', 'number-reason', 'null-reason'),
  )
  .map(([decision, reason, shape]) => {
    const o: Record<string, unknown> = {};
    if (decision !== undefined) o['decision'] = decision;
    if (shape === 'keep') o['reason'] = reason;
    else if (shape === 'number-reason') o['reason'] = 42;
    else if (shape === 'null-reason') o['reason'] = null;
    return o;
  });

const MALFORMED_ARGS = ['{not json', '', '[]', 'null', '"str"', '{"decision":"stop"', '42', 'true', '{"decision":"stop","reason":'];

const arbArguments: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: arbArgsObject.map((o) => JSON.stringify(o)) },
  { weight: 2, arbitrary: arbArgsObject }, // already-parsed object form
  { weight: 2, arbitrary: fc.constantFrom(...MALFORMED_ARGS) },
);

const arbName = fc.oneof(
  { weight: 5, arbitrary: fc.constant('decide_next_stage') },
  { weight: 2, arbitrary: fc.constantFrom('propose_plan', 'write_report', 'Decide_Next_Stage', 'decide_next_stage ', '') },
  { weight: 1, arbitrary: fc.string({ maxLength: 10 }) },
);

const arbCall: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(arbName, arbArguments).map(([name, args]) => ({ id: 'c', type: 'function', function: { name, arguments: args } })) },
  { weight: 1, arbitrary: fc.tuple(arbName, arbArguments).map(([name, args]) => ({ name, arguments: args })) }, // flat shape
  { weight: 1, arbitrary: fc.constantFrom(null, 7, 'str', [], {}, { function: null }, { function: { arguments: '{}' } }) },
);

/** Reference: the first decide_next_stage call decides; it is valid or the whole result is null. */
function reference(calls: readonly unknown[]): { decision: 'continue' | 'stop'; reason: string } | null {
  const nameOf = (c: unknown): { name: unknown; args: unknown } => {
    if (typeof c !== 'object' || c === null) return { name: undefined, args: undefined };
    const rec = c as Record<string, unknown>;
    const fn = typeof rec['function'] === 'object' && rec['function'] !== null ? (rec['function'] as Record<string, unknown>) : rec;
    return { name: fn['name'], args: fn['arguments'] };
  };
  const first = calls.map(nameOf).find((c) => c.name === 'decide_next_stage');
  if (first === undefined) return null;
  let args = first.args;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  const { decision, reason } = args as Record<string, unknown>;
  if (decision !== 'continue' && decision !== 'stop') return null;
  if (typeof reason !== 'string') return null;
  const len = Array.from(reason).length;
  if (len < 1 || len > 500) return null;
  return { decision, reason };
}

describe('Property 16: Supervisor response validation', () => {
  test('the validator returns a decision exactly when the first decide_next_stage call is valid', () => {
    // Feature: macro, Property 16: Supervisor response validation
    fc.assert(
      fc.property(fc.array(arbCall, { maxLength: 6 }), (calls) => {
        expect(validateSupervisorToolCall(calls)).toEqual(reference(calls));
      }),
      { numRuns: 500 },
    );
  });

  test('the returned decision always comes from the first decide_next_stage call', () => {
    // Feature: macro, Property 16: Supervisor response validation
    const arbValid = fc
      .tuple(fc.constantFrom('continue', 'stop'), fc.integer({ min: 1, max: 500 }).chain(arbReasonOfLength))
      .map(([decision, reason]) => ({ decision, reason }));
    fc.assert(
      fc.property(fc.array(arbCall, { maxLength: 4 }), arbValid, arbValid, fc.array(arbCall, { maxLength: 4 }), (before, a, b, after) => {
        // Keep only calls that are not decide_next_stage so that `a` is the first one.
        const others = before.filter((c) => !JSON.stringify(c ?? null).includes('decide_next_stage'));
        const calls = [...others, toolCallOf('decide_next_stage', a), toolCallOf('decide_next_stage', b), ...after];
        expect(validateSupervisorToolCall(calls)).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });

  test('an invalid first call is not rescued by a later valid call', () => {
    // Feature: macro, Property 16: Supervisor response validation
    fc.assert(
      fc.property(
        fc.constantFrom({ decision: 'maybe', reason: 'x' }, { decision: 'stop', reason: '' }, { decision: 'stop', reason: 'x'.repeat(501) }, { decision: 'stop' }),
        (bad) => {
          const calls = [toolCallOf('decide_next_stage', bad), toolCallOf('decide_next_stage', { decision: 'stop', reason: 'fine' })];
          expect(validateSupervisorToolCall(calls)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  test('reason length boundaries are counted in code points', () => {
    const call = (reason: string): unknown[] => [toolCallOf('decide_next_stage', { decision: 'continue', reason })];
    expect(validateSupervisorToolCall(call(''))).toBeNull();
    expect(validateSupervisorToolCall(call('x'))).toEqual({ decision: 'continue', reason: 'x' });
    expect(validateSupervisorToolCall(call('x'.repeat(500)))).not.toBeNull();
    expect(validateSupervisorToolCall(call('x'.repeat(501)))).toBeNull();
    // 500 astral characters are 1,000 UTF-16 units but 500 characters.
    expect(validateSupervisorToolCall(call('😀'.repeat(500)))).not.toBeNull();
    expect(validateSupervisorToolCall(call('😀'.repeat(501)))).toBeNull();
  });

  test('non-array input yields null', () => {
    for (const v of [undefined, null, {}, 'x', 3]) expect(validateSupervisorToolCall(v)).toBeNull();
  });
});

// ---- the 30 s window, exercised through the real Inference_Client ---------------

const CTX_BASE = {
  runId: 'run-1',
  stageIdx: 0,
  stages: [{ index: 0, vus: 10, durationSec: 30, metrics: stageMetricsOf(metricsOf(200)), verdict: 'pass' as const }],
  thresholds: { p95Ms: 1500, errorRatePct: 2 },
  nextVus: 20,
};

function supervisorFor(delayMs: number, calls: unknown[], overallTimeoutMs: number): { supervise: ReturnType<typeof makeSupervisor>; store: Store } {
  const store = new Store(':memory:');
  const fetchImpl = asFetch((_url, init) =>
    delayMs === 0
      ? Promise.resolve(chatResponse(calls))
      : new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(chatResponse(calls)), delayMs);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
          }, { once: true });
        }),
  );
  const client = new InferenceClient({ config: testConfig().inference, store, fetchImpl });
  return { supervise: makeSupervisor({ client, overallTimeoutMs }), store };
}

describe('Property 16 (delay): a decision must arrive within the overall window', () => {
  test('the same valid response is accepted when fast and discarded when it arrives after the window', async () => {
    // Feature: macro, Property 16: Supervisor response validation
    const valid = [toolCallOf('decide_next_stage', { decision: 'stop', reason: 'p95 is climbing' })];
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (late) => {
        const { supervise, store } = supervisorFor(late ? 400 : 0, valid, 40);
        const result = await supervise({ ...CTX_BASE, signal: new AbortController().signal });
        expect(result).toEqual(late ? null : { decision: 'stop', reason: 'p95 is climbing' });
        store.close();
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe('makeSupervisor wiring', () => {
  test('sends decide_next_stage as the forced tool with only measured numbers, and records the call', async () => {
    const bodies: Record<string, unknown>[] = [];
    const store = new Store(':memory:');
    const fetchImpl = asFetch(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return chatResponse([toolCallOf('decide_next_stage', { decision: 'continue', reason: 'Stage 1 looks healthy' })]);
    });
    const client = new InferenceClient({ config: testConfig().inference, store, fetchImpl });
    const result = await makeSupervisor({ client })({ ...CTX_BASE, signal: new AbortController().signal });
    expect(result).toEqual({ decision: 'continue', reason: 'Stage 1 looks healthy' });
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as { tools: { function: { name: string } }[]; tool_choice: { function: { name: string } }; messages: { content: string }[] };
    expect(body.tools.map((t) => t.function.name)).toEqual(['decide_next_stage']);
    expect(body.tool_choice.function.name).toBe('decide_next_stage');
    expect(body.messages[1]?.content).toBe(supervisorUserMessage(CTX_BASE));
    const rows = store.listModelCallsForRun('run-1');
    expect(rows.map((r) => [r.agent, r.outcome])).toEqual([['supervisor', 'success']]);
    expect(decideNextStageTool().parameters).toMatchObject({ required: ['decision', 'reason'] });
  });

  test('a failing primary falls back once and a good fallback answer is used', async () => {
    let n = 0;
    const store = new Store(':memory:');
    const fetchImpl = asFetch(async () => {
      n += 1;
      return n === 1
        ? new Response('upstream down', { status: 502 })
        : chatResponse([toolCallOf('decide_next_stage', { decision: 'stop', reason: 'saturating' })]);
    });
    const client = new InferenceClient({ config: testConfig().inference, store, fetchImpl });
    const result = await makeSupervisor({ client })({ ...CTX_BASE, signal: new AbortController().signal });
    expect(result).toEqual({ decision: 'stop', reason: 'saturating' });
    expect(store.listModelCallsForRun('run-1').map((r) => r.outcome)).toEqual(['error', 'success']);
  });

  test('both models failing yields null (the verdict applies alone)', async () => {
    const fetchImpl = asFetch(async () => new Response('x', { status: 500 }));
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl });
    expect(await makeSupervisor({ client })({ ...CTX_BASE, signal: new AbortController().signal })).toBeNull();
  });

  test('a response with no decide_next_stage call yields null', async () => {
    const fetchImpl = asFetch(async () => chatResponse([toolCallOf('write_report', { explanation: 'x', suggestions: [] })]));
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl });
    expect(await makeSupervisor({ client })({ ...CTX_BASE, signal: new AbortController().signal })).toBeNull();
  });

  test('a caller abort stops the wait at once and makes no fallback attempt', async () => {
    let calls = 0;
    const fetchImpl = asFetch((_url, init) => {
      calls += 1;
      return hangUntilAborted(init);
    });
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl });
    const ac = new AbortController();
    const pending = makeSupervisor({ client })({ ...CTX_BASE, signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    expect(await pending).toBeNull();
    expect(calls).toBe(1);
  });
});
