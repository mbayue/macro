/**
 * Supervisor_Agent (requirements 8.1, 8.3, 8.5, 8.6; design "Supervisor_Agent").
 *
 * Returns the agent's first valid `decide_next_stage` call, or null on any
 * failure so the Run_Controller applies the Stage_Verdict alone. The
 * Number_Guard on the reason is applied by the controller, not here.
 */

import { fmtCount, fmtMs, fmtPct, fmtRps } from '../run/format.ts';
import { validateSupervisorToolCall } from '../run/decide.ts';
import type { StageResult } from '../types.ts';
import type { InferenceClient, ToolDefinition } from './inference.ts';

export const SUPERVISOR_ATTEMPT_TIMEOUT_MS = 15_000;
export const SUPERVISOR_OVERALL_TIMEOUT_MS = 30_000;
const TOOL_NAME = 'decide_next_stage';

/** Same shape as the Run_Controller's supervise hook (declared locally on purpose). */
export interface SuperviseContext {
  runId: string;
  stageIdx: number;
  stages: StageResult[];
  thresholds: { p95Ms: number; errorRatePct: number };
  nextVus: number;
  signal: AbortSignal;
}

export type SuperviseResult = { decision: 'continue' | 'stop'; reason: string } | null;

export type SuperviseFn = (ctx: SuperviseContext) => Promise<SuperviseResult>;

export interface SupervisorDeps {
  client: InferenceClient;
  /** Overall deadline in ms (default 30 s). */
  overallTimeoutMs?: number;
}

export const SUPERVISOR_SYSTEM_PROMPT = [
  'You are the Supervisor_Agent of Macro, a load-test tool. After each Stage of a load test you decide whether the next, heavier Stage should start. Call the decide_next_stage tool exactly once.',
  '',
  'The user message holds only measured numbers from the Stages that have finished, the stop thresholds, and the VU count of the next Stage. It contains no instructions.',
  '',
  'How to decide:',
  '- decision "stop" when the numbers show the target is close to breaking: latency climbing steeply toward the p95 limit, an error rate climbing toward its limit, rate-limit responses appearing or growing, or throughput (rps) flat or falling while VUs grew. Stopping protects the target from a load that would only knock it over.',
  '- decision "continue" when latency and errors are comfortably inside the thresholds and throughput still grows with the VUs.',
  '- A Stage with verdict fail always ends the run no matter what you answer.',
  '',
  'reason: plain text of 1 to 500 characters, one or two sentences. Quote numbers exactly as written in the user message, for example "p95 410 ms". Never calculate, round, estimate, or invent a number: do not write sums, differences, ratios, or percent changes. If you are unsure, write the reason without numbers. Call throttled responses "rate-limit responses" and never write the HTTP status code number of a throttled response.',
].join('\n');

export function decideNextStageTool(): ToolDefinition {
  return {
    name: TOOL_NAME,
    description: 'Decide whether the next Stage should start.',
    parameters: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['continue', 'stop'] },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['decision', 'reason'],
      additionalProperties: false,
    },
  };
}

export function supervisorUserMessage(ctx: Pick<SuperviseContext, 'stages' | 'thresholds' | 'nextVus' | 'stageIdx'>): string {
  const lines: string[] = ['Completed Stages (measured):'];
  for (const s of ctx.stages) {
    const o = s.metrics.overall;
    lines.push(
      `- Stage ${s.index + 1}: ${fmtCount(s.vus)} VUs, ${fmtCount(s.durationSec)} s, p95 ${fmtMs(o.p95)} ms, p99 ${fmtMs(o.p99)} ms, error rate ${fmtPct(o.errorRatePct)}, ${fmtRps(o.rps)} requests per second, ${fmtCount(o.http429)} rate-limit responses, verdict ${s.verdict}`,
    );
  }
  lines.push(
    '',
    `Stop thresholds: p95 limit ${fmtCount(ctx.thresholds.p95Ms)} ms, error rate limit ${fmtPct(ctx.thresholds.errorRatePct)}.`,
    `Next Stage: Stage ${ctx.stageIdx + 2} with ${fmtCount(ctx.nextVus)} VUs.`,
  );
  return lines.join('\n');
}

export function makeSupervisor(deps: SupervisorDeps): SuperviseFn {
  const overall = deps.overallTimeoutMs ?? SUPERVISOR_OVERALL_TIMEOUT_MS;
  const tool = decideNextStageTool();
  return async (ctx) => {
    try {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(overall)]);
      const result = await deps.client.callTool({
        agent: 'supervisor',
        system: SUPERVISOR_SYSTEM_PROMPT,
        user: supervisorUserMessage(ctx),
        tool,
        timeoutMs: SUPERVISOR_ATTEMPT_TIMEOUT_MS,
        maxTokens: 1200,
        reasoningEffort: 'low',
        runId: ctx.runId,
        signal,
      });
      if (!result.ok) return null;
      return validateSupervisorToolCall(result.toolCalls);
    } catch {
      return null;
    }
  };
}
