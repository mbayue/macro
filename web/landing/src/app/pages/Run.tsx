/**
 * Run (`#/run/<id>`): tabbed live telemetry board and completed Capacity Report.
 * While running, Overview shows the full-size four-tile board (spring green marks the
 * active stage), Stages & Routes and Audit Log fill in live, and AI Insights & Report Q&A
 * unlocks when the report is ready. Scrolling past the full tiles or switching tabs reveals
 * the sticky one-line KPI strip above the tabs.
 */
import { lazy, memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { reducedMotion } from '@/lib/utils';
import type { StageView } from '../../../../../src/api-types.ts';
import { fmtCount, fmtMs, fmtPct, fmtRps } from '../../../../../src/run/format.ts';
import { Feed } from '../components/run/Feed.tsx';
import { AuditLog } from '../components/run/AuditLog.tsx';
import { KpiStrip, SignatureTiles } from '../components/run/KpiStrip.tsx';
import { AiSection, ReportExport, ReportMeta, ReportNotices, ReportStages, RunsPanel } from '../components/run/Report.tsx';
const LazyReportQa = lazy(() => import('../components/run/ReportQa.tsx').then((m) => ({ default: m.ReportQa })));
import { RouteChart } from '../components/run/RouteChart.tsx';
import { SecondChart } from '../components/run/SecondChart.tsx';
import {
  AI_TAB_DISABLED_REASON,
  auditRevisionKey,
  buildKpiStripItems,
  feedRevisionKey,
  plainReason,
  resolveActiveRunTab,
  RUN_TAB_ITEMS,
  stagesRevisionKey,
  verdictLine,
} from '../components/run/report-tabs.ts';
import { type ProfileStage, StageProfile } from '../components/StageProfile.tsx';
import { StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { TurnstileBox } from '../components/Turnstile.tsx';
import { AlertRegion, ApiErrorText, ConfirmButton, DASH, KeyValues, PageSkeleton, StatusBadge, TableWrap } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { useRun } from '../hooks/useRun.ts';
import { reportNotices } from '../lib/report-view.ts';
import { elapsedMs, formatElapsed, isTerminal, reportExpected, type RunModel } from '../lib/run-view.ts';
import { runHref, type RunTab, useRunTab } from '../router.ts';

export { plainReason, verdictLine };

function focusRunsPanel() {
  const el = document.getElementById('report-runs-heading');
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

export function RunPage({ id }: { id: string }) {
  const { navigate } = useApp();
  const requestedTab = useRunTab();
  const { state, stop, stopPending, stopError, turnstileBox, retry } = useRun(id);
  const tilesRef = useRef<HTMLDivElement>(null);
  const [tilesInView, setTilesInView] = useState(true);
  const pendingRunsScroll = useRef(false);
  const aiDisabledNoteId = useId();

  const ready = state.kind === 'ready' ? state : null;
  const ended = ready !== null && isTerminal(ready.model.run.status);
  const report = ended && ready !== null ? ready.model.report : null;
  const hasReport = report !== null;
  const activeTab = resolveActiveRunTab(requestedTab, hasReport);
  const queued = ready !== null && ready.model.run.status === 'queued';

  useEffect(() => {
    if (ready === null || activeTab !== 'overview' || queued) {
      setTilesInView(true);
      return;
    }
    const el = tilesRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setTilesInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setTilesInView(entry?.isIntersecting ?? true),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready !== null, activeTab, queued, hasReport]);

  useEffect(() => {
    if (activeTab === 'overview' && pendingRunsScroll.current && hasReport) {
      pendingRunsScroll.current = false;
      requestAnimationFrame(focusRunsPanel);
    }
  }, [activeTab, hasReport]);

  const handleTabChange = useCallback(
    (nextValue: unknown) => {
      if (typeof nextValue !== 'string') return;
      const candidate = nextValue as RunTab;
      if (candidate === 'ai' && !hasReport) return;
      if (candidate === activeTab) return;
      navigate(runHref(id, candidate).replace(/^#/, ''));
    },
    [activeTab, hasReport, id, navigate],
  );

  const goToRunsPanel = useCallback(() => {
    if (activeTab !== 'overview') {
      pendingRunsScroll.current = true;
      navigate(runHref(id, 'overview').replace(/^#/, ''));
      return;
    }
    focusRunsPanel();
  }, [activeTab, id, navigate]);

  const kpiItems = useMemo(
    () => (ready ? buildKpiStripItems(ready.model, ready.now) : []),
    [ready],
  );

  const stagesVersion = ready ? stagesRevisionKey(ready.model) : '';
  const feedVersion = ready ? feedRevisionKey(ready.model) : '';
  const auditVersion = ready ? auditRevisionKey(ready.model) : '';

  // Copy arrays only when underlying events/snapshots advance, so 1s clock ticks don't re-render charts/feed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stagesMemo = useMemo(() => (ready ? [...ready.model.stages] : []), [stagesVersion, id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decisionsMemo = useMemo(() => (ready ? [...ready.model.decisions] : []), [feedVersion, id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const containmentMemo = useMemo(() => (ready ? [...ready.model.containment] : []), [feedVersion, id]);

  if (state.kind === 'loading') {
    return <PageSkeleton title="Loading run…" />;
  }
  if (state.kind === 'error') {
    return (
      <section className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-6">
        <div className="grid gap-2">
          <StageBand />
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Run
          </h1>
        </div>
        <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-3 bg-card">
          <ApiErrorText error={state.error} />
        </TelemetryPanel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={retry}>
            Try again
          </Button>
          <Button render={<a href="#/" />} nativeButton={false} variant="outline" className="border-bar">
            Start a new test
          </Button>
        </div>
      </section>
    );
  }

  const { model, now, stale } = state;
  const running = model.run.status === 'running';
  const queuePos = model.run.queuePosition ?? null;
  const limit = model.plan?.stopThresholds ?? report?.thresholds ?? null;
  const reason = model.run.statusReason === null ? null : plainReason(model.run.statusReason);

  return (
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-4 print:max-w-none">
      <header className="flex flex-col justify-between gap-4 min-[861px]:flex-row min-[861px]:items-start print:hidden">
        <div className="flex min-w-0 flex-col gap-1.5">
          <StageBand />
          <h1 className="m-0 font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.034em] break-words text-balance text-foreground max-[860px]:text-[1.625rem]">
            {model.plan?.name ?? report?.planName ?? 'Load test'}
          </h1>
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusBadge status={model.run.status} />
              {running && stale ? <Badge variant="warn">Progress may be out of date</Badge> : null}
            </span>
            <span>
              Run <span className="font-mono text-xs text-foreground">{model.run.id}</span>
            </span>
            {model.plan ? (
              <span>
                on <span className="font-mono text-xs break-all text-foreground">{model.plan.target}</span>
              </span>
            ) : null}
            <span>
              {running ? 'Elapsed' : 'Total time'}{' '}
              <span className="font-mono text-xs text-foreground tabular-nums">
                {formatElapsed(elapsedMs(model.run, now))}
              </span>
            </span>
            <span>
              Sandbox <span className="font-mono text-xs text-foreground">{model.run.runtime}</span>
            </span>
          </p>
        </div>

        {queued || running ? (
          <div className="flex max-w-none flex-col items-start gap-1.5 text-left min-[861px]:max-w-[260px] min-[861px]:items-end min-[861px]:text-right">
            {stopPending ? (
              <Button type="button" variant="destructive" disabled>
                Stopping{'\u2026'}
              </Button>
            ) : (
              <ConfirmButton
                label={queued ? 'Cancel queued run' : 'Stop run'}
                confirmLabel={queued ? 'Confirm cancel' : 'Confirm stop'}
                cancelLabel={queued ? 'Keep queued' : 'Keep running'}
                className={buttonVariants({ variant: 'destructive' })}
                confirmClassName={buttonVariants({ variant: 'destructive' })}
                cancelClassName={buttonVariants({ variant: 'secondary' })}
                groupClassName="flex-row-reverse"
                onConfirm={stop}
              />
            )}
            <p className="m-0 text-xs text-muted-foreground">
              {queued
                ? queuePos !== null
                  ? `Queued (#${queuePos} in line): starts automatically when the active run finishes.`
                  : 'Queued: starts automatically when the active run finishes.'
                : 'Ends the current stage and keeps the results so far.'}
            </p>
            <AlertRegion error={stopError} />
            <TurnstileBox boxRef={turnstileBox} />
          </div>
        ) : report ? (
          <div className="flex shrink-0 flex-col items-start gap-1.5 min-[861px]:items-end">
            <Button type="button" variant="secondary" onClick={goToRunsPanel}>
              Run again and compare
            </Button>
          </div>
        ) : null}
      </header>

      {ended && reason && !report ? (
        (model.run.status === 'failed' || model.run.status === 'interrupted') && model.report === null ? (
          <div className="grid gap-1.5 rounded-md border border-bad px-3.5 py-3 text-[0.8125rem] text-foreground" role="alert">
            <p className="m-0 font-medium">Run {model.run.status.replace(/_/g, ' ')}</p>
            <p className="m-0">{reason}</p>
          </div>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">{reason}</p>
        )
      ) : null}

      {report ? (
        <p className="m-0 max-w-[78ch] text-sm leading-relaxed text-pretty text-foreground">
          {verdictLine(report, model.routes)}
        </p>
      ) : null}

      <div className="min-w-0">
        {/* Sticky only from 861px, where the strip is one line. On phones it would stack into four rows
            under the sticky header and cover about a quarter of the screen, so it scrolls with the page. */}
        {activeTab === 'overview' ? (
          !queued && !tilesInView ? (
            <div className="hidden min-[861px]:sticky min-[861px]:top-[53px] min-[861px]:z-20 min-[861px]:block min-[861px]:h-0 min-[861px]:overflow-visible print:hidden">
              <KpiStrip items={kpiItems} />
            </div>
          ) : null
        ) : (
          <div className="mb-4 min-[861px]:sticky min-[861px]:top-[53px] min-[861px]:z-20 print:hidden">
            <KpiStrip items={kpiItems} />
          </div>
        )}

        <div data-report-root={report ? 'true' : undefined} className="flex min-w-0 flex-col gap-4">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
              <TabsList
                aria-label="Capacity Report sections"
                className="flex h-auto w-full flex-wrap justify-start gap-1 border border-[var(--ap-line-strong)] bg-surface p-1 group-data-horizontal/tabs:h-auto sm:w-fit"
              >
                {RUN_TAB_ITEMS.map((tab) => {
                  const disabled = tab.id === 'ai' && !hasReport;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      disabled={disabled}
                      aria-describedby={disabled ? aiDisabledNoteId : undefined}
                      title={disabled ? `${tab.label} — ${AI_TAB_DISABLED_REASON}` : undefined}
                      className="min-h-8 flex-none border border-transparent px-3 py-1 text-xs data-active:border-[var(--ap-line-strong)] data-active:bg-secondary data-active:text-foreground"
                    >
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {!hasReport ? (
                <p id={aiDisabledNoteId} className="m-0 text-xs text-muted-foreground">
                  AI Insights &amp; Report Q&amp;A: {AI_TAB_DISABLED_REASON}.
                </p>
              ) : null}
            </div>

            <TabsContent value="overview" className="flex min-w-0 flex-col gap-4">
            {activeTab === 'overview' ? (
              <>
                {queued ? (
                  <TelemetryPanel ticks="bar" aria-labelledby="queue-wait-heading">
                    <h2 id="queue-wait-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                      Waiting in queue
                    </h2>
                    <p className="m-0 text-sm text-muted-foreground">
                      {queuePos !== null
                        ? `Position #${queuePos} in line. This run will start automatically as soon as the active run finishes.`
                        : 'This run is queued and will start automatically as soon as the active run finishes.'}
                    </p>
                  </TelemetryPanel>
                ) : (
                  <>
                    <SignatureTiles ref={tilesRef} items={kpiItems} reportMode={report !== null} />

                    {report && (reason || reportNotices(report).length > 0) ? (
                      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                        {reason ? <p className="m-0">{reason}</p> : null}
                        <ReportNotices report={report} />
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-3 min-[1180px]:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)] min-[1180px]:items-stretch print:hidden">
                      <TelemetryPanel ticks="bar" aria-labelledby="route-chart-heading">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h2 id="route-chart-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
                            p95 latency per route
                          </h2>
                          <span className="text-xs text-muted-foreground">After each finished stage</span>
                        </div>
                        <TableWrap label="Chart of p95 latency per route">
                          <RouteChart
                            stages={stagesMemo}
                            plan={model.plan}
                            limitMs={limit?.p95Ms ?? 1500}
                            routes={model.routes}
                          />
                        </TableWrap>
                      </TelemetryPanel>
                      <Feed
                        stages={stagesMemo}
                        decisions={decisionsMemo}
                        containment={containmentMemo}
                        total={model.plan?.stages.length ?? null}
                      />
                    </div>
                  </>
                )}

                {report ? (
                  <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex flex-col gap-3 pt-2">
                      <h2
                        id="report-heading"
                        className="m-0 font-display text-[1.75rem] leading-[1.08] font-semibold tracking-[-0.034em] text-foreground"
                      >
                        Capacity report
                      </h2>
                      <ReportMeta report={report} />
                    </div>
                    <ReportExport report={report} />
                    <RunsPanel report={report} />
                  </div>
                ) : (
                  <StageProfile stages={profile(model, now)} compact />
                )}
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="stages" className="flex min-w-0 flex-col gap-4">
            {activeTab === 'stages' ? (
              report ? (
                <>
                  <ReportStages report={report} />
                  <DuringTheStage stages={stagesMemo} routes={model.routes} />
                </>
              ) : (
                <>
                  <LiveStages model={model} revision={stagesVersion} />
                  {ended && model.report === null && reportExpected(model.run.status) ? (
                    <p className="m-0 text-sm text-muted-foreground" role="status">
                      Building the capacity report.
                    </p>
                  ) : null}
                  <DuringTheStage stages={stagesMemo} routes={model.routes} />
                </>
              )
            ) : null}
          </TabsContent>

          <TabsContent value="ai" className="flex min-w-0 flex-col gap-4">
            {activeTab === 'ai' && report ? (
              <>
                <AiSection report={report} />
                <Suspense fallback={null}>
                  <LazyReportQa report={report} />
                </Suspense>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="audit" className="flex min-w-0 flex-col gap-4">
            {activeTab === 'audit' ? <AuditLog model={model} revision={auditVersion} /> : null}
          </TabsContent>
        </Tabs>
        </div>
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

/**
 * "During the stage": one per-second chart per stage that carries samples, drawn
 * from the stored rows. Stages without samples (older runs) render nothing.
 */
const DuringTheStage = memo(function DuringTheStage({
  stages,
  routes,
}: {
  stages: readonly StageView[];
  routes: readonly { id: string; path: string }[];
}) {
  const withSamples = stages.filter((s) => (s.samples?.length ?? 0) > 0);
  if (withSamples.length === 0) return null;
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="during-stage-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="during-stage-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          During the stage
        </h2>
        <span className="text-xs text-muted-foreground">Average latency per second, measured while each stage ran.</span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {withSamples.map((s) => (
          <div key={s.index} className="flex flex-col gap-2.5 py-3.5 first:pt-0 last:pb-0">
            <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">
              Stage <span className="font-mono text-foreground tabular-nums">{s.index + 1}</span> (
              <span className="font-mono tabular-nums">{s.vus}</span> VUs)
            </h3>
            <TableWrap label={`Chart of average latency per second for stage ${s.index + 1}`}>
              <SecondChart stage={s} displayIndex={s.index + 1} routes={routes} />
            </TableWrap>
          </div>
        ))}
      </div>
    </TelemetryPanel>
  );
});

/** Live stage table, including planned stages not started yet ("pending", or "not run" after an early end). */
const LiveStages = memo(function LiveStages({
  model,
  revision: _revision,
}: {
  model: RunModel;
  revision: string;
}) {
  const started = new Set(model.stages.map((s) => s.index));
  const unstarted = (model.plan?.stages ?? []).map((p, index) => ({ index, ...p })).filter((p) => !started.has(p.index));
  const pending = model.run.status === 'running' || model.run.status === 'queued' ? 'pending' : 'not run';
  const dash = Array.from({ length: 7 }, (_, i) => (
    <td key={i} className="num font-mono tabular-nums">
      {DASH}
    </td>
  ));
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="live-stages-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-stages-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Stages
        </h2>
      </div>
      {model.stages.length === 0 && unstarted.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No Stage has started yet.</p>
      ) : (
        <TableWrap label="Stages">
          <table className="data-table w-full min-w-[860px] table-fixed print:min-w-0 print:table-auto">
            <caption className="sr-only">Stages</caption>
            <colgroup>
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-24" />
              {Array.from({ length: 7 }, (_, i) => (
                <col key={i} />
              ))}
              <col className="w-24" />
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
                  <th key={h} scope="col" className="num whitespace-normal">
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
                    <th scope="row" className="idx font-mono tabular-nums">
                      {s.index + 1}
                    </th>
                    <td className="num font-mono tabular-nums">{s.vus}</td>
                    <td className="num font-mono tabular-nums">{s.durationSec} s</td>
                    {s.status === 'error' ? (
                      <>
                        <td colSpan={7}>{s.errorReason ?? 'No reason was recorded.'}</td>
                        <td className="end">
                          <Badge variant="destructive">error</Badge>
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
                              <td key={i} className="num font-mono tabular-nums">
                                {v}
                              </td>
                            ))
                          : dash}
                        <td className="end">
                          {s.status === 'running' ? (
                            <Badge variant="live">running</Badge>
                          ) : s.verdict ? (
                            <Badge variant={s.verdict === 'pass' ? 'ok' : 'destructive'}>{s.verdict}</Badge>
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
                <tr key={`p${p.index}`} className="text-muted-foreground">
                  <th scope="row" className="idx font-mono tabular-nums">
                    {p.index + 1}
                  </th>
                  <td className="num font-mono tabular-nums">{p.vus}</td>
                  <td className="num font-mono tabular-nums">{p.durationSec} s</td>
                  {dash}
                  <td className="end">
                    <Badge variant="outline">{pending}</Badge>
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
                <span className="font-mono text-xs tabular-nums">
                  p95 {fmtMs(model.plan.stopThresholds.p95Ms)} ms, error rate {model.plan.stopThresholds.errorRatePct}%
                </span>,
              ]
            : null,
        ]}
      />
    </TelemetryPanel>
  );
});
