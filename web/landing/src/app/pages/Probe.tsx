/**
 * Containment probe (`#/probe/<id>`): a script inside the sandbox tries five escapes; each should
 * be blocked. Polls the snapshot every second and listens to the event stream until it ends.
 * Wording and verdict rules come from web/probe-view.ts unchanged.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, RotateCcwIcon } from 'lucide-react';
import type { EventView, RunSnapshot, RunView } from '../../../../../src/api-types.ts';
import type { ProbeActionResult, ProbeVerdict } from '../../../../../src/k6/probe-result.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CornerTicks, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { ApiErrorText, Busy, StatusBadge, TableWrap } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { type ApiError, getRun } from '../lib/api.ts';
import { fmtUtc } from '../lib/format.ts';
import {
  ACTION_EXPLANATIONS,
  effectiveProbeResult,
  eventLines,
  isProbeEnded,
  mergeEvents,
  PROBE_ACTIONS,
  parseEventData,
  probeRows,
  resultWording,
  statusText,
} from '../lib/probe-view.ts';
import { rememberRun } from '../lib/recent-runs.ts';

const POLL_MS = 1000;

type State =
  | { kind: 'loading' }
  | { kind: 'fatal'; error: ApiError }
  | { kind: 'ready'; run: RunView; events: Map<number, EventView>; pollFailed: boolean };

export function ProbePage({ id }: { id: string }) {
  const { navigate, announce } = useApp();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let dead = false;
    const events = new Map<number, EventView>();
    let run: RunView | null = null;
    let pollTimer: number | undefined;
    let source: EventSource | null = null;
    let controller: AbortController | null = null;
    let announced = false;

    const show = (pollFailed = false) => run && setState({ kind: 'ready', run, events: new Map(events), pollFailed });

    const stopLive = () => {
      window.clearTimeout(pollTimer);
      source?.close();
      source = null;
      controller?.abort();
      controller = null;
    };

    const finish = (r: RunView) => {
      stopLive();
      if (announced) return;
      announced = true;
      const { classification, stored } = effectiveProbeResult(r.probeResult);
      const w = resultWording(classification, stored);
      announce(`${w.headline}. ${w.details[0] ?? ''}`.trim());
    };

    const apply = (snap: RunSnapshot) => {
      mergeEvents(events, snap.events);
      run = snap.run;
      show();
      if (isProbeEnded(snap.run.status)) finish(snap.run);
    };

    const schedule = (delay: number) => {
      if (dead) return;
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (dead) return;
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      const res = await getRun(id, mine.signal);
      if (dead || controller !== mine) return;
      controller = null;
      if (res.ok) {
        apply(res.data);
        if (!isProbeEnded(res.data.run.status)) schedule(POLL_MS);
      } else if (res.error.code === 'not_found') {
        stopLive();
        setState({ kind: 'fatal', error: res.error });
        announce(res.error.message);
      } else {
        show(true);
        schedule(POLL_MS);
      }
    };

    const openSource = () => {
      if (source !== null || typeof EventSource === 'undefined') return;
      const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
      source = es;
      es.addEventListener('containment', (ev) => {
        const parsed = parseEventData((ev as MessageEvent).data);
        if (parsed && mergeEvents(events, [parsed]) > 0) show();
      });
      const soon = () => schedule(0);
      es.addEventListener('status', soon);
      es.addEventListener('report', soon);
    };

    void (async () => {
      setState({ kind: 'loading' });
      const res = await getRun(id);
      if (dead) return;
      if (!res.ok) {
        setState({ kind: 'fatal', error: res.error });
        announce(res.error.message);
        return;
      }
      if (res.data.run.kind !== 'probe') {
        navigate(`/run/${encodeURIComponent(id)}`);
        return;
      }
      rememberRun({ id, kind: 'probe', name: 'Containment probe', startedAt: res.data.run.startedAt });
      apply(res.data);
      if (!isProbeEnded(res.data.run.status)) {
        openSource();
        schedule(POLL_MS);
      }
    })();

    return () => {
      dead = true;
      stopLive();
    };
  }, [id, attempt, announce, navigate]);

  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground focus-visible:outline-none max-[860px]:text-[1.75rem]"
        >
          Containment Probe
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          The probe runs inside the sandbox and tries to escape it. Each attempt should be blocked.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {state.kind === 'loading' ? (
            <TelemetryPanel ticks="bar" role="status" aria-busy="true" aria-label="Loading probe…" className="gap-4 bg-card">
              <p className="m-0 text-sm text-muted-foreground">Loading containment probe…</p>
              <div className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none">
                <div className="h-4 w-44 rounded-sm bg-surface-2" />
                <div className="h-32 w-full rounded-md bg-surface-2" />
              </div>
            </TelemetryPanel>
          ) : state.kind === 'fatal' ? (
            <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-4 bg-card">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">Probe unavailable</Badge>
              </div>
              <ApiErrorText error={state.error} />
              {state.error.code !== 'not_found' ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button type="button" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
                    <RotateCcwIcon data-icon="inline-start" />
                    Try again
                  </Button>
                </div>
              ) : null}
            </TelemetryPanel>
          ) : (
            <ProbeBody run={state.run} events={state.events} pollFailed={state.pollFailed} />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20" aria-label="About this probe">
          {state.kind === 'ready' ? (
            <TelemetryPanel ticks="bar" aria-labelledby="probe-info-heading" className="bg-card">
              <h2 id="probe-info-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                This probe
              </h2>
              <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Probe</dt>
                <dd className="m-0 min-w-0 font-mono text-xs break-all text-foreground" translate="no">{state.run.id}</dd>

                <dt className="text-muted-foreground">Status</dt>
                <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-foreground">
                  <StatusBadge status={state.run.status} />
                  <span>{statusText(state.run)}</span>
                </dd>

                <dt className="text-muted-foreground">Sandbox runtime</dt>
                <dd className="m-0 min-w-0 font-mono text-xs text-foreground" translate="no">{state.run.runtime}</dd>

                <dt className="text-muted-foreground">Started</dt>
                <dd className="m-0 min-w-0">
                  <time
                    className="font-mono text-xs text-foreground tabular-nums"
                    dateTime={new Date(state.run.startedAt).toISOString()}
                  >
                    {fmtUtc(state.run.startedAt)}
                  </time>
                </dd>

                {state.run.endedAt !== null ? (
                  <>
                    <dt className="text-muted-foreground">Ended</dt>
                    <dd className="m-0 min-w-0">
                      <time
                        className="font-mono text-xs text-foreground tabular-nums"
                        dateTime={new Date(state.run.endedAt).toISOString()}
                      >
                        {fmtUtc(state.run.endedAt)}
                      </time>
                    </dd>
                  </>
                ) : null}
              </dl>
            </TelemetryPanel>
          ) : null}

          <details className="group rounded-md border border-border bg-card p-5 sm:px-6" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-0.5 text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <h2 className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">What each action does</h2>
              <ChevronDownIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <dl className="m-0 mt-4 flex flex-col gap-3.5 text-sm">
              {PROBE_ACTIONS.map((a) => (
                <div key={a.id} className="flex flex-col gap-1">
                  <dt className="font-medium text-foreground">
                    <span className="font-mono text-xs text-muted-foreground">({a.id})</span> {a.label}
                  </dt>
                  <dd className="m-0 max-w-[72ch] text-muted-foreground">{ACTION_EXPLANATIONS[a.id]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>
      </div>
    </div>
  );
}

function resultBadgeVariant(result: ProbeActionResult): 'ok' | 'destructive' | 'warn' {
  if (result === 'contained') return 'ok';
  if (result === 'escaped') return 'destructive';
  return 'warn';
}

const VERDICT_PANEL_CLASS: Record<ProbeVerdict, string> = {
  passed: 'border-transparent bg-primary text-primary-foreground',
  failed: 'border-destructive bg-card text-foreground',
  incomplete: 'border-warn bg-card text-foreground',
};

const VERDICT_TICK_TONE: Record<ProbeVerdict, 'ink' | 'bad' | 'bar'> = {
  passed: 'ink',
  failed: 'bad',
  incomplete: 'bar',
};

export function ProbeBody({
  run,
  events,
  pollFailed,
}: {
  run: RunView;
  events: Map<number, EventView>;
  pollFailed: boolean;
}) {
  const ended = isProbeEnded(run.status);
  const lines = eventLines(events.values(), run.id);
  const result = ended ? effectiveProbeResult(run.probeResult) : null;
  const wording = result ? resultWording(result.classification, result.stored) : null;
  const contained = result ? PROBE_ACTIONS.filter((a) => result.classification.actions[a.id] === 'contained').length : 0;

  return (
    <>
      {pollFailed && run.status === 'running' ? (
        <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-2 bg-card">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warn">Connection issue</Badge>
          </div>
          <p className="m-0 text-sm text-foreground">Could not refresh the probe. Trying again.</p>
        </TelemetryPanel>
      ) : null}

      {!ended ? (
        <TelemetryPanel ticks="accent" className="bg-card">
          <Busy>The probe is running. Results appear when it ends, usually within a minute.</Busy>
        </TelemetryPanel>
      ) : null}

      {result && wording ? (
        <>
          <section
            aria-labelledby="probe-result-heading"
            className={cn(
              'relative grid grid-cols-1 items-center gap-4 rounded-md border p-6 min-[861px]:grid-cols-[auto_minmax(0,1fr)] min-[861px]:gap-7',
              VERDICT_PANEL_CLASS[wording.verdict],
            )}
          >
            <CornerTicks tone={VERDICT_TICK_TONE[wording.verdict]} />
            <h2 id="probe-result-heading" className="sr-only">
              Result
            </h2>

            <p className="m-0 flex flex-col gap-1">
              <span className="font-mono text-[3.5rem] leading-none font-normal tracking-[-0.04em] tabular-nums min-[861px]:text-[4rem]">
                {contained}/{PROBE_ACTIONS.length}
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  wording.verdict === 'passed' ? 'text-accent-ink-soft' : 'text-muted-foreground',
                )}
              >
                actions contained
              </span>
            </p>

            <div className="flex max-w-[64ch] flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    wording.verdict === 'passed'
                      ? 'outline'
                      : wording.verdict === 'failed'
                        ? 'destructive'
                        : 'warn'
                  }
                  className={cn(wording.verdict === 'passed' && 'border-primary-foreground text-primary-foreground')}
                >
                  {wording.badge}
                </Badge>
                <p className="m-0 font-semibold">{wording.headline}</p>
              </div>
              {wording.details.map((line) => (
                <p
                  key={line}
                  className={cn(
                    'm-0 text-sm',
                    wording.verdict === 'passed' ? 'text-accent-ink-soft' : 'text-muted-foreground',
                  )}
                >
                  {line}
                </p>
              ))}
            </div>
          </section>

          <TelemetryPanel ticks="bar" aria-labelledby="probe-actions-heading" className="bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="probe-actions-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                Probe actions
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {PROBE_ACTIONS.length} actions
              </span>
            </div>

            <TableWrap label="Probe actions">
              <table className="data-table w-full min-w-[600px]">
                <caption className="sr-only">The five probe actions, in the order they run</caption>
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">What it tried</th>
                    <th scope="col" className="end">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {probeRows(result.classification).map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className="font-medium text-foreground">
                        <span className="font-mono text-xs text-muted-foreground">({row.id})</span> {row.label}
                      </th>
                      <td className="text-muted-foreground">{row.target}</td>
                      <td className="end">
                        <Badge variant={resultBadgeVariant(row.result)}>{row.badgeText}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </TelemetryPanel>
        </>
      ) : null}

      <TelemetryPanel ticks="bar" aria-labelledby="probe-events-heading" className="bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="probe-events-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Containment events
          </h2>
          <span className="font-mono text-xs text-muted-foreground">Oldest first, UTC</span>
        </div>

        {lines.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {run.status === 'running' ? 'No containment events yet.' : 'No containment events were recorded.'}
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-border p-0" aria-label="Containment events, oldest first">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 last:pb-0">
                <time
                  className="font-mono text-xs text-muted-foreground tabular-nums"
                  dateTime={new Date(l.ts).toISOString()}
                >
                  {fmtUtc(l.ts)}
                </time>
                <p className="m-0 flex flex-wrap items-center gap-2 text-foreground">
                  {l.warn ? (
                    <>
                      {/* In a probe a blocked attempt or a cap that held is the expected result, so it reads as contained. */}
                      <Badge variant="ok">contained</Badge>
                    </>
                  ) : null}
                  <span>{l.text}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </TelemetryPanel>
    </>
  );
}
