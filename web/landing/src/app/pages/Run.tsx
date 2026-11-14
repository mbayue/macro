import { useEffect, useRef } from 'react';
/**
 * Run (`#/run/<id>`): the live board. While the test runs, the spring-green tile is the stage in progress
 * and the other tiles name the stage their numbers came from (metrics exist per finished stage).
 * When the run ends the same tiles become the report's headline, and the report follows below.
 */
import type { StageView } from '../../../../../src/api-types.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../../../../../src/run/format.ts';
import { currentStage, elapsedMs, formatElapsed, isTerminal, type RunModel } from '../lib/run-view.ts';
import { headlineItems, reportNotices } from '../lib/report-view.ts';
import type { CapacityReport, StageView as ReportStageView } from '../../../../../src/report/build.ts';
import { Feed } from '../components/run/Feed.tsx';
import { AiSection, ReportExport, ReportMeta, ReportNotices, ReportStages, RunsPanel } from '../components/run/Report.tsx';
import { RouteChart } from '../components/run/RouteChart.tsx';
import { SecondChart } from '../components/run/SecondChart.tsx';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { type ProfileStage, StageProfile } from '../components/StageProfile.tsx';
import { AlertRegion, ApiErrorText, Badge, DASH, KeyValues, PageSkeleton, Panel, StatusBadge, TableWrap } from '../components/ui.tsx';
import { useRun } from '../hooks/useRun.ts';

