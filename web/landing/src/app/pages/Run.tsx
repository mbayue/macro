/**
 * Run (`#/run/<id>`): the live board. While the test runs, the lime tile is the stage in progress
 * and the other tiles name the stage their numbers came from (metrics exist per finished stage).
 * When the run ends the same tiles become the report's headline, and the report follows below.
 */
import type { StageView } from '../../../../../src/api-types.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../../../../../src/run/format.ts';
import { currentStage, elapsedMs, formatElapsed, isTerminal, type RunModel } from '../../../../run-view.ts';
import { headlineItems } from '../../../../report-view.ts';
import { Feed } from '../components/run/Feed.tsx';
import { AiSection, ReportChart, ReportMeta, ReportNotices, ReportStages, RunsPanel } from '../components/run/Report.tsx';
import { RouteChart } from '../components/run/RouteChart.tsx';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { type ProfileStage, StageProfile } from '../components/StageProfile.tsx';
import { AlertRegion, ApiErrorText, Badge, DASH, KeyValues, StatusBadge, TableWrap } from '../components/ui.tsx';
import { useRun } from '../hooks/useRun.ts';

export function RunPage({ id }: { id: string }) {
  const { state, stop, stopPending, stopError, retry } = useRun(id);

  if (state.kind === 'loading') {
    return (
      <p className="muted" role="status">
        Loading the run
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <section className="page">
        <h1 className="page__title">Run</h1>
        <div className="alert" role="alert">
          <ApiErrorText error={state.error} />
        </div>
        <div className="row">
          <button type="button" className="btn btn--quiet" onClick={retry}>
            Try again
          </button>
          <a href="#/">Start a new test</a>
        </div>
      </section>
    );
  }

  const { model, now, stale } = state;
  const running = model.run.status === 'running';
  const ended = isTerminal(model.run.status);
  const report = ended ? model.report : null;
  const limit = model.plan?.stopThresholds ?? report?.thresholds ?? null;
  const reason = model.run.statusReason;

  return (
    <div className="page">
      <header className="run-head">
        <div className="run-head__text">
          <div className="run-head__status">
            <StatusBadge status={model.run.status} />
            {running && stale ? <Badge tone="warn">Progress may be out of date</Badge> : null}
          </div>
          <h1 className="page__title">{model.plan?.name ?? report?.planName ?? 'Load test'}</h1>
          <p className="muted run-head__meta">
            <span>
              Run <span className="code">{model.run.id}</span>
            </span>
            {model.plan ? (
              <span>
                on <span className="code">{model.plan.target}</span>
              </span>
            ) : null}
            <span>
              {running ? 'Elapsed' : 'Total time'} <span className="num">{formatElapsed(elapsedMs(model.run, now))}</span>
            </span>
            <span>
              Sandbox <span className="code">{model.run.runtime}</span>
            </span>
          </p>
        </div>
        {running ? (
          <div className="run-head__actions">
            <button type="button" className="btn btn--danger" disabled={stopPending} onClick={stop}>
              {stopPending ? 'Stopping\u2026' : 'Stop run'}
            </button>
            <p className="muted">Ends the current stage and keeps the results so far.</p>
            <AlertRegion error={stopError} />
          </div>
        ) : null}
      </header>

      {ended && reason ? (
        (model.run.status === 'failed' || model.run.status === 'interrupted') && model.report === null ? (
          <div className="alert" role="alert">
            <p className="alert__message">Run {model.run.status.replace(/_/g, ' ')}</p>
            <p>{reason}</p>
          </div>
        ) : (
          <p className="muted">{reason}</p>
        )
      ) : null}

      {report ? <ReportTiles model={model} /> : <LiveTiles model={model} now={now} />}
      {report ? <ReportNotices report={report} /> : null}

      <div className="board">
        <section className="panel board__chart" aria-labelledby="route-chart-heading">
          <div className="panel__head">
            <h2 id="route-chart-heading">p95 latency per route</h2>
            <span className="muted">After each finished stage</span>
          </div>
          <TableWrap label="Chart of p95 latency per route">
            <RouteChart stages={model.stages} plan={model.plan} limitMs={limit?.p95Ms ?? 1500} />
          </TableWrap>
        </section>
        <Feed stages={model.stages} decisions={model.decisions} containment={model.containment} total={model.plan?.stages.length ?? null} />
      </div>

      <StageProfile stages={profile(model, now)} compact />

      {report ? (
        <article className="report" aria-labelledby="report-heading">
          <div className="report__head">
            <h2 id="report-heading">Capacity report</h2>
            <ReportMeta report={report} />
          </div>
          <ReportChart report={report} />
          <ReportStages report={report} />
          <AiSection report={report} />
          <ModelCalls calls={model.modelCalls} />
          <RunsPanel report={report} />
        </article>
      ) : (
        <>
          <LiveStages model={model} />
          {ended && model.report === null && (model.run.status === 'completed' || model.run.status === 'halted' || model.run.status === 'stopped' || model.run.status === 'timed_out') ? (
            <p className="muted" role="status">
              Building the capacity report.
            </p>
          ) : null}
          {model.modelCalls.length > 0 ? <ModelCalls calls={model.modelCalls} /> : null}
        </>
      )}
    </div>
  );
}

