import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { InferenceClient } from '../src/agents/inference.ts';
import type { CallToolOptions, CallToolResult } from '../src/agents/inference.ts';
import { planTrafficEvent } from '../src/agents/planner.ts';
import type { PlanOutcome } from '../src/agents/planner.ts';
import { Store } from '../src/store/db.ts';
import { API, WEB, asFetch, chatResponse, hangUntilAborted, samplePlan, testConfig, toolCallOf } from './arb-agents.ts';

type Attempt = 'valid' | 'no_tool_call' | 'bad_rationale' | 'unparsable' | 'gate_rejected' | 'error' | 'timeout';
const ATTEMPTS: readonly Attempt[] = ['valid', 'no_tool_call', 'bad_rationale', 'unparsable', 'gate_rejected', 'error', 'timeout'];
const NETWORK_FAILURES: ReadonlySet<Attempt> = new Set<Attempt>(['error', 'timeout']);

const target = { webOrigin: WEB, apiOrigin: API, allowlist: [WEB, API] } as const;
const VALID_PLAN = samplePlan();
const REJECTED_PLAN = samplePlan({ stages: [{ vus: 600, durationSec: 30 }] }); // vus above 500

function responseFor(kind: Attempt, init: RequestInit): Promise<Response> {
  switch (kind) {
    case 'valid':
      return Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan: VALID_PLAN, rationale: 'A gentle ladder.' })]));
    case 'no_tool_call':
      return Promise.resolve(chatResponse([toolCallOf('something_else', { x: 1 })]));
    case 'bad_rationale':
      return Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan: VALID_PLAN, rationale: 'r'.repeat(301) })]));
    case 'unparsable':
      return Promise.resolve(chatResponse([toolCallOf('propose_plan', '{"plan": {"name": ')]));
    case 'gate_rejected':
      return Promise.resolve(chatResponse([toolCallOf('propose_plan', { plan: REJECTED_PLAN, rationale: 'Too hard.' })]));
    case 'error':
      return Promise.resolve(new Response('upstream failure', { status: 500 }));
    case 'timeout':
      return hangUntilAborted(init);
  }
}

/** The real client with a short per-attempt timeout so that the `timeout` outcome is quick. */
class FastClient extends InferenceClient {
  override callTool(o: CallToolOptions): Promise<CallToolResult> {
    return super.callTool({ ...o, timeoutMs: 25 });
  }
}

interface Seen {
  body: { model: string; messages: { role: string; content: string }[] };
}

async function runPlanner(outcomes: readonly Attempt[]): Promise<{ result: PlanOutcome; seen: Seen[]; store: Store; consumed: Attempt[] }> {
  const store = new Store(':memory:');
  const seen: Seen[] = [];
  const consumed: Attempt[] = [];
  const fetchImpl = asFetch((_url, init) => {
    const kind = outcomes[seen.length] ?? 'error';
    consumed.push(kind);
    seen.push({ body: JSON.parse(String(init.body)) as Seen['body'] });
    return responseFor(kind, init);
  });
  const client = new FastClient({ config: testConfig().inference, store, fetchImpl });
  const result = await planTrafficEvent({ client, target }, 'Flash sale at noon, about two thousand shoppers', 'draft-1');
  return { result, seen, store, consumed };
}

/** Reference model of the attempt budget, written from requirements 2.2, 2.3, 2.6, 2.7. */
function simulate(outcomes: readonly Attempt[]): {
  fetchCalls: number;
  logicalRequests: number;
  final: 'plan_accepted' | 'plan_rejected' | 'parse_error' | 'planning_failed';
  secondRequestFeedback: Attempt | null;
} {
  let at = 0;
  const request = (): Attempt | 'failed' => {
    const primary = outcomes[at++] as Attempt;
    if (!NETWORK_FAILURES.has(primary)) return primary;
    const fallback = outcomes[at++] as Attempt;
    return NETWORK_FAILURES.has(fallback) ? 'failed' : fallback;
  };
  const classify = (k: Attempt): 'plan_accepted' | 'plan_rejected' | 'parse_error' =>
    k === 'valid' ? 'plan_accepted' : k === 'gate_rejected' ? 'plan_rejected' : 'parse_error';

  const first = request();
  if (first === 'failed') return { fetchCalls: at, logicalRequests: 1, final: 'planning_failed', secondRequestFeedback: null };
  if (first === 'valid') return { fetchCalls: at, logicalRequests: 1, final: 'plan_accepted', secondRequestFeedback: null };
  const second = request();
  if (second === 'failed') return { fetchCalls: at, logicalRequests: 2, final: 'planning_failed', secondRequestFeedback: first };
  return { fetchCalls: at, logicalRequests: 2, final: classify(second), secondRequestFeedback: first };
}

const FEEDBACK_MARKER: Partial<Record<Attempt, string>> = {
  no_tool_call: 'no propose_plan tool call',
  bad_rationale: 'rationale',
  unparsable: 'not valid JSON',
  gate_rejected: 'policy rule',
};