export function RunPage({ id }: { id: string }) {
  const { state, stop, stopPending, stopError, retry } = useRun(id);

  if (state.kind === 'loading') {
    return <PageSkeleton title="Loading run…" />;
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
  const queued = model.run.status === 'queued';
  const running = model.run.status === 'running';
  const ended = isTerminal(model.run.status);
  const queuePos = model.run.queuePosition ?? null;
  const report = ended ? model.report : null;
  const limit = model.plan?.stopThresholds ?? report?.thresholds ?? null;
  const reason = model.run.statusReason === null ? null : plainReason(model.run.statusReason);

  return (
    <div className="page">
      <header className="run-head">
        <div className="run-head__text">
          <h1 className="page__title">{model.plan?.name ?? report?.planName ?? 'Load test'}</h1>
          <p className="muted run-head__meta">
            <span className="run-head__status">
              <StatusBadge status={model.run.status} />
              {running && stale ? <Badge tone="warn">Progress may be out of date</Badge> : null}
            </span>
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
        {queued || running ? (
          <div className="run-head__actions">
            <button type="button" className="btn btn--danger" disabled={stopPending} onClick={stop}>
              {stopPending ? 'Stopping\u2026' : queued ? 'Cancel queued run' : 'Stop run'}
            </button>
            <p className="muted">
              {queued
                ? queuePos !== null
                  ? `Queued (#${queuePos} in line): starts automatically when the active run finishes.`
                  : 'Queued: starts automatically when the active run finishes.'
                : 'Ends the current stage and keeps the results so far.'}
            </p>
            <AlertRegion error={stopError} />
          </div>
        ) : report ? (
          <div className="run-head__actions">
            <button type="button" className="btn btn--quiet" onClick={goToRunsPanel}>
              Run again and compare
            </button>
          </div>
        ) : null}
      </header>

      {ended && reason && !report ? (
        (model.run.status === 'failed' || model.run.status === 'interrupted') && model.report === null ? (
          <div className="alert" role="alert">
            <p className="alert__message">Run {model.run.status.replace(/_/g, ' ')}</p>
            <p>{reason}</p>
          </div>
        ) : (
          <p className="muted">{reason}</p>
        )
      ) : null}

      {report ? <p className="verdict">{verdictLine(report, model.routes)}</p> : null}
      {queued ? (
        <Panel title="Waiting in queue">
          <p className="muted">
            {queuePos !== null
              ? `Position #${queuePos} in line. This run will start automatically as soon as the active run finishes.`
              : 'This run is queued and will start automatically as soon as the active run finishes.'}
          </p>
        </Panel>
      ) : (
        <>
          {report ? <ReportTiles model={model} now={now} /> : <LiveTiles model={model} now={now} />}
          {report && (reason || reportNotices(report).length > 0) ? (
            <div className="report-notes">
              {reason ? <p>{reason}</p> : null}
              <ReportNotices report={report} />
            </div>
          ) : null}

          <div className="board">
            <section className="panel board__chart" aria-labelledby="route-chart-heading">
              <div className="panel__head">
                <h2 id="route-chart-heading">p95 latency per route</h2>
                <span className="muted">After each finished stage</span>
              </div>
              <TableWrap label="Chart of p95 latency per route">
                <RouteChart stages={model.stages} plan={model.plan} limitMs={limit?.p95Ms ?? 1500} routes={model.routes} />
              </TableWrap>
            </section>
            <Feed stages={model.stages} decisions={model.decisions} containment={model.containment} total={model.plan?.stages.length ?? null} />
          </div>
        </>
      )}

      {report ? null : <StageProfile stages={profile(model, now)} compact />}

      {report ? (
        <article className="report" aria-labelledby="report-heading">
          <div className="report__head">
            <h2 id="report-heading">Capacity report</h2>
            <ReportMeta report={report} />
          </div>
          <ReportExport report={report} />
          <ReportStages report={report} />
          <DuringTheStage stages={model.stages} routes={model.routes} />
          <AiSection report={report} />
          <ModelCalls calls={model.modelCalls} />
          <RunsPanel report={report} />
        </article>
      ) : (
        <>
          <LiveStages model={model} />
          {ended &&
          model.report === null &&
          (model.run.status === 'completed' ||
            model.run.status === 'halted' ||
            model.run.status === 'stopped' ||
            model.run.status === 'timed_out') ? (
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

/**
 * Status reasons are written by the server with requirement terms (Supervisor_Agent, Stage_Verdict,
 * Stop_Thresholds). Say them in plain words on screen.
 */
export function plainReason(text: string): string {
  return text
    .replace(/the Supervisor_Agent's decision/g, 'the supervisor (AI) decision')
    .replace(/Supervisor_Agent/g, 'supervisor (AI)')
    .replace(/Stop_Thresholds?/g, 'stop thresholds')
    .replace(/Stage_Verdicts?/g, 'stage verdict')
    .replace(/\b([A-Z][a-z]+)_([A-Z][a-z]+)\b/g, (_m, a: string, b: string) => `${a.toLowerCase()} ${b.toLowerCase()}`)
    .replace(/\bStage (\d)/g, 'stage $1');
}

/** Bring the "Run again and compare" panel into view and put focus on its heading. */
function goToRunsPanel() {
  const el = document.getElementById('report-runs-heading');
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

const fmtN = (n: number): string => n.toLocaleString('en-US');

/** Which overall limit a failing stage went over, in words, from the stored numbers. */
function overWhat(s: ReportStageView, th: CapacityReport['thresholds']): string {
  const m = s.overall;
  if (m === null) return 'a stop threshold';
  const p95 = m.raw.p95 > th.p95Ms;
  const err = m.raw.errorRatePct > th.errorRatePct;
  if (p95 && err) return `p95 latency (${m.display.p95} ms) and error rate (${m.display.errorRatePct}) went over their limits`;
  if (p95) return `p95 latency went over the ${fmtN(th.p95Ms)} ms limit (${m.display.p95} ms)`;
  if (err) return `error rate went over the ${th.errorRatePct}% limit (${m.display.errorRatePct})`;
  return 'a stop threshold was crossed';
}

/**
 * The report's answer in one sentence, built only from the headline values and stage rows
 * (never from AI text): how much load held, where it broke, and the first route to go over.
 */
export function verdictLine(report: CapacityReport, routes: readonly { id: string; path: string }[] = []): string {
  const { safeCapacity: safe, breakingPoint: brk, firstDegradedRoute: route } = report.headline;
  const th = report.thresholds;
  const measured = report.stages.filter((s) => s.overall !== null);
  if (measured.length === 0) return 'No stage produced metrics, so this run has no capacity answer.';
  const top = Math.max(...measured.map((s) => s.vus));
  const brkStage = brk === null ? undefined : measured.find((s) => s.vus === brk && s.verdict === 'fail');

  let line: string;
  if (safe !== null && brk === null) {
    line = `Holds ${fmtN(top)} VUs, the most this run tested: every stage stayed under both limits overall.`;
  } else if (safe !== null && brk !== null) {
    line = `Holds ${fmtN(safe)} VUs. At ${fmtN(brk)} VUs, ${brkStage ? overWhat(brkStage, th) : 'a stop threshold was crossed'}.`;
  } else if (brk !== null) {
    line = `No stage held: at ${fmtN(brk)} VUs, the first stage measured, ${brkStage ? overWhat(brkStage, th) : 'a stop threshold was crossed'}.`;
  } else {
    line = `Tested up to ${fmtN(top)} VUs.`;
  }

  if (route) {
    const hit = measured.map((s) => ({ s, r: s.routes.find((r) => r.route === route && r.exceedsThresholds) })).find((x) => x.r);
    if (hit?.r) {
      const what = hit.r.raw.p95 > th.p95Ms ? `the ${fmtN(th.p95Ms)} ms p95 limit` : `the ${th.errorRatePct}% error limit`;
      const path = routes.find((r) => r.id === route)?.path;
      const label = path === undefined ? route : `${route} (${path})`;
      line += ` ${label} was the first route over ${what}, at ${fmtN(hit.s.vus)} VUs.`;
    }
  }
  return line;
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
        <span className="tile__label">
          {cur ? (cur.total !== null ? `Stage ${cur.position} of ${cur.total}` : `Stage ${cur.position}`) : 'Starting'}
        </span>
        <span className="tile__value">{cur ? cur.vus : DASH}</span>
        <span className="tile__sub">
          {cur ? 'VUs' : 'preparing the first sandbox'}
          {stageSec !== null && top ? `, ${Math.min(stageSec, top.durationSec)}\u00a0s of ${top.durationSec}\u00a0s` : ''}
        </span>
        {stageSec !== null && top ? <TileProgress value={Math.min(1, stageSec / Math.max(1, top.durationSec))} /> : null}
      </div>
      <div className="tile">
        <span className="tile__label">{done ? `p95 at stage ${done.index + 1}` : 'p95 latency'}</span>
        <span className="tile__value">{m ? `${fmtMs(m.p95)} ms` : DASH}</span>
        <span className="tile__sub">
          {limit ? `limit ${fmtMs(limit.p95Ms)} ms` : ''}
          {m ? '' : limit ? ', after stage 1 ends' : 'after stage 1 ends'}
        </span>
      </div>
      <div className="tile">
        <span className="tile__label">{done ? `Error rate at stage ${done.index + 1}` : 'Error rate'}</span>
        <span className="tile__value">{m ? fmtPct(m.errorRatePct) : DASH}</span>
        <span className="tile__sub">{limit ? `limit ${limit.errorRatePct}%` : ''}</span>
      </div>
      <div className="tile">
        <span className="tile__label">Safe capacity so far</span>
        <span className="tile__value">{safe ?? DASH}</span>
        <span className="tile__sub">{safe !== null ? 'VUs, highest stage that passed' : 'no stage has passed yet'}</span>
      </div>
    </div>
  );
}

/** The same four places as the live tiles, now holding the report's answers. */
function ReportTiles({ model, now }: { model: RunModel; now: number }) {
  const report = model.report!;
  const items = headlineItems(report);
  const [safe, breaking, route] = items;
  const th = report.thresholds;
  const ran = report.stages;
  const planned = Math.max(model.plan?.stages.length ?? 0, ran.length);
  // Where the first degraded route went over: its stage and p95, from the same stored rows.
  const firstRoute = report.headline.firstDegradedRoute;
  const where = firstRoute
    ? report.stages.map((s) => ({ s, r: s.routes.find((r) => r.route === firstRoute && r.exceedsThresholds) })).find((x) => x.r)
    : undefined;
  const safeSub =
    report.headline.safeCapacity !== null
      ? `VUs, the highest stage whose overall p95 stayed under ${th.p95Ms} ms and errors under ${th.errorRatePct}%`
      : 'no stage stayed under both limits';
  const breakSub =
    report.headline.breakingPoint !== null
      ? 'VUs, the first stage over a limit overall'
      : 'every stage stayed under both thresholds overall';
  const routeSub = where?.r
    ? `p95 ${where.r.display.p95} ms at stage ${where.s.displayIndex} (${where.s.vus} VUs), over the ${th.p95Ms} ms limit`
    : 'no single route went over a limit';
  const tile = (it: (typeof items)[number] | undefined, lead: boolean, sub: string) =>
    it ? (
      <div className={lead ? 'tile tile--live' : `tile tile--${it.tone ?? 'neutral'}`}>
        <span className="tile__label">{it.label}</span>
        <span className={it.value.length > 9 ? 'tile__value tile__value--text' : 'tile__value'}>{it.value}</span>
        <span className="tile__sub">{sub}</span>
      </div>
    ) : null;
  return (
    <div className="tiles tiles--report" role="group" aria-label="Headline values">
      {tile(safe, true, safeSub)}
      {tile(breaking, false, breakSub)}
      {tile(route, false, routeSub)}
      <div className="tile">
        <span className="tile__label">Tested up to</span>
        <span className="tile__value">{ran.length > 0 ? fmtN(Math.max(...ran.map((s) => s.vus))) : DASH}</span>
        <span className="tile__sub">
          VUs, {ran.length} of {planned} {planned === 1 ? 'stage' : 'stages'} run, {formatElapsed(elapsedMs(model.run, now))} in total
        </span>
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

/** Progress through the running stage, drawn along the bottom of the spring-green tile. */
function TileProgress({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.style.setProperty('--p', String(value));
  }, [value]);
  return (
    <span className="tile__progress" aria-hidden="true">
      <span ref={ref} />
    </span>
  );
}

/**
 * "During the stage": one per-second chart per stage that carries samples, drawn
 * from the stored rows. Stages without samples (older runs) render nothing.
 */
function DuringTheStage({
  stages,
  routes,
}: {
  stages: readonly StageView[];
  routes: readonly { id: string; path: string }[];
}) {
  const withSamples = stages.filter((s) => (s.samples?.length ?? 0) > 0);
  if (withSamples.length === 0) return null;
  return (
    <Panel title="During the stage" id="during-stage-heading" note="Average latency per second, measured while each stage ran.">
      {withSamples.map((s) => (
        <div key={s.index} className="during-stage">
          <h3 className="h-small">
            Stage {s.index + 1} ({s.vus} VUs)
          </h3>
          <TableWrap label={`Chart of average latency per second for stage ${s.index + 1}`}>
            <SecondChart stage={s} displayIndex={s.index + 1} routes={routes} />
          </TableWrap>
        </div>
      ))}
    </Panel>
  );
}

/** Live stage table, including planned stages not started yet ("pending", or "not run" after an early end). */
function LiveStages({ model }: { model: RunModel }) {
  const started = new Set(model.stages.map((s) => s.index));
  const unstarted = (model.plan?.stages ?? []).map((p, index) => ({ index, ...p })).filter((p) => !started.has(p.index));
  const pending = model.run.status === 'running' || model.run.status === 'queued' ? 'pending' : 'not run';
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
          <table className="table table--stages">
            <caption className="visually-hidden">Stages</caption>
            <colgroup>
              <col className="w-stage" />
              <col className="w-vus" />
              <col className="w-dur" />
              {Array.from({ length: 7 }, (_, i) => (
                <col key={i} />
              ))}
              <col className="w-verdict" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col" className="num">
                  VUs
                </th>
                <th scope="col" className="num">
                  Duration
                </th>
                {['Requests', 'Requests/s', 'Error rate', 'HTTP 429', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)'].map((h) => (
                  <th key={h} scope="col" className="num">
                    {h}
                  </th>
                ))}
                <th scope="col" className="end">
                  Verdict
                </th>
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
                        <td colSpan={7}>{s.errorReason ?? 'No reason was recorded.'}</td>
                        <td className="end">
                          <Badge tone="bad">error</Badge>
                        </td>
                      </>
                    ) : (
                      <>
                        {m
                          ? [
                              fmtCount(m.requests),
                              fmtRps(m.rps),
                              fmtPct(m.errorRatePct),
                              fmtCount(m.http429),
                              fmtMs(m.p50),
                              fmtMs(m.p95),
                              fmtMs(m.p99),
                            ].map((v, i) => (
                              <td key={i} className="num">
                                {v}
                              </td>
                            ))
                          : dash}
                        <td className="end">
                          {s.status === 'running' ? (
                            <Badge tone="live">running</Badge>
                          ) : s.verdict ? (
                            <Badge tone={s.verdict === 'pass' ? 'ok' : 'bad'}>{s.verdict}</Badge>
                          ) : (
                            DASH
                          )}
                        </td>
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
                  {dash}
                  <td className="end">
                    <Badge>{pending}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <KeyValues
        items={[
          model.plan
            ? [
                'Stop thresholds',
                <span className="num">
                  p95 {fmtMs(model.plan.stopThresholds.p95Ms)} ms, error rate {model.plan.stopThresholds.errorRatePct}%
                </span>,
              ]
            : null,
        ]}
      />
    </section>
  );
}
