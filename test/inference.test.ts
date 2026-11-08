import { describe, expect, test } from 'bun:test';
import { InferenceClient, argsAsText, firstToolCall, readToolCall } from '../src/agents/inference.ts';
import type { CallToolOptions } from '../src/agents/inference.ts';
import { Store } from '../src/store/db.ts';
import { API_KEY, asFetch, chatResponse, hangUntilAborted, testConfig, toolCallOf } from './arb-agents.ts';

const TOOL = {
  name: 'decide_next_stage',
  description: 'Decide.',
  parameters: { type: 'object', properties: { decision: { type: 'string' } } },
};

function opts(patch: Partial<CallToolOptions> = {}): CallToolOptions {
  return { agent: 'supervisor', system: 'SYS', user: 'USR', tool: TOOL, timeoutMs: 1000, runId: 'run-1', ...patch };
}

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function recorder(respond: (n: number, init: RequestInit) => Promise<Response> | Response): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = asFetch(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return respond(calls.length, init);
  });
  return { fetchImpl, calls };
}

const GOOD = (): Response => chatResponse([toolCallOf('decide_next_stage', { decision: 'stop', reason: 'r' })], { prompt_tokens: 120, completion_tokens: 15 });

describe('request shape', () => {
  test('body uses tools and a forced tool_choice for the one tool', async () => {
    const { fetchImpl, calls } = recorder(GOOD);
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl });
    const result = await client.callTool(opts({ history: [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: 'fix it' }] }));
    expect(result.ok).toBe(true);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['tools']).toEqual([{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.parameters } }]);
    expect(body['tool_choice']).toEqual({ type: 'function', function: { name: TOOL.name } });
    expect(body['model']).toBe(testConfig().inference.model);
    expect(body['messages']).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'fix it' },
    ]);
    expect(typeof body['max_tokens']).toBe('number');
  });

  test('URL is the configured base plus /chat/completions (trailing slashes trimmed)', async () => {
    for (const base of ['https://inference.example.test/v1', 'https://inference.example.test/v1/', 'https://inference.example.test/v1///']) {
      const { fetchImpl, calls } = recorder(GOOD);
      const config = { ...testConfig().inference, baseUrl: base };
      await new InferenceClient({ config, fetchImpl }).callTool(opts());
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://inference.example.test/v1/chat/completions');
    }
  });

  test('the default base URL is the Vultr endpoint', async () => {
    const { fetchImpl, calls } = recorder(GOOD);
    await new InferenceClient({ config: testConfig().inference, fetchImpl }).callTool(opts());
    expect(calls[0]?.url).toBe('https://api.vultrinference.com/v1/chat/completions');
  });

  test('the key travels only in the Authorization header', async () => {
    const { fetchImpl, calls } = recorder(GOOD);
    await new InferenceClient({ config: testConfig().inference, fetchImpl }).callTool(opts({ system: 'sys', user: 'u' }));
    const init = calls[0]?.init as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(String(init.body)).not.toContain(API_KEY);
    expect(calls[0]?.url).not.toContain(API_KEY);
    for (const [name, value] of Object.entries(headers)) {
      if (name !== 'Authorization') expect(value).not.toContain(API_KEY);
    }
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
  });
});

describe('fallback: one identical attempt on the fallback model', () => {
  test('a failed primary is retried once with the same body and the fallback model', async () => {
    const { fetchImpl, calls } = recorder((n) => (n === 1 ? new Response('boom', { status: 500 }) : GOOD()));
    const store = new Store(':memory:');
    const cfg = testConfig().inference;
    const result = await new InferenceClient({ config: cfg, fetchImpl, store }).callTool(opts());
    expect(result).toMatchObject({ ok: true, model: cfg.fallbackModel });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body['model']).toBe(cfg.model);
    expect(calls[1]?.body['model']).toBe(cfg.fallbackModel);
    const { model: _a, ...first } = calls[0]?.body as Record<string, unknown>;
    const { model: _b, ...second } = calls[1]?.body as Record<string, unknown>;
    expect(second).toEqual(first);
    expect(store.listModelCallsForRun('run-1').map((r) => [r.model, r.outcome])).toEqual([
      [cfg.model, 'error'],
      [cfg.fallbackModel, 'success'],
    ]);
  });

  test('no third attempt when both fail; the error is a fixed string', async () => {
    const { fetchImpl, calls } = recorder(() => new Response('upstream says: bad key', { status: 401 }));
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl }).callTool(opts());
    expect(result).toEqual({ ok: false, error: 'request_failed' });
    expect(calls).toHaveLength(2);
  });

  test('a successful primary makes no fallback attempt', async () => {
    const { fetchImpl, calls } = recorder(GOOD);
    await new InferenceClient({ config: testConfig().inference, fetchImpl }).callTool(opts());
    expect(calls).toHaveLength(1);
  });

  test('an empty fallback model means a single attempt', async () => {
    const { fetchImpl, calls } = recorder(() => new Response('x', { status: 500 }));
    const config = { ...testConfig().inference, fallbackModel: '  ' };
    const result = await new InferenceClient({ config, fetchImpl }).callTool(opts());
    expect(result).toEqual({ ok: false, error: 'request_failed' });
    expect(calls).toHaveLength(1);
  });

  test('a timed-out primary is recorded as timeout and then falls back', async () => {
    const { fetchImpl } = recorder((n, init) => (n === 1 ? hangUntilAborted(init) : GOOD()));
    const store = new Store(':memory:');
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts({ timeoutMs: 30 }));
    expect(result.ok).toBe(true);
    expect(store.listModelCallsForRun('run-1').map((r) => r.outcome)).toEqual(['timeout', 'success']);
  });

  test('a fetch that ignores its signal is still cut off at the timeout', async () => {
    const { fetchImpl } = recorder(() => new Promise<Response>(() => {}));
    const store = new Store(':memory:');
    const started = Date.now();
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts({ timeoutMs: 30 }));
    expect(result).toEqual({ ok: false, error: 'request_failed' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(store.listModelCallsForRun('run-1').map((r) => r.outcome)).toEqual(['timeout', 'timeout']);
  });

  test('a caller abort ends the call without a fallback attempt', async () => {
    const { fetchImpl, calls } = recorder((_n, init) => hangUntilAborted(init));
    const ac = new AbortController();
    const pending = new InferenceClient({ config: testConfig().inference, fetchImpl }).callTool(opts({ signal: ac.signal, timeoutMs: 5000 }));
    setTimeout(() => ac.abort(), 10);
    expect(await pending).toEqual({ ok: false, error: 'request_failed' });
    expect(calls).toHaveLength(1);
  });
});