function lastDone(stages: readonly StageView[]): StageView | null {
  let top: StageView | null = null;
  for (const s of stages) if (s.status === 'done' && s.metrics !== null && (top === null || s.index > top.index)) top = s;
  return top;
}

function safeSoFar(stages: readonly StageView[]): number | null {
  let best: number | null = null;
  for (const s of stages) if (s.status === 'done' && s.verdict === 'pass' && (best === null || s.vus > best)) best = s.vus;
  return best;
}

function LiveTiles({ model, now }: { model: RunModel; now: number }) {
  const cur = currentStage(model);
  const running = model.run.status === 'running';
  const top = model.stages.find((s) => s.index === (cur?.position ?? 0) - 1) ?? null;
  const stageSec = top?.startedAt != null && top.status === 'running' ? Math.max(0, Math.round((now - top.startedAt) / 1000)) : null;
  const done = lastDone(model.stages);
  const m = done?.metrics?.overall ?? null;
  const limit = model.plan?.stopThresholds ?? null;
  const safe = safeSoFar(model.stages);
  return (
    <div className="tiles" role="group" aria-label="Live numbers">
      <div className={running ? 'tile tile--live' : 'tile'}>
        <span className="tile__label">{cur ? (cur.total !== null ? `Stage ${cur.position} of ${cur.total}` : `Stage ${cur.position}`) : 'Starting'}</span>
        <span className="tile__value">{cur ? cur.vus : DASH}</span>
        <span className="tile__sub">
          {cur ? 'virtual users' : 'preparing the first sandbox'}
          {stageSec !== null && top ? `, ${Math.min(stageSec, top.durationSec)} s of ${top.durationSec} s` : ''}
        </span>
      </div>
      <div className="tile">
        <span className="tile__label">{done ? `p95 at stage ${done.index + 1}` : 'p95 latency'}</span>
        <span className="tile__value">{m ? `${fmtMs(m.p95)} ms` : DASH}</span>
        <span className="tile__sub">{limit ? `limit ${fmtMs(limit.p95Ms)} ms` : ''}{m ? '' : limit ? ', after stage 1 ends' : 'after stage 1 ends'}</span>
      </div>
      <div className="tile">
        <span className="tile__label">{done ? `Error rate at stage ${done.index + 1}` : 'Error rate'}</span>
        <span className="tile__value">{m ? fmtPct(m.errorRatePct) : DASH}</span>
        <span className="tile__sub">{limit ? `limit ${limit.errorRatePct}%` : ''}</span>
      </div>
      <div className="tile">
        <span className="tile__label">Safe capacity so far</span>
        <span className="tile__value">{safe ?? DASH}</span>
        <span className="tile__sub">{safe !== null ? 'users, highest stage that passed' : 'no stage has passed yet'}</span>
      </div>
    </div>
  );
}

/** The same four places as the live tiles, now holding the report's answers. */
function ReportTiles({ model }: { model: RunModel }) {
  const items = headlineItems(model.report!);
  const [safe, breaking, route] = items;
  const tile = (it: (typeof items)[number] | undefined, lead: boolean, sub: string) =>
    it ? (
      <div className={lead ? 'tile tile--live' : `tile tile--${it.tone ?? 'neutral'}`}>
        <span className="tile__label">{it.label}</span>
        <span className={it.value.length > 9 ? 'tile__value tile__value--text' : 'tile__value'}>{it.value}</span>
        <span className="tile__sub">{sub}</span>
      </div>
    ) : null;
  return (
    <div className="tiles" role="group" aria-label="Headline values">
      {tile(safe, true, 'highest stage that stayed under both limits')}
      {tile(breaking, false, 'first stage that broke a limit')}
      {tile(route, false, 'first route over a limit')}
      <div className="tile">
        <span className="tile__label">Run status</span>
        <span className="tile__value tile__value--text">{model.report!.headline.status.replace(/_/g, ' ')}</span>
        <span className="tile__sub">sandbox {model.report!.runtime}</span>
      </div>
    </div>
  );
}

