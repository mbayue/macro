/**
 * The capacity report, shown in place on the run page once the run has ended. Every number
 * comes from the stored metrics; AI text appears only in the section labelled as the AI's.
 * Wording and states follow web/report-view.ts, whose view models are reused.
 */
import { useEffect, useRef, useState } from 'react';
import type { CapacityReport, MetricsView, RouteRowView, StageView } from '../../../../../../src/report/build.ts';
import { type ApiError, getCompare, getRunsForPlan, postRun, VERIFICATION_ERROR } from '../../../../../api.ts';
import { buildChartGeometry, CHART_WIDTH, chartDescription, chartInputFromReport } from '../../../../../chart.ts';
import { useWidth } from '../../hooks/useWidth.ts';
import type { Comparison } from '../../../../../../src/report/compare.ts';
import { headlineCompareRows, parseComparison, stageCompareRows } from '../../../../../compare-view.ts';
import { fmtUtc } from '../../../../../dom.ts';
import { aiModel, canRerun, MAX_LISTED_RUNS, reportNotices, type RunListRow, runListRows } from '../../../../../report-view.ts';
import { useApp } from '../../context.tsx';
import { runHref } from '../../router.ts';
import { TurnstileBox, useTurnstile } from '../Turnstile.tsx';
import { AlertRegion, ApiErrorText, Badge, Busy, KeyValues, Panel, StatusBadge, TableWrap } from '../ui.tsx';

const METRIC_HEADS = ['Requests', 'Requests/s', 'Error rate', 'HTTP 429', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)'] as const;

function MetricCells({ m }: { m: MetricsView }) {
  const d = m.display;
  return (
    <>
      {[d.requests, d.rps, d.errorRatePct, d.http429, d.p50, d.p95, d.p99].map((v, i) => (
        <td key={i} className="num">
          {v}
        </td>
      ))}
    </>
  );
}

function verdictBadge(s: StageView) {
  if (s.status === 'error') return <Badge tone="bad">error</Badge>;
  if (s.verdict === 'pass') return <Badge tone="ok">pass</Badge>;
  if (s.verdict === 'fail') return <Badge tone="bad">fail</Badge>;
  return <Badge>no metrics</Badge>;
}

