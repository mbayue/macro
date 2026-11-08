import { z } from 'zod';

export type ProbeActionId = 'a' | 'b' | 'c' | 'd' | 'e';
export type ProbeActionResult = 'contained' | 'escaped' | 'no result';
export type ProbeVerdict = 'passed' | 'failed' | 'incomplete';

/** Ordered probe actions with the label shown in the UI. */
export const PROBE_ACTIONS: readonly { id: ProbeActionId; label: string }[] = [
  { id: 'a', label: 'HTTPS request to a host outside the allowlist' },
  { id: 'b', label: 'HTTP request to the cloud metadata address 169.254.169.254' },
  { id: 'c', label: 'Request to the Macro API' },
  { id: 'd', label: 'Check environment variable names for KEY, SECRET, or TOKEN' },
  { id: 'e', label: 'Allocate more than 1 GiB of memory' },
] as const;

const NETWORK_ACTION = z.enum(['a', 'b', 'c']);

/** One `MACRO_PROBE` line after validation. */
const probeLineSchema = z.union([
  z.object({ action: NETWORK_ACTION, outcome: z.literal('no_response') }),
  z.object({
    action: NETWORK_ACTION,
    outcome: z.literal('response'),
    status: z.number().int().min(1).max(599),
  }),
  z.object({ action: z.literal('d'), outcome: z.literal('names'), names: z.array(z.string()) }),
  z.object({ action: z.literal('e'), outcome: z.literal('started') }),
]);

export type ProbeLine = z.infer<typeof probeLineSchema>;

/** First valid line per action. */
export type ParsedProbe = Partial<Record<ProbeActionId, ProbeLine>>;

const MARKER = 'MACRO_PROBE ';

/** Parse the JSON payload from the text after the marker; undefined when malformed. */
function parsePayload(rest: string): unknown {
  const end = rest.lastIndexOf('}');
  const start = rest.indexOf('{');
  if (start === -1 || end < start) return undefined;
  const candidate = rest.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // k6 prints console output as logfmt (msg="MACRO_PROBE {\"action\":...}"), so unescape and retry.
  }
  try {
    const unescaped: unknown = JSON.parse(`"${candidate}"`);
    return typeof unescaped === 'string' ? JSON.parse(unescaped) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract `MACRO_PROBE` lines from the Sandbox output. Accepts both raw lines and
 * k6's logfmt-wrapped lines. Malformed lines and unrelated output are ignored;
 * the first valid line for an action wins.
 */
export function parseProbeLogs(stdout: string, stderr: string): ParsedProbe {
  const parsed: ParsedProbe = {};
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const at = line.indexOf(MARKER);
    if (at === -1) continue;
    const payload = parsePayload(line.slice(at + MARKER.length));
    if (payload === undefined) continue;
    const result = probeLineSchema.safeParse(payload);
    if (!result.success) continue;
    const entry = result.data;
    if (parsed[entry.action] === undefined) parsed[entry.action] = entry;
  }
  return parsed;
}

export interface ProbeClassification {
  actions: Record<ProbeActionId, ProbeActionResult>;
  result: ProbeVerdict;
  escaped: ProbeActionId[];
}

export interface ProbeDockerState {
  /** Docker's `State.OOMKilled` for the probe Sandbox. */
  oomKilled: boolean;
  /**
   * Optional: Macro itself killed the Sandbox (time cap). Then action (e) did not
   * run to completion, so it is `no result` rather than `escaped`.
   */
  killedByMacro?: boolean;
}

function networkResult(line: ProbeLine | undefined): ProbeActionResult {
  if (line === undefined) return 'no result';
  return line.outcome === 'no_response' ? 'contained' : 'escaped';
}

function envResult(line: ProbeLine | undefined): ProbeActionResult {
  if (line === undefined || line.outcome !== 'names') return 'no result';
  return line.names.length === 0 ? 'contained' : 'escaped';
}

function memoryResult(line: ProbeLine | undefined, docker: ProbeDockerState): ProbeActionResult {
  if (docker.oomKilled) return 'contained'; // memory cap hit
  if (line === undefined) return 'no result';
  if (docker.killedByMacro === true) return 'no result';
  return 'escaped'; // allocation started and the Sandbox was not stopped by the cap
}

export function classifyProbe(parsed: ParsedProbe, docker: ProbeDockerState): ProbeClassification {
  const actions: Record<ProbeActionId, ProbeActionResult> = {
    a: networkResult(parsed.a),
    b: networkResult(parsed.b),
    c: networkResult(parsed.c),
    d: envResult(parsed.d),
    e: memoryResult(parsed.e, docker),
  };
  const escaped = PROBE_ACTIONS.map((a) => a.id).filter((id) => actions[id] === 'escaped');
  const result: ProbeVerdict =
    escaped.length > 0
      ? 'failed'
      : PROBE_ACTIONS.every((a) => actions[a.id] === 'contained')
        ? 'passed'
        : 'incomplete';
  return { actions, result, escaped };
}