describe('the key never leaves the client', () => {
  test('a transport error that carries the key does not reach the result or the store', async () => {
    const { fetchImpl } = recorder(() => Promise.reject(new Error(`connect failed, Authorization: Bearer ${API_KEY}`)));
    const store = new Store(':memory:');
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts({ draftId: 'd1' }));
    expect(result).toEqual({ ok: false, error: 'request_failed' });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    const rows = [...store.listModelCallsForRun('run-1'), ...store.listModelCallsForDraft('d1')];
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(API_KEY);
  });

  test('an upstream error body that echoes the key does not reach the result or the store', async () => {
    const { fetchImpl } = recorder(() => new Response(`invalid key ${API_KEY}`, { status: 401 }));
    const store = new Store(':memory:');
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts());
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(store.listModelCallsForRun('run-1'))).not.toContain(API_KEY);
  });

  test('a successful result and its stored row do not contain the key', async () => {
    const { fetchImpl } = recorder(GOOD);
    const store = new Store(':memory:');
    const result = await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts());
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(store.listModelCallsForRun('run-1'))).not.toContain(API_KEY);
  });
});

describe('configuration and bookkeeping', () => {
  test('an empty key makes no request', async () => {
    const { fetchImpl, calls } = recorder(GOOD);
    const config = { ...testConfig().inference, apiKey: '   ' };
    const client = new InferenceClient({ config, fetchImpl });
    expect(client.configured).toBe(false);
    expect(await client.callTool(opts())).toEqual({ ok: false, error: 'inference_not_configured' });
    expect(calls).toHaveLength(0);
  });

  test('one row per attempt with agent, model, outcome, latency, and token counts', async () => {
    const { fetchImpl } = recorder(GOOD);
    const store = new Store(':memory:');
    let t = 1_000;
    const client = new InferenceClient({ config: testConfig().inference, fetchImpl, store, now: () => (t += 25) });
    await client.callTool(opts({ agent: 'reporter', runId: 'run-9' }));
    const [row, ...rest] = store.listModelCallsForRun('run-9');
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ agent: 'reporter', model: testConfig().inference.model, outcome: 'success', promptTokens: 120, completionTokens: 15 });
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('missing usage is stored as null ("not reported")', async () => {
    const { fetchImpl } = recorder(() => chatResponse([toolCallOf('decide_next_stage', {})]));
    const store = new Store(':memory:');
    await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts());
    expect(store.listModelCallsForRun('run-1')[0]).toMatchObject({ promptTokens: null, completionTokens: null });
  });

  test('a 200 without choices is an error attempt; a 200 without tool calls is a success with none', async () => {
    const bad = recorder(() => new Response('{"nope":1}', { status: 200 }));
    expect(await new InferenceClient({ config: testConfig().inference, fetchImpl: bad.fetchImpl }).callTool(opts())).toEqual({ ok: false, error: 'request_failed' });
    expect(bad.calls).toHaveLength(2);
    const none = recorder(() => chatResponse(undefined));
    expect(await new InferenceClient({ config: testConfig().inference, fetchImpl: none.fetchImpl }).callTool(opts())).toMatchObject({ ok: true, toolCalls: [] });
    expect(none.calls).toHaveLength(1);
  });

  test('a store failure does not turn a good answer into an error', async () => {
    const { fetchImpl } = recorder(GOOD);
    const store = new Store(':memory:');
    store.close();
    expect((await new InferenceClient({ config: testConfig().inference, fetchImpl, store }).callTool(opts())).ok).toBe(true);
  });
});

describe('tool-call helpers', () => {
  test('readToolCall / firstToolCall / argsAsText', () => {
    const calls = [null, 7, { function: { name: 1 } }, toolCallOf('a', { n: 1 }), toolCallOf('a', { n: 2 }), { name: 'b', arguments: '{"flat":true}' }];
    expect(readToolCall(calls[3])).toEqual({ name: 'a', args: '{"n":1}' });
    expect(firstToolCall(calls, 'a')?.args).toBe('{"n":1}');
    expect(firstToolCall(calls, 'b')?.args).toBe('{"flat":true}');
    expect(firstToolCall(calls, 'zzz')).toBeNull();
    expect(argsAsText({ x: 1 })).toBe('{"x":1}');
    expect(argsAsText('{"y":2}')).toBe('{"y":2}');
    expect(argsAsText(5)).toBeNull();
    expect(argsAsText([1])).toBeNull();
  });
});