export function ReportChart({ report }: { report: CapacityReport }) {
  const [box, measured] = useWidth<HTMLDivElement>(CHART_WIDTH);
  const input = chartInputFromReport(report);
  if (input.stages.length === 0) return null;
  const base = buildChartGeometry(input);
  // The geometry is laid out at CHART_WIDTH; stretch it horizontally to the real width, so text keeps its size.
  const width = Math.max(520, measured);
  const k = (width - (CHART_WIDTH - base.plot.width)) / base.plot.width;
  const sx = (x: number) => base.plot.x + (x - base.plot.x) * k;
  const g = {
    ...base,
    width,
    plot: { ...base.plot, width: base.plot.width * k },
    points: base.points.map((p) => ({ ...p, cx: sx(p.cx) })),
    bars: base.bars.map((b) => ({ ...b, x: sx(b.x + b.width / 2) - b.width / 2 })),
    xLabels: base.xLabels.map((l) => ({ ...l, x: sx(l.x) })),
  };
  g.linePath = g.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)} ${p.cy}`).join(' ');
  const { plot } = g;
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;
  return (
    <Panel title="p95 latency and error rate per stage" id="report-chart-heading">
      <div className="chart-split">
        <div ref={box} className="chart-box">
          <TableWrap label="Chart of p95 latency and error rate per stage">
            <svg
              className="stage-chart"
              viewBox={`0 0 ${g.width} ${g.height}`}
              role="img"
              aria-labelledby="report-chart-title report-chart-desc"
              focusable="false"
            >
              <title id="report-chart-title">p95 latency and error rate per stage</title>
              <desc id="report-chart-desc">{chartDescription(input)}</desc>
              {g.leftTicks.map((t) => (
                <g key={`l${t.y}`}>
                  <line className="stage-chart__grid" x1={plot.x} x2={right} y1={t.y} y2={t.y} />
                  <text className="stage-chart__text" x={plot.x - 8} y={t.y + 4} textAnchor="end">
                    {t.label}
                  </text>
                </g>
              ))}
              {g.rightTicks.map((t) => (
                <text key={`r${t.y}`} className="stage-chart__text" x={right + 8} y={t.y + 4}>
                  {t.label}
                </text>
              ))}
              <line className="stage-chart__axis" x1={plot.x} x2={right} y1={bottom} y2={bottom} />
              <text className="stage-chart__text" x={plot.x - 8} y={plot.y - 12} textAnchor="end">
                p95 (ms)
              </text>
              <text className="stage-chart__text" x={right + 8} y={plot.y - 12}>
                Errors (%)
              </text>
              {g.bars.map((b) => (
                <rect key={b.position} className="stage-chart__bar" x={b.x} y={b.y} width={b.width} height={b.height} />
              ))}
              <line className="stage-chart__limit" x1={plot.x} x2={right} y1={g.p95LimitY} y2={g.p95LimitY} />
              <line className="stage-chart__limit stage-chart__limit--err" x1={plot.x} x2={right} y1={g.errorLimitY} y2={g.errorLimitY} />
              {g.linePath !== '' ? <path className="stage-chart__line" d={g.linePath} /> : null}
              {g.points.map((p) => (
                <circle key={p.position} className="stage-chart__point" cx={p.cx} cy={p.cy} r={4} />
              ))}
              {g.xLabels.map((l) => (
                <g key={l.stage}>
                  <text className="stage-chart__text" x={l.x} y={bottom + 20} textAnchor="middle">
                    {l.stage}
                  </text>
                  <text className="stage-chart__text" x={l.x} y={bottom + 36} textAnchor="middle">
                    {l.vus}
                  </text>
                </g>
              ))}
            </svg>
          </TableWrap>
        </div>
        <div className="chart-split__side">
          <ChartReadings report={report} />
          <ul className="legend">
            <li>
              <span className="legend__swatch legend__swatch--line" aria-hidden="true" />
              p95 latency (left axis), limit {report.thresholds.p95Ms} ms (dashed line)
            </li>
            <li>
              <span className="legend__swatch legend__swatch--bar" aria-hidden="true" />
              Error rate (right axis), limit {report.thresholds.errorRatePct}% (dotted line)
            </li>
          </ul>
          <p className="muted">The stage table below holds the same numbers. Stages without metrics are not drawn.</p>
        </div>
      </div>
    </Panel>
  );
}

/** The two readings the chart is for, stated as numbers from the stored metrics. */
function ChartReadings({ report }: { report: CapacityReport }) {
  const withMetrics = report.stages.filter((s) => s.overall !== null);
  const topP95 = withMetrics.reduce<StageView | null>((a, s) => (a === null || s.overall!.raw.p95 > a.overall!.raw.p95 ? s : a), null);
  const topErr = withMetrics.reduce<StageView | null>(
    (a, s) => (a === null || s.overall!.raw.errorRatePct > a.overall!.raw.errorRatePct ? s : a),
    null,
  );
  if (!topP95 || !topErr) return null;
  return (
    <dl className="readings">
      <div>
        <dt>Highest p95</dt>
        <dd>
          <span className="readings__value">{topP95.overall!.display.p95} ms</span>
          <span className="muted">
            stage {topP95.displayIndex}, {topP95.vus} VUs, limit {report.thresholds.p95Ms} ms
          </span>
        </dd>
      </div>
      <div>
        <dt>Highest error rate</dt>
        <dd>
          <span className="readings__value">{topErr.overall!.display.errorRatePct}</span>
          <span className="muted">
            stage {topErr.displayIndex}, limit {report.thresholds.errorRatePct}%
          </span>
        </dd>
      </div>
    </dl>
  );
}

export function ReportNotices({ report }: { report: CapacityReport }) {
  const notices = reportNotices(report);
  if (notices.length === 0) return null;
  return (
    <ul className="notices">
      {notices.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function ReportStages({ report }: { report: CapacityReport }) {
  const withRoutes = report.stages.filter((s) => s.routes.length > 0);
  return (
    <Panel title="Stages" id="report-stages-heading">
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
                Duration (s)
              </th>
              <th scope="col">Verdict</th>
              {METRIC_HEADS.map((h) => (
                <th key={h} scope="col" className="num">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.stages.map((s) => (
              <tr key={s.index}>
                <th scope="row" className="idx">
                  {s.displayIndex}
                </th>
                <td className="num">{s.vus}</td>
                <td className="num">{s.durationSec}</td>
                <td>{verdictBadge(s)}</td>
                {s.overall !== null ? (
                  <MetricCells m={s.overall} />
                ) : (
                  <td colSpan={7} className="muted">
                    {s.status === 'error'
                      ? `Stage failed${s.errorReason !== null ? `: ${s.errorReason}` : '.'}`
                      : 'This Stage has no metrics.'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {withRoutes.length > 0 ? (
        <details className="disclosure disclosure--inline">
          <summary>
            <h3 className="disclosure__title">Routes per stage</h3>
            <span className="disclosure__count">{withRoutes.length} stages</span>
          </summary>
          {withRoutes.map((s) => (
            <RouteTable key={s.index} stage={s} />
          ))}
        </details>
      ) : null}
    </Panel>
  );
}

function RouteTable({ stage }: { stage: StageView }) {
  return (
    <TableWrap label={`Stage ${stage.displayIndex} routes`}>
      <table className="table">
        <caption>
          Stage {stage.displayIndex} routes ({stage.vus} VUs)
        </caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            {METRIC_HEADS.map((h) => (
              <th key={h} scope="col" className="num">
                {h}
              </th>
            ))}
            <th scope="col">Thresholds</th>
          </tr>
        </thead>
        <tbody>
          {stage.routes.map((r: RouteRowView) => (
            <tr key={r.route} className={r.exceedsThresholds ? 'is-exceeded' : undefined}>
              <th scope="row" className="code">
                {r.route}
              </th>
              <MetricCells m={r} />
              <td>{r.exceedsThresholds ? <Badge tone="warn">Exceeded thresholds</Badge> : <span className="muted">Within</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function AiSection({ report }: { report: CapacityReport }) {
  const m = aiModel(report);
  return (
    <section className="panel ai" aria-labelledby="report-ai-heading">
      <div className="panel__head">
        <h2 id="report-ai-heading">
          AI-generated <Badge>AI</Badge>
        </h2>
      </div>
      <p className="muted">
        Written by an AI model. The headline values and tables on this page come from the stored metrics, not from the AI.
      </p>
      {m.notes.length > 0 ? (
        <ul className="ai__notes" role={m.pending ? undefined : 'status'}>
          {m.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="ai__cols">
        {m.explanation !== null ? (
          <div className="stack-tight">
            <h3 className="h-small">Explanation</h3>
            <p className="prose">{m.explanation}</p>
          </div>
        ) : null}
        {m.suggestions.length > 0 ? (
          <div className="stack-tight">
            <h3 className="h-small">Suggestions</h3>
            <ol className="ai__list">
              {m.suggestions.map((s, i) => (
                <li key={i} className="prose">
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ReportMeta({ report }: { report: CapacityReport }) {
  const items: [string, React.ReactNode][] = [
    ['Target', <span className="code">{report.target}</span>],
    [
      'Stop thresholds',
      <span className="num">
        p95 {report.thresholds.p95Ms} ms, error rate {report.thresholds.errorRatePct}%
      </span>,
    ],
    ['Sandbox runtime', <span className="code">{report.runtime}</span>],
    ['Run ID', <span className="code">{report.runId}</span>],
    ['Plan hash', <span className="code break">{report.planHash}</span>],
  ];
  return (
    <dl className="meta-strip">
      {items.map(([k, v]) => (
        <div key={k} className={k === 'Plan hash' ? 'meta-strip__wide' : undefined}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
/** Re-run the same approved plan, list its runs, compare two of them. */
export function RunsPanel({ report }: { report: CapacityReport }) {
  const { navigate, announce } = useApp();
  const turnstile = useTurnstile();
  const [rows, setRows] = useState<RunListRow[] | null>(null);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareError, setCompareError] = useState<ApiError | 'unreadable' | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void (async () => {
      const res = await getRunsForPlan(report.planHash, abort.signal);
      if (!alive.current) return;
      if (res.ok) setRows(runListRows(res.data.runs));
      else setListError(res.error);
    })();
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [report.planHash]);

  async function rerun() {
    if (rerunBusy) return;
    setRerunError(null);
    // One confirmation. Cancel sends nothing, not even a Turnstile request.
    if (!window.confirm(`Run "${report.planName}" again against ${report.target}? This starts a new run of the same approved plan.`))
      return;
    setRerunBusy(true);
    announce('Starting the run.');
    let result: Awaited<ReturnType<typeof postRun>>;
    try {
      const token = await turnstile.token();
      result = await postRun({ planHash: report.planHash, turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      turnstile.reset();
    }
    if (!alive.current) return;
    if (result.ok) {
      navigate(`/run/${encodeURIComponent(result.data.runId)}`);
      return;
    }
    setRerunBusy(false);
    setRerunError(result.error);
    announce(result.error.message);
  }

  async function compare() {
    const [a, b] = picked;
    if (comparing || a === undefined || b === undefined || a === b) return;
    const mine = ++seq.current;
    setComparing(true);
    setComparison(null);
    setCompareError(null);
    const res = await getCompare(a, b);
    if (!alive.current || mine !== seq.current) return;
    setComparing(false);
    if (!res.ok) return setCompareError(res.error);
    const parsed = parseComparison(res.data);
    if (parsed === null) setCompareError('unreadable');
    else setComparison(parsed);
  }

  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id].slice(0, 2) : p.filter((x) => x !== id)));

  return (
    <Panel title="Run again and compare" id="report-runs-heading">
      {canRerun(report.headline.status) ? (
        <div className="stack-tight">
          <p>Start a new run of this same approved plan. The plan is not changed.</p>
          <TurnstileBox boxRef={turnstile.box} />
          <div className="row">
            <button type="button" className="btn" disabled={rerunBusy} onClick={() => void rerun()}>
              Run this plan again
            </button>
            {rerunBusy ? <Busy>Starting the run.</Busy> : null}
          </div>
          <AlertRegion error={rerunError} />
        </div>
      ) : null}

      <h3 className="h-small">Runs of this plan</h3>
      {listError ? (
        <AlertRegion error={listError} />
      ) : rows === null ? (
        <p className="muted" role="status">
          Loading runs.
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">No runs of this plan were found.</p>
      ) : (
        <TableWrap label="Runs of this plan">
          <table className="table">
            <caption className="visually-hidden">Most recent runs of this plan, newest first (up to {MAX_LISTED_RUNS})</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Select</span>
                </th>
                <th scope="col">Run ID</th>
                <th scope="col">Started (UTC)</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Safe capacity (VUs)
                </th>
                <th scope="col" className="num">
                  Breaking point (VUs)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = picked.includes(r.runId);
                return (
                  <tr key={r.runId}>
                    <td>
                      <input
                        type="checkbox"
                        className="check"
                        checked={on}
                        disabled={comparing || (picked.length >= 2 && !on)}
                        aria-label={`Select run ${r.runId}`}
                        onChange={(e) => toggle(r.runId, e.target.checked)}
                      />
                    </td>
                    <th scope="row" className="code">
                      <a href={runHref(r.runId)}>{r.runId}</a>
                      {r.runId === report.runId ? <span className="muted"> (this run)</span> : null}
                    </th>
                    <td className="idx">{r.started}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.safeCapacity}</td>
                    <td className="num">{r.breakingPoint}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div className="row">
        <button type="button" className="btn btn--quiet" disabled={comparing || picked.length !== 2} onClick={() => void compare()}>
          Compare selected runs
        </button>
        <span className="muted">Select two runs to compare them side by side.</span>
      </div>
      <div aria-live="polite">
        {comparing ? (
          <p className="muted" role="status">
            Comparing runs.
          </p>
        ) : compareError === 'unreadable' ? (
          <div className="alert" role="alert">
            <p className="alert__message">The comparison could not be read. Please try again.</p>
          </div>
        ) : compareError ? (
          <div className="alert" role="alert">
            <ApiErrorText error={compareError} />
          </div>
        ) : comparison ? (
          <CompareResult comparison={comparison} />
        ) : null}
      </div>
    </Panel>
  );
}

function CompareResult({ comparison }: { comparison: Comparison }) {
  if (comparison.kind === 'different_plan') {
    return (
      <div className="notice notice--warn" role="status">
        <h3 className="h-small">These runs cannot be compared</h3>
        <p>{comparison.message}</p>
      </div>
    );
  }
  const head = headlineCompareRows(comparison);
  const cell = (text: string | null) => <td className={text === 'not run' ? 'num muted' : 'num'}>{text}</td>;
  return (
    <div className="compare">
      <h3 className="h-small">Comparison</h3>
      <div className="compare__runs">
        {(
          [
            ['Baseline (earlier run)', comparison.baseline],
            ['Later run', comparison.later],
          ] as const
        ).map(([label, run]) => (
          <div key={label}>
            <p className="muted">{label}</p>
            <p className="code">{run.runId}</p>
            <p className="muted">Started {fmtUtc(run.startedAt)}</p>
          </div>
        ))}
      </div>
      <TableWrap label="Headline comparison">
        <table className="table">
          <caption>Headline values</caption>
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Baseline</th>
              <th scope="col">Later</th>
            </tr>
          </thead>
          <tbody>
            {head.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="num">{r.baseline}</td>
                <td className="num">{r.later}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {comparison.stages.length === 0 ? (
        <p className="muted">Neither run has stage metrics to compare.</p>
      ) : (
        comparison.stages.map((st) => (
          <TableWrap key={st.displayIndex} label={`Stage ${st.displayIndex} comparison`}>
            <table className="table">
              <caption>
                Stage {st.displayIndex} ({st.vus} VUs)
              </caption>
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">
                    Baseline
                  </th>
                  <th scope="col" className="num">
                    Later
                  </th>
                  <th scope="col" className="num">
                    Difference
                  </th>
                  <th scope="col" className="num">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {stageCompareRows(st).map((row, i) => (
                  <tr key={`${row.scope}-${row.metric}-${i}`}>
                    <th scope="row" className="code">
                      {row.scope}
                    </th>
                    <td>{row.metric}</td>
                    {cell(row.value.baseline)}
                    {cell(row.value.later)}
                    {cell(row.value.difference)}
                    {cell(row.value.percentChange)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ))
      )}
    </div>
  );
}
