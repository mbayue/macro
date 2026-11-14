/**
 * Containment probe view-model (pure): action labels, wording, event list helpers.
 */
import type { ContainmentEventPayload, EventView, RunView } from '../../../../../src/api-types.ts';
import type {
  ProbeActionId,
  ProbeActionResult,
  ProbeClassification,
  ProbeVerdict,
} from '../../../../../src/k6/probe-result.ts';
import type { ContainmentType, RunStatus } from '../../../../../src/types.ts';

// ---------------------------------------------------------------------------
// Pure view-model
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Same ids, order and labels as PROBE_ACTIONS in src/k6/probe-result.ts. Copied
 * here because that module imports zod, which would add it to the browser bundle
 * (only types are imported from it).
 */
export const PROBE_ACTIONS: readonly { id: ProbeActionId; label: string }[] = [
  { id: 'a', label: 'HTTPS request to a host outside the allowlist' },
  { id: 'b', label: 'HTTP request to the cloud metadata address 169.254.169.254' },
  { id: 'c', label: 'Request to the Macro API' },
  { id: 'd', label: 'Check environment variable names for KEY, SECRET, or TOKEN' },
  { id: 'e', label: 'Allocate more than 1 GiB of memory' },
];

const ACTION_RESULTS: readonly ProbeActionResult[] = ['contained', 'escaped', 'no result'];

/** What each action tries, in plain words (shown in the table). */
const ACTION_TARGETS: Readonly<Record<ProbeActionId, string>> = {
  a: 'A website that is not on the allowlist (example.com over HTTPS)',
  b: 'The cloud metadata address 169.254.169.254 over HTTP',
  c: "Macro's own API, reached from inside the sandbox",
  d: "The sandbox's environment variable names (only names are read, never values)",
  e: 'More than 1 GiB of memory, more than the sandbox is allowed',
};

/** What each action does and what "contained" means (shown once, in the details block). */
export const ACTION_EXPLANATIONS: Readonly<Record<ProbeActionId, string>> = {
  a: 'Tries to open an HTTPS connection to a website that is not on the allowlist. It is contained when no response comes back, because the egress proxy refuses the connection.',
  b: 'Tries to reach 169.254.169.254, the address where cloud servers expose their metadata and sometimes credentials. It is contained when no response comes back.',
  c: "Tries to call Macro's own API from inside the sandbox. It is contained when no response comes back, so a test cannot reach back into Macro.",
  d: 'Lists environment variable names that contain KEY, SECRET or TOKEN in any letter case. Only the matching names are reported, never their values. It is contained when no name matches, because the sandbox holds no secrets.',
  e: 'Allocates more than 1 GiB of memory. The sandbox memory cap kills the process, and that kill is the expected "contained" outcome. It would count as escaped only if the allocation finished.',
};

const PROBE_ACTION_IDS: readonly ProbeActionId[] = PROBE_ACTIONS.map((a) => a.id);

/** Overall result from the five action results (same rule as the server classifier). */
export function deriveVerdict(actions: Readonly<Record<ProbeActionId, ProbeActionResult>>): {
  result: ProbeVerdict;
  escaped: ProbeActionId[];
} {
  const escaped = PROBE_ACTION_IDS.filter((id) => actions[id] === 'escaped');
  if (escaped.length > 0) return { result: 'failed', escaped };
  const allContained = PROBE_ACTION_IDS.every((id) => actions[id] === 'contained');
  return { result: allContained ? 'passed' : 'incomplete', escaped };
}

/**
 * Validate the stored `probeResult` (typed `unknown` on the wire). Returns null
 * unless every action carries one of the three known results. The overall
 * result is recomputed from the actions, so a stored verdict that disagrees
 * with them is ignored.
 */