describe('Property 17: Planner attempt budget', () => {
  test('at most 2 requests and 4 attempts, identical fallback body, feedback in the second request, one row per attempt', async () => {
    // Feature: macro, Property 17: Planner attempt budget
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...ATTEMPTS), { minLength: 4, maxLength: 4 }), async (outcomes) => {
        const { result, seen, store } = await runPlanner(outcomes);
        const sim = simulate(outcomes);
        const cfg = testConfig().inference;

        // Budget.
        expect(seen.length).toBe(sim.fetchCalls);
        expect(seen.length).toBeLessThanOrEqual(4);
        const primaries = seen.filter((s) => s.body.model === cfg.model);
        expect(primaries.length).toBe(sim.logicalRequests);
        expect(primaries.length).toBeLessThanOrEqual(2);

        // Fallback exactly after a failed primary, with an identical body apart from the model.
        seen.forEach((s, i) => {
          if (s.body.model !== cfg.fallbackModel) return;
          expect(NETWORK_FAILURES.has(outcomes[i - 1] as Attempt)).toBe(true);
          expect(seen[i - 1]?.body.model).toBe(cfg.model);
          const { model: _m1, ...before } = (seen[i - 1] as Seen).body;
          const { model: _m2, ...after } = s.body;
          expect(after).toEqual(before);
        });
        // ...and every failed primary was followed by a fallback attempt.
        seen.forEach((s, i) => {
          if (s.body.model === cfg.model && NETWORK_FAILURES.has(outcomes[i] as Attempt)) {
            expect(seen[i + 1]?.body.model).toBe(cfg.fallbackModel);
          }
        });

        // The second logical request carries the first request's errors; the first carries none.
        const secondStart = seen.findIndex((s, i) => i > 0 && s.body.model === cfg.model);
        expect(seen[0]?.body.messages).toHaveLength(2);
        if (sim.logicalRequests === 2) {
          expect(secondStart).toBeGreaterThan(0);
          const messages = (seen[secondStart] as Seen).body.messages;
          expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
          const feedback = messages[3]?.content ?? '';
          expect(feedback).toContain('Errors:');
          const marker = sim.secondRequestFeedback === null ? undefined : FEEDBACK_MARKER[sim.secondRequestFeedback];
          expect(marker).toBeDefined();
          expect(feedback).toContain(marker as string);
        } else {
          expect(secondStart).toBe(-1);
        }

        // Exactly one model_calls row per attempt, in order, with the right outcome.
        const rows = store.listModelCallsForDraft('draft-1');
        expect(rows).toHaveLength(seen.length);
        rows.forEach((row, i) => {
          const kind = outcomes[i] as Attempt;
          expect(row.agent).toBe('planner');
          expect(row.model).toBe(seen[i]?.body.model as string);
          expect(row.outcome).toBe(kind === 'error' ? 'error' : kind === 'timeout' ? 'timeout' : 'success');
        });

        // Final result.
        switch (sim.final) {
          case 'planning_failed':
            expect(result).toEqual({ ok: false, error: 'planning_failed' });
            break;
          case 'plan_accepted':
            expect(result).toMatchObject({ ok: true, gate: { status: 'accepted' }, parseError: null });
            break;
          case 'plan_rejected':
            expect(result).toMatchObject({ ok: true, gate: { status: 'rejected' }, parseError: null });
            break;
          case 'parse_error':
            expect(result).toMatchObject({ ok: true, plan: null, gate: null });
            break;
        }
        store.close();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});

describe('planner examples', () => {
  test('a valid first answer costs one attempt', async () => {
    const { result, seen } = await runPlanner(['valid']);
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, rationale: 'A gentle ladder.' });
    expect(result.ok && result.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('both attempts of the first request failing stops planning (no second request)', async () => {
    const { result, seen } = await runPlanner(['error', 'timeout', 'valid', 'valid']);
    expect(result).toEqual({ ok: false, error: 'planning_failed' });
    expect(seen).toHaveLength(2);
  });

  test('worst case: four attempts, then the second request result is returned', async () => {
    const { result, seen } = await runPlanner(['error', 'no_tool_call', 'timeout', 'gate_rejected']);
    expect(seen).toHaveLength(4);
    expect(result).toMatchObject({ ok: true, gate: { status: 'rejected' } });
  });

  test('an unconfigured key is reported and makes no request', async () => {
    let calls = 0;
    const fetchImpl = asFetch(async () => {
      calls += 1;
      return new Response('', { status: 500 });
    });
    const config = { ...testConfig().inference, apiKey: '' };
    const client = new InferenceClient({ config, fetchImpl });
    expect(await planTrafficEvent({ client, target }, 'some traffic event here', 'd')).toEqual({ ok: false, error: 'inference_not_configured' });
    expect(calls).toBe(0);
  });

  test('the Traffic_Event travels in its own tagged message, apart from the instructions', async () => {
    const { seen } = await runPlanner(['valid']);
    const [system, user] = seen[0]?.body.messages ?? [];
    expect(system?.content).not.toContain('Flash sale at noon');
    expect(user?.content).toContain('<traffic_event>');
    expect(user?.content).toContain('Flash sale at noon');
  });
});
