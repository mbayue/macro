/**
 * The capacity report, shown in place on the run page once the run has ended. Every number
 * comes from the stored metrics; AI text appears only in the section labelled as the AI's.
 * Wording and states follow web/report-view.ts, whose view models are reused.
 */
import { useEffect, useRef, useState } from 'react';
import type { CapacityReport, MetricsView, RouteRowView, StageView } from '../../../../../../src/report/build.ts';
import { reportCsvFilename, reportToCsv } from '../../../../../../src/report/export.ts';
import { type ApiError, getCompare, getRunsForPlan, postRun, VERIFICATION_ERROR } from '../../lib/api.ts';
import type { Comparison } from '../../../../../../src/report/compare.ts';
import { headlineCompareRows, parseComparison, stageCompareRows } from '../../lib/compare-view.ts';
import { downloadText } from '../../lib/export.ts';
import { fmtUtc } from '../../lib/format.ts';
import { aiModel, canRerun, MAX_LISTED_RUNS, reportNotices, type RunListRow, runListRows } from '../../lib/report-view.ts';
import { useApp } from '../../context.tsx';
import { runHref } from '../../router.ts';
import { TurnstileBox, useTurnstile } from '../Turnstile.tsx';
import { AlertRegion, ApiErrorText, Badge, Busy, Panel, StatusBadge, TableWrap } from '../ui.tsx';

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
        <table className="table table--stages">
          <caption className="visually-hidden">Stages</caption>
          <colgroup>
            <col className="w-stage" />
            <col className="w-vus" />
            <col className="w-dur" />
            {METRIC_HEADS.map((h) => (
              <col key={h} />
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
              {METRIC_HEADS.map((h) => (
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
            {report.stages.map((s) => (
              <tr key={s.index}>
                <th scope="row" className="idx">
                  {s.displayIndex}
                </th>
                <td className="num">{s.vus}</td>
                <td className="num">{s.durationSec} s</td>
                {s.overall !== null ? (
                  <MetricCells m={s.overall} />
                ) : (
                  <td colSpan={7} className="muted">
                    {s.status === 'error'
                      ? `Stage failed${s.errorReason !== null ? `: ${s.errorReason}` : '.'}`
                      : 'This Stage has no metrics.'}
                  </td>
                )}
                <td className="end">{verdictBadge(s)}</td>
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
      <table className="table table--routes">
        <colgroup>
          <col className="w-route" />
          {METRIC_HEADS.map((h) => (
            <col key={h} className="w-metric" />
          ))}
          <col className="w-verdict" />
        </colgroup>
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
            <th scope="col" className="end">
              Thresholds
            </th>
          </tr>
        </thead>
        <tbody>
          {stage.routes.map((r: RouteRowView) => (
            <tr key={r.route} className={r.exceedsThresholds ? 'is-exceeded' : undefined}>
              <th scope="row" className="code">
                {r.route}
              </th>
              <MetricCells m={r} />
              <td className="end">{r.exceedsThresholds ? <Badge tone="warn">Exceeded thresholds</Badge> : <span className="muted">Within</span>}</td>
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

/**
 * The two quiet export buttons above the report: the measured CSV file and the
 * browser's own print dialog (save as PDF). Print opens every closed route
 * disclosure and afterprint restores exactly who was closed.
 */
export function ReportExport({ report }: { report: CapacityReport }) {
  const { announce } = useApp();

  useEffect(() => {
    let wereClosed: HTMLDetailsElement[] = [];
    const before = (): void => {
      wereClosed = Array.from(document.querySelectorAll<HTMLDetailsElement>('.report details:not([open])'));
      for (const d of wereClosed) d.open = true;
    };
    const after = (): void => {
      for (const d of wereClosed) d.open = false;
      wereClosed = [];
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const downloadCsv = (): void => {
    downloadText(reportCsvFilename(report.runId), reportToCsv(report), 'text/csv;charset=utf-8');
    announce('Report exported.');
  };

  return (
    <div className="row report__export">
      <button type="button" className="btn btn--quiet" onClick={downloadCsv}>
        Download CSV
      </button>
      <button type="button" className="btn btn--quiet" onClick={() => window.print()}>
        Print / save as PDF
      </button>
    </div>
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
/** Re-run the same approved plan, list its runs, compare two of them. The class scopes the print rules. */
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
    <Panel title="Run again and compare" id="report-runs-heading" className="panel--runs">
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
          <table className="table table--runs">
            <caption className="visually-hidden">Most recent runs of this plan, newest first (up to {MAX_LISTED_RUNS})</caption>
            <colgroup>
              <col className="w-check" />
              <col />
              <col className="w-started" />
              <col className="w-status" />
              <col className="w-num" />
              <col className="w-num" />
            </colgroup>
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