export function readProbeResult(raw: unknown): ProbeClassification | null {
  if (!isRecord(raw)) return null;
  const stored = raw['actions'];
  if (!isRecord(stored)) return null;
  const actions = {} as Record<ProbeActionId, ProbeActionResult>;
  for (const id of PROBE_ACTION_IDS) {
    const value = stored[id];
    const match = ACTION_RESULTS.find((r) => r === value);
    if (match === undefined) return null;
    actions[id] = match;
  }
  return { actions, ...deriveVerdict(actions) };
}

export interface EffectiveProbeResult {
  classification: ProbeClassification;
  /** false when nothing usable was stored, so every action is `no result`. */
  stored: boolean;
}

/**
 * The result to show for an ended probe: the stored classification, or
 * `incomplete` with every action `no result` when it is missing or malformed.
 */
export function effectiveProbeResult(raw: unknown): EffectiveProbeResult {
  const read = readProbeResult(raw);
  if (read) return { classification: read, stored: true };
  const actions = {} as Record<ProbeActionId, ProbeActionResult>;
  for (const id of PROBE_ACTION_IDS) actions[id] = 'no result';
  return { classification: { actions, result: 'incomplete', escaped: [] }, stored: false };
}

export interface ProbeRow {
  id: ProbeActionId;
  label: string;
  target: string;
  result: ProbeActionResult;
  /** Text shown in the badge (never color alone). */
  badgeText: string;
  badgeClass: 'badge--ok' | 'badge--bad' | 'badge--warn';
}

const BADGE_CLASS: Readonly<Record<ProbeActionResult, ProbeRow['badgeClass']>> = {
  contained: 'badge--ok',
  escaped: 'badge--bad',
  'no result': 'badge--warn',
};

/** The five action rows in PROBE_ACTIONS order. */
export function probeRows(c: ProbeClassification): ProbeRow[] {
  return PROBE_ACTIONS.map((a) => {
    const result = c.actions[a.id];
    return {
      id: a.id,
      label: a.label,
      target: ACTION_TARGETS[a.id],
      result,
      badgeText: result,
      badgeClass: BADGE_CLASS[result],
    };
  });
}

function labelOf(id: ProbeActionId): string {
  const found = PROBE_ACTIONS.find((a) => a.id === id);
  return `(${id}) ${found ? found.label : id}`;
}

export interface ProbeVerdictWording {
  verdict: ProbeVerdict;
  /** Short badge text: Passed, Failed, Incomplete. */
  badge: string;
  headline: string;
  /** One sentence per line to show under the headline. */
  details: string[];
  /** Actions named in the failed (escaped) or incomplete (no result) wording. */
  escaped: ProbeActionId[];
  missing: ProbeActionId[];
}

/** Overall result wording (requirements 12.4, 12.5, 12.9). */
export function resultWording(c: ProbeClassification, stored = true): ProbeVerdictWording {
  const { result, escaped } = deriveVerdict(c.actions);
  const missing = PROBE_ACTION_IDS.filter((id) => c.actions[id] === 'no result');
  const details: string[] = [];
  if (result === 'passed') {
    details.push('All five actions were contained. The sandbox could not reach the outside, read secrets, or use more memory than its cap.');
    return { verdict: result, badge: 'Passed', headline: 'Probe passed', details, escaped, missing };
  }
  if (result === 'failed') {
    details.push(`${escaped.length === 1 ? 'This action' : 'These actions'} escaped the sandbox: ${escaped.map(labelOf).join('; ')}.`);
    if (missing.length > 0) {
      details.push(`No result was reported for: ${missing.map(labelOf).join('; ')}.`);
    }
    return { verdict: result, badge: 'Failed', headline: 'Probe failed', details, escaped, missing };
  }
  if (!stored) details.push('The probe did not store a usable result.');
  details.push(`No result was reported for: ${missing.map(labelOf).join('; ')}.`);
  details.push('No action escaped, but the probe cannot be called passed until every action reports.');
  return { verdict: result, badge: 'Incomplete', headline: 'Probe incomplete', details, escaped, missing };
}