function profile(model: RunModel, now: number): ProfileStage[] {
  const planned = model.plan?.stages ?? [];
  const count = Math.max(planned.length, ...model.stages.map((s) => s.index + 1), 0);
  const running = model.run.status === 'running';
  return Array.from({ length: count }, (_, i) => {
    const s = model.stages.find((x) => x.index === i);
    const p = planned[i];
    const vus = s?.vus ?? p?.vus ?? 0;
    const durationSec = s?.durationSec ?? p?.durationSec ?? 0;
    if (!s) return { vus, durationSec, state: running ? 'planned' : 'skipped' };
    if (s.status === 'running') {
      const prog = s.startedAt != null && durationSec > 0 ? Math.min(1, (now - s.startedAt) / (durationSec * 1000)) : 0;
      return { vus, durationSec, state: 'running', progress: prog };
    }
    if (s.status === 'error') return { vus, durationSec, state: 'error' };
    return { vus, durationSec, state: s.verdict === 'fail' ? 'fail' : 'pass' };
  });
}

/** Live stage table, including planned stages not started yet ("pending", or "not run" after an early end). */
function LiveStages({ model }: { model: RunModel }) {
  const started = new Set(model.stages.map((s) => s.index));
  const unstarted = (model.plan?.stages ?? []).map((p, index) => ({ index, ...p })).filter((p) => !started.has(p.index));
  const pending = model.run.status === 'running' ? 'pending' : 'not run';
  const dash = Array.from({ length: 7 }, (_, i) => (
    <td key={i} className="num">
      {DASH}
    </td>
  ));
  return (
    <section className="panel" aria-labelledby="live-stages-heading">
      <div className="panel__head">
        <h2 id="live-stages-heading">Stages</h2>
      </div>
      {model.stages.length === 0 && unstarted.length === 0 ? (
        <p className="muted">No Stage has started yet.</p>
      ) : (
        <TableWrap label="Stages">
          <table className="table">
            <caption className="visually-hidden">Stages</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col" className="num">
                  VUs
                </th>
                <th scope="col" className="num">
                  Duration
                </th>
                <th scope="col">Result</th>
                {['Requests', 'Requests/s', 'Error rate', 'HTTP 429', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)'].map((h) => (
                  <th key={h} scope="col" className="num">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.stages.map((s) => {
                const m = s.status === 'done' ? (s.metrics?.overall ?? null) : null;
                return (
                  <tr key={s.index}>
                    <th scope="row" className="idx">
                      {s.index + 1}
                    </th>
                    <td className="num">{s.vus}</td>
                    <td className="num">{s.durationSec} s</td>
                    {s.status === 'error' ? (
                      <>
                        <td>
                          <Badge tone="bad">error</Badge>
                        </td>
                        <td colSpan={7}>{s.errorReason ?? 'No reason was recorded.'}</td>
                      </>
                    ) : (
                      <>
                        <td>{s.status === 'running' ? <Badge tone="live">running</Badge> : s.verdict ? <Badge tone={s.verdict === 'pass' ? 'ok' : 'bad'}>{s.verdict}</Badge> : DASH}</td>
                        {m
                          ? [fmtCount(m.requests), fmtRps(m.rps), fmtPct(m.errorRatePct), fmtCount(m.http429), fmtMs(m.p50), fmtMs(m.p95), fmtMs(m.p99)].map((v, i) => (
                              <td key={i} className="num">
                                {v}
                              </td>
                            ))
                          : dash}
                      </>
                    )}
                  </tr>
                );
              })}
              {unstarted.map((p) => (
                <tr key={`p${p.index}`} className="is-pending">
                  <th scope="row" className="idx">
                    {p.index + 1}
                  </th>
                  <td className="num">{p.vus}</td>
                  <td className="num">{p.durationSec} s</td>
                  <td>
                    <Badge>{pending}</Badge>
                  </td>
                  {dash}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <KeyValues
        items={[
          model.plan ? ['Stop limits', <span className="num">p95 {fmtMs(model.plan.stopThresholds.p95Ms)} ms, errors {model.plan.stopThresholds.errorRatePct}%</span>] : null,
        ]}
      />
    </section>
  );
}
