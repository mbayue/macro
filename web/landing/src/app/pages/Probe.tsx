/**
 * Containment probe (`#/probe/<id>`): a script inside the sandbox tries five escapes; each should
 * be blocked. Polls the snapshot every second and listens to the event stream until it ends.
 * Wording and verdict rules come from web/probe-view.ts unchanged.
 */
import { useEffect, useRef, useState } from 'react';
import type { EventView, RunSnapshot, RunView } from '../../../../../src/api-types.ts';
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
import { ApiErrorText, Badge, Busy, KeyValues, StatusBadge, TableWrap, type Tone } from '../components/ui.tsx';
import { useApp } from '../context.tsx';

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
    <div className="page">
      <header className="page__head">
        <h1 className="page__title" ref={heading} tabIndex={-1}>
          Containment probe
        </h1>
        <p className="page__lead">The probe runs inside the sandbox and tries to escape it. Each attempt should be blocked.</p>
      </header>
      <div className="split">
        <div className="split__main">
          {state.kind === 'loading' ? (
            <div className="panel skeleton-pulse" role="status" aria-busy="true" aria-label="Loading probe…">
              <div className="skeleton-line skeleton-line--heading" />
              <div className="skeleton-block skeleton-block--area" />
            </div>
          ) : state.kind === 'fatal' ? (
            <>
              <div className="alert" role="alert">
                <ApiErrorText error={state.error} />
              </div>
              {state.error.code !== 'not_found' ? (
                <div className="row">
                  <button type="button" className="btn btn--quiet" onClick={() => setAttempt((a) => a + 1)}>
                    Try again
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <ProbeBody run={state.run} events={state.events} pollFailed={state.pollFailed} />
          )}
        </div>
        <aside className="split__side" aria-label="About this probe">
          {state.kind === 'ready' ? (
            <section className="panel" aria-labelledby="probe-info-heading">
              <h2 id="probe-info-heading">This probe</h2>
              <KeyValues
                items={[
                  ['Probe', <span className="code">{state.run.id}</span>],
                  [
                    'Status',
                    <span className="kv__status">
                      <StatusBadge status={state.run.status} /> {statusText(state.run)}
                    </span>,
                  ],
                  ['Sandbox runtime', <span className="code">{state.run.runtime}</span>],
                  ['Started', <span className="num">{fmtUtc(state.run.startedAt)}</span>],
                  state.run.endedAt !== null ? ['Ended', <span className="num">{fmtUtc(state.run.endedAt)}</span>] : null,
                ]}
              />
            </section>
          ) : null}
          <details className="panel disclosure" open>
            <summary>
              <h2 className="disclosure__title">What each action does</h2>
            </summary>
            <dl className="explain">
              {PROBE_ACTIONS.map((a) => (
                <div key={a.id}>
                  <dt>
                    <span className="code">({a.id})</span> {a.label}
                  </dt>
                  <dd>{ACTION_EXPLANATIONS[a.id]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>
      </div>{' '}
    </div>
  );
}

const resultTone = (r: string): Tone => (r === 'contained' ? 'ok' : r === 'escaped' ? 'bad' : 'warn');

function ProbeBody({ run, events, pollFailed }: { run: RunView; events: Map<number, EventView>; pollFailed: boolean }) {
  const ended = isProbeEnded(run.status);
  const lines = eventLines(events.values(), run.id);
  const result = ended ? effectiveProbeResult(run.probeResult) : null;
  const wording = result ? resultWording(result.classification, result.stored) : null;
  const contained = result ? PROBE_ACTIONS.filter((a) => result.classification.actions[a.id] === 'contained').length : 0;

  return (
    <>
      {pollFailed && run.status === 'running' ? (
        <div className="alert" role="alert">
          <p>Could not refresh the probe. Trying again.</p>
        </div>
      ) : null}
      {!ended ? <Busy>The probe is running. Results appear when it ends, usually within a minute.</Busy> : null}

      {result && wording ? (
        <>
          <section className={`probe-result probe-result--${wording.verdict}`} aria-labelledby="probe-result-heading">
            <h2 id="probe-result-heading" className="visually-hidden">
              Result
            </h2>
            <p className="probe-result__score">
              <span className="probe-result__value">
                {contained}/{PROBE_ACTIONS.length}
              </span>
              <span>actions contained</span>
            </p>
            <div className="probe-result__text">
              <p>
                <b>{wording.headline}</b>
              </p>
              {wording.details.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>
          <TableWrap label="Probe actions">
            <table className="table">
              <caption className="visually-hidden">The five probe actions, in the order they run</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">What it tried</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {probeRows(result.classification).map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className="code">({row.id})</span> {row.label}
                    </th>
                    <td>{row.target}</td>
                    <td>
                      <Badge tone={resultTone(row.result)}>{row.badgeText}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      ) : null}

      <section className="panel" aria-labelledby="probe-events-heading">
        <div className="panel__head">
          <h2 id="probe-events-heading">Containment events</h2>
          <span className="muted">Oldest first, UTC</span>
        </div>
        {lines.length === 0 ? (
          <p className="muted">{run.status === 'running' ? 'No containment events yet.' : 'No containment events were recorded.'}</p>
        ) : (
          <ol className="feed__list" aria-label="Containment events, oldest first">
            {lines.map((l) => (
              <li key={l.id} className={l.warn ? 'feed__item is-warn' : 'feed__item'}>
                <span className="feed__time num">{fmtUtc(l.ts)}</span>
                <p>
                  {l.warn ? (
                    <>
                      {/* In a probe a blocked attempt or a cap that held is the expected result, so it reads as contained. */}
                      <Badge tone="ok">contained</Badge>{' '}
                    </>
                  ) : null}
                  {l.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
