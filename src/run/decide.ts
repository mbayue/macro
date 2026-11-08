// Decision application for the Run_Controller (requirements 8.2-8.8). Pure.

export type StageVerdictValue = 'pass' | 'fail';

export type AgentDecision = { decision: 'continue' | 'stop'; reason: string } | null;

export type FallbackReasonKind = 'no_valid_decision' | 'fail_override';
export type DecisionReasonKind = 'agent' | FallbackReasonKind;

export type Applied =
  // Last Stage: no Supervisor request and no decision record (8.7).
  | { action: 'complete' | 'halt'; record: false; reasonKind: 'last_stage' }
  // Non-last Stage: the Run_Store records decision, source, and reason (8.8).
  | {
      action: 'continue' | 'halt';
      record: true;
      decision: 'continue' | 'stop';
      source: 'agent' | 'fallback';
      reasonKind: DecisionReasonKind;
      /** Agent reason (still needs the Number_Guard) for source `agent`; fixed text otherwise. */
      reason: string;
    };

const FALLBACK_REASONS: Record<FallbackReasonKind, string> = {
  no_valid_decision: 'No valid Supervisor_Agent decision was received; the Stage_Verdict was applied alone.',
  fail_override: 'The Stage_Verdict was fail, which overrode the Supervisor_Agent decision to continue.',
};

export function fallbackReason(kind: FallbackReasonKind): string {
  return FALLBACK_REASONS[kind];
}

export function applyDecision(isLast: boolean, verdict: StageVerdictValue, agent: AgentDecision): Applied {
  if (isLast) {
    return verdict === 'pass'
      ? { action: 'complete', record: false, reasonKind: 'last_stage' }
      : { action: 'halt', record: false, reasonKind: 'last_stage' };
  }
  const decision: 'continue' | 'stop' = verdict === 'fail' ? 'stop' : (agent?.decision ?? 'continue');
  const action = decision === 'stop' ? 'halt' : 'continue';
  if (agent !== null && agent.decision === decision) {
    return { action, record: true, decision, source: 'agent', reasonKind: 'agent', reason: agent.reason };
  }
  const reasonKind: FallbackReasonKind =
    agent !== null && agent.decision === 'continue' && verdict === 'fail' ? 'fail_override' : 'no_valid_decision';
  return { action, record: true, decision, source: 'fallback', reasonKind, reason: fallbackReason(reasonKind) };
}

const TOOL_NAME = 'decide_next_stage';
const MAX_REASON = 500;

function readArgs(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function callName(call: unknown): { name: unknown; args: unknown } {
  if (typeof call !== 'object' || call === null) return { name: undefined, args: undefined };
  const c = call as Record<string, unknown>;
  // OpenAI shape: { type: 'function', function: { name, arguments } }; also accept flat { name, arguments }.
  const fn = typeof c['function'] === 'object' && c['function'] !== null ? (c['function'] as Record<string, unknown>) : c;
  return { name: fn['name'], args: fn['arguments'] };
}

/**
 * Accepts only the first `decide_next_stage` call (requirement 8.6). Later calls and other
 * tools are ignored; if that first call is invalid the result is null (no fallback to a later call).
 */
export function validateSupervisorToolCall(
  toolCalls: unknown,
): { decision: 'continue' | 'stop'; reason: string } | null {
  if (!Array.isArray(toolCalls)) return null;
  for (const call of toolCalls) {
    const { name, args } = callName(call);
    if (name !== TOOL_NAME) continue;
    const parsed = readArgs(args);
    if (parsed === null) return null;
    const decision = parsed['decision'];
    const reason = parsed['reason'];
    if (decision !== 'continue' && decision !== 'stop') return null;
    if (typeof reason !== 'string') return null;
    const length = [...reason].length;
    if (length < 1 || length > MAX_REASON) return null;
    return { decision, reason };
  }
  return null;
}
