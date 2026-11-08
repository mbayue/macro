/**
 * Containment probe view (`#/probe/<id>`).
 *
 *   export function renderProbeView(root, ctx, params: { id }): ViewCleanup
 *
 * Loads the run, redirects to `#/run/<id>` when it is not a probe, and while the
 * probe is running polls GET /api/runs/<id> every second and listens to the SSE
 * stream for containment events (deduplicated by event id). When the probe has
 * ended it shows the five actions in PROBE_ACTIONS order, the probe's
 * Containment_Events, the Sandbox_Runtime and the overall result.
 *
 * Requirements: 6.14, 12.1, 12.4, 12.5, 12.9. All API strings are text nodes.
 *
 * The view-model (rows, wording, event list) is in the exported pure functions
 * at the top so it can be checked without a browser.
 */
import type { ContainmentEventPayload, EventView, RunSnapshot, RunView } from '../src/api-types.ts';
import type {
  ProbeActionId,
  ProbeActionResult,
  ProbeClassification,
  ProbeVerdict,
} from '../src/k6/probe-result.ts';
import type { ContainmentType, RunStatus } from '../src/types.ts';
import { type ApiError, getRun } from './api.ts';
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { clear, el, fmtUtc, renderApiError, scrollRegion } from './dom.ts';

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
  return status !== 'running';
}