export function isProbeEnded(status: RunStatus): boolean {
  return status !== 'running' && status !== 'queued';
}

/** One-line description of the probe's status. */
export function statusText(run: Pick<RunView, 'status' | 'statusReason'>): string {
  let text: string;
  switch (run.status) {
    case 'queued':
      return 'The probe is queued and will start automatically when the active run finishes.';
    case 'running':
      return 'The probe is running.';
    case 'completed':
      text = 'The probe finished.';
      break;
    case 'stopped':
      text = 'The probe was stopped.';
      break;
    case 'timed_out':
      text = 'The probe hit its 60 second time cap and was killed.';
      break;
    case 'failed':
      text = 'The probe could not finish.';
      break;
    case 'interrupted':
      text = 'The probe was interrupted by a server restart.';
      break;
    case 'halted':
      text = 'The probe was halted.';
      break;
  }
  const reason = run.statusReason;
  return reason !== null && reason !== '' ? `${text} ${reason}` : text;
}

// ---- Containment events ---------------------------------------------------

const EVENT_WORDING: Readonly<Record<ContainmentType, string>> = {
  sandbox_created: 'Sandbox created',
  egress_blocked: 'Egress blocked',
  memory_cap_hit: 'Memory cap hit',
  time_cap_hit: 'Time cap hit',
  sandbox_killed: 'Sandbox killed',
  sandbox_removed: 'Sandbox removed',
  runner_created: 'Sandbox runner created',
  runner_deleted: 'Sandbox runner removed',
};

const WARN_EVENTS: ReadonlySet<ContainmentType> = new Set<ContainmentType>([
  'egress_blocked',
  'memory_cap_hit',
  'time_cap_hit',
]);

function isContainmentType(v: unknown): v is ContainmentType {
  return typeof v === 'string' && Object.hasOwn(EVENT_WORDING, v);
}

export interface EventLine {
  id: number;
  ts: number;
  text: string;
  warn: boolean;
}

/** Wording for a containment payload; null when the payload is not a known containment event. */
export function describeContainment(payload: unknown): { text: string; warn: boolean } | null {
  if (!isRecord(payload) || !isContainmentType(payload['type'])) return null;
  const type = payload['type'];
  const host = payload['host'];
  const port = payload['port'];
  let text = EVENT_WORDING[type];
  if (typeof host === 'string' && host !== '') {
    text += `: ${host}${typeof port === 'number' && Number.isFinite(port) ? `:${port}` : ''}`;
  }
  return { text, warn: WARN_EVENTS.has(type) };
}

/** Accept an SSE `data:` string; null unless it is a well-formed event of this run. */
export function parseEventData(data: unknown): EventView | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  const { id, type, runId, stageIdx, payload, ts } = json;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  if (typeof type !== 'string' || typeof runId !== 'string' || typeof ts !== 'number') return null;
  const stage = typeof stageIdx === 'number' ? stageIdx : null;
  return { id, type: type as EventView['type'], runId, stageIdx: stage, payload, ts };
}

/** Add events to a map keyed by event id; an id already present is kept (dedupe). */
export function mergeEvents(into: Map<number, EventView>, incoming: readonly EventView[]): number {
  let added = 0;
  for (const ev of incoming) {
    if (!into.has(ev.id)) {
      into.set(ev.id, ev);
      added += 1;
    }
  }
  return added;
}

/** The probe's containment events as display lines, oldest first. */
export function eventLines(events: Iterable<EventView>, runId: string): EventLine[] {
  const lines: EventLine[] = [];
  for (const ev of events) {
    if (ev.type !== 'containment' || ev.runId !== runId) continue;
    const d = describeContainment(ev.payload);
    if (d) lines.push({ id: ev.id, ts: ev.ts, text: d.text, warn: d.warn });
  }
  lines.sort((a, b) => a.id - b.id);
  return lines;
}

/** Payload type re-exported for callers that build events in checks. */
export type { ContainmentEventPayload };