/** One-line description of the probe's status. */
export function statusText(run: Pick<RunView, 'status' | 'statusReason'>): string {
  let text: string;
  switch (run.status) {
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

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const POLL_MS = 1000;

export function renderProbeView(root: HTMLElement, ctx: AppContext, params: RouteParams): ViewCleanup {
  const id = params['id'] ?? '';
  const events = new Map<number, EventView>();
  let run: RunView | null = null;
  let disposed = false;
  let pollTimer: number | undefined;
  let source: EventSource | null = null;
  let controller: AbortController | null = null;
  let announcedEnd = false;
  let pollFailed = false;
  let renderedKey = '';

  const heading = el('h1', { tabindex: -1 }, 'Containment probe');
  const infoHost = el('div');
  const noteHost = el('div', { class: 'alert', role: 'alert' });
  const progressHost = el('div');
  const resultHost = el('div');
  const actionsHost = el('div');
  const eventsHost = el('div', { class: 'stack stack--tight' });

  const explanation = el(
    'details',
    { class: 'panel probe-details' },
    el('summary', null, 'What each action does'),
    el(
      'dl',
      { class: 'probe-details__list' },
      PROBE_ACTIONS.flatMap((a) => [
        el('dt', null, el('span', { class: 'mono' }, `(${a.id})`), ` ${a.label}`),
        el('dd', null, ACTION_EXPLANATIONS[a.id]),
      ]),
    ),
  );

  root.append(
    el(
      'div',
      { class: 'stack stack--loose' },
      el(
        'div',
        { class: 'stack stack--tight' },
        heading,
        el(
          'p',
          { class: 'muted' },
          'The probe runs inside the sandbox and tries to escape it. Each attempt should be blocked.',
        ),
      ),
      infoHost,
      noteHost,
      progressHost,
      resultHost,
      actionsHost,
      eventsHost,
      explanation,
      el('p', null, el('a', { href: '#/' }, 'Back to the planner')),
    ),
  );

  // ---- Rendering -------------------------------------------------------
  function renderInfo(r: RunView): void {
    clear(infoHost);
    infoHost.append(
      el(
        'dl',
        { class: 'kv' },
        el('dt', null, 'Probe'),
        el('dd', { class: 'mono' }, r.id),
        el('dt', null, 'Sandbox runtime'),
        el('dd', { class: 'mono' }, r.runtime),
        el('dt', null, 'Status'),
        el('dd', null, statusText(r)),
        el('dt', null, 'Started'),
        el('dd', { class: 'mono' }, fmtUtc(r.startedAt)),
        r.endedAt !== null ? el('dt', null, 'Ended') : null,
        r.endedAt !== null ? el('dd', { class: 'mono' }, fmtUtc(r.endedAt)) : null,
      ),
    );
  }

  function renderProgress(r: RunView): void {
    clear(progressHost);
    if (r.status !== 'running') return;
    progressHost.append(
      el(
        'p',
        { class: 'progress', role: 'status' },
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('span', null, 'The probe is running. Results appear when it ends, usually within a minute.'),
      ),
    );
  }

  function renderResult(r: RunView): void {
    clear(resultHost);
    clear(actionsHost);
    if (!isProbeEnded(r.status)) return;
    const { classification, stored } = effectiveProbeResult(r.probeResult);
    const wording = resultWording(classification, stored);
    resultHost.append(
      el(
        'section',
        { class: `panel probe-summary probe-summary--${wording.verdict} stack stack--tight` },
        el('h2', null, 'Result'),
        el('p', null, el('span', { class: `badge ${verdictBadgeClass(wording.verdict)}` }, wording.badge), ' ', wording.headline),
        wording.details.map((line) => el('p', null, line)),
      ),
    );
    actionsHost.append(
      scrollRegion(
        'Probe actions',
        el(
          'table',
          { class: 'table' },
          el('caption', null, 'The five probe actions, in the order they run'),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col' }, 'Action'),
              el('th', { scope: 'col' }, 'What it tried'),
              el('th', { scope: 'col' }, 'Result'),
            ),
          ),
          el(
            'tbody',
            null,
            probeRows(classification).map((row) =>
              el(
                'tr',
                { class: `probe-action probe-action--${row.result.replace(' ', '-')}` },
                el('th', { scope: 'row' }, el('span', { class: 'mono' }, `(${row.id})`), ` ${row.label}`),
                el('td', null, row.target),
                el('td', null, el('span', { class: `badge ${row.badgeClass}` }, row.badgeText)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function renderEvents(r: RunView): void {
    clear(eventsHost);
    const lines = eventLines(events.values(), r.id);
    eventsHost.append(el('h2', null, 'Containment events'));
    if (lines.length === 0) {
      eventsHost.append(
        el('p', { class: 'muted' }, r.status === 'running' ? 'No containment events yet.' : 'No containment events were recorded.'),
      );
      return;
    }
    eventsHost.append(
      el(
        'ol',
        { class: 'timeline', 'aria-label': 'Containment events, oldest first' },
        lines.map((line) =>
          el(
            'li',
            { class: line.warn ? 'timeline__item timeline__item--warn' : 'timeline__item' },
            el('span', { class: 'timeline__time' }, fmtUtc(line.ts)),
            line.warn ? el('span', { 'aria-hidden': 'true' }, '\u26A0 ') : null,
            line.warn ? el('span', { class: 'visually-hidden' }, 'Warning: ') : null,
            line.text,
          ),
        ),
      ),
    );
  }

  function render(): void {
    if (!run) return;
    const key = `${run.status}|${run.endedAt ?? ''}|${events.size}|${pollFailed ? 1 : 0}`;
    if (key === renderedKey) return;
    renderedKey = key;
    renderInfo(run);
    renderProgress(run);
    renderResult(run);
    renderEvents(run);
    clear(noteHost);
    if (pollFailed && run.status === 'running') {
      noteHost.append(el('p', null, 'Could not refresh the probe. Trying again.'));
    }
  }

  function verdictBadgeClass(v: ProbeVerdict): string {
    return v === 'passed' ? 'badge--ok' : v === 'failed' ? 'badge--bad' : 'badge--warn';
  }

  // ---- Data --------------------------------------------------------------
  function apply(snapshot: RunSnapshot): void {
    mergeEvents(events, snapshot.events);
    run = snapshot.run;
    pollFailed = false;
    render();
    if (isProbeEnded(snapshot.run.status)) finish(snapshot.run);
  }

  function finish(r: RunView): void {
    stopLive();
    if (announcedEnd) return;
    announcedEnd = true;
    const { classification, stored } = effectiveProbeResult(r.probeResult);
    const wording = resultWording(classification, stored);
    ctx.announce(`${wording.headline}. ${wording.details[0] ?? ''}`.trim());
  }

  function stopLive(): void {
    window.clearTimeout(pollTimer);
    pollTimer = undefined;
    source?.close();
    source = null;
    controller?.abort();
    controller = null;
  }

  function openSource(): void {
    if (source !== null || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
    source = es;
    es.addEventListener('containment', (ev) => {
      const parsed = parseEventData((ev as MessageEvent).data);
      if (parsed && mergeEvents(events, [parsed]) > 0) render();
    });
    // A status or report event means the probe may have ended: look now.
    const soon = (): void => schedulePoll(0);
    es.addEventListener('status', soon);
    es.addEventListener('report', soon);
    // On error EventSource reconnects by itself and replays from Last-Event-ID; polling covers the gap.
  }

  function schedulePoll(delay: number): void {
    if (disposed) return;
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => void poll(), delay);
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const res = await getRun(id, mine.signal);
    if (disposed || controller !== mine) return;
    controller = null;
    if (res.ok) {
      apply(res.data);
      if (!isProbeEnded(res.data.run.status)) schedulePoll(POLL_MS);
    } else {
      if (res.error.code === 'not_found') {
        showFatal(res.error);
        return;
      }
      pollFailed = true;
      render();
      schedulePoll(POLL_MS);
    }
  }

  function showFatal(err: ApiError): void {
    stopLive();
    clear(infoHost);
    clear(progressHost);
    clear(resultHost);
    clear(actionsHost);
    clear(eventsHost);
    clear(noteHost);
    noteHost.append(renderApiError(err));
    ctx.announce(err.message);
  }

  async function load(): Promise<void> {
    clear(noteHost);
    progressHost.append(el('p', { class: 'muted', role: 'status' }, 'Loading the probe.'));
    const res = await getRun(id);
    if (disposed) return;
    clear(progressHost);
    if (!res.ok) {
      showFatal(res.error);
      if (res.error.code !== 'not_found') {
        resultHost.append(
          el('button', { type: 'button', class: 'btn', onclick: () => void load() }, 'Try again'),
        );
      }
      return;
    }
    clear(resultHost);
    if (res.data.run.kind !== 'probe') {
      ctx.navigate(`/run/${encodeURIComponent(id)}`);
      return;
    }
    apply(res.data);
    if (!isProbeEnded(res.data.run.status)) {
      openSource();
      schedulePoll(POLL_MS);
    }
  }

  void load();

  return () => {
    disposed = true;
    stopLive();
  };
}
