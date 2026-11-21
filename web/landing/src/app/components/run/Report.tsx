/**
 * The capacity report panels once the run has ended. Every number comes from the
 * stored metrics; AI text appears only in the section labelled as the AI's.
 * Wording and states follow lib/report-view.ts, whose view models are reused.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, DownloadIcon, ExternalLinkIcon, GitCompareIcon, PlayIcon, PrinterIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { CapacityReport, MetricsView, RouteRowView, StageView } from '../../../../../../src/report/build.ts';
import type { Comparison } from '../../../../../../src/report/compare.ts';
import { reportCsvFilename, reportToCsv } from '../../../../../../src/report/export.ts';
import { useApp } from '../../context.tsx';
import { type ApiError, getRunsForPlan, postRun, VERIFICATION_ERROR } from '../../lib/api.ts';
import { downloadText } from '../../lib/export.ts';
import { aiModel, canRerun, MAX_LISTED_RUNS, reportNotices, type RunListRow, runListRows } from '../../lib/report-view.ts';
import { compareHref, runHref } from '../../router.ts';
import { CompareView, type CompareViewError } from '../compare/CompareView.tsx';
import { togglePickedRun } from '../compare/runs-table-view.ts';
import { useRunComparison } from '../compare/useRunComparison.ts';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';
import { TurnstileBox, useTurnstile } from '../Turnstile.tsx';
import { AlertRegion, Busy, StatusBadge, TableWrap } from '../ui.tsx';

const METRIC_HEADS = ['Requests', 'Requests/s', 'Error rate', 'HTTP 429', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)'] as const;

function MetricCells({ m }: { m: MetricsView }) {
  const d = m.display;
  return (
    <>
      {[d.requests, d.rps, d.errorRatePct, d.http429, d.p50, d.p95, d.p99].map((v, i) => (
        <td key={i} className="num font-mono tabular-nums">
          {v}
        </td>
      ))}
    </>
  );
}

function verdictBadge(s: StageView) {
  if (s.status === 'error') return <Badge variant="destructive">error</Badge>;
  if (s.verdict === 'pass') return <Badge variant="ok">pass</Badge>;
  if (s.verdict === 'fail') return <Badge variant="destructive">fail</Badge>;
  return <Badge variant="outline">no metrics</Badge>;
}

export function ReportNotices({ report }: { report: CapacityReport }) {
  const notices = reportNotices(report);
  if (notices.length === 0) return null;
  return (
    <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
      {notices.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export const ReportStages = memo(function ReportStages({ report }: { report: CapacityReport }) {
  const withRoutes = report.stages.filter((s) => s.routes.length > 0);
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="report-stages-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="report-stages-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Stages
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {report.stages.length} {report.stages.length === 1 ? 'stage' : 'stages'}
        </span>
      </div>
      <TableWrap label="Stages">
        <table className="data-table w-full min-w-[860px] table-fixed print:min-w-0 print:table-auto">
          <caption className="sr-only">Stages</caption>
          <colgroup>
            <col className="w-16" />
            <col className="w-20" />
            <col className="w-24" />
            {METRIC_HEADS.map((h) => (
              <col key={h} />
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
              {METRIC_HEADS.map((h) => (
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
            {report.stages.map((s) => (
              <tr key={s.index}>
                <th scope="row" className="idx font-mono tabular-nums">
                  {s.displayIndex}
                </th>
                <td className="num font-mono tabular-nums">{s.vus}</td>
                <td className="num font-mono tabular-nums">{s.durationSec} s</td>
                {s.overall !== null ? (
                  <MetricCells m={s.overall} />
                ) : (
                  <td colSpan={7} className="text-muted-foreground">
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
        <details className="group grid gap-3 pt-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-1 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="m-0 font-sans text-sm font-medium text-foreground">Routes per stage</h3>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{withRoutes.length} stages</span>
            </div>
            <ChevronDownIcon
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="flex flex-col gap-5">
            {withRoutes.map((s) => (
              <RouteTable key={s.index} stage={s} />
            ))}
          </div>
        </details>
      ) : null}
    </TelemetryPanel>
  );
});

function RouteTable({ stage }: { stage: StageView }) {
  return (
    <TableWrap label={`Stage ${stage.displayIndex} routes`}>
      <table className="data-table w-full min-w-[860px] table-fixed print:min-w-0 print:table-auto">
        <colgroup>
          <col className="w-[16%]" />
          {METRIC_HEADS.map((h) => (
            <col key={h} />
          ))}
          <col className="w-[170px]" />
        </colgroup>
        <caption className="pt-2 text-left text-sm font-medium text-foreground">
          Stage {stage.displayIndex} routes ({stage.vus} VUs)
        </caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            {METRIC_HEADS.map((h) => (
              <th key={h} scope="col" className="num whitespace-normal">
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
            <tr key={r.route}>
              <th scope="row" className="font-mono text-xs break-all">
                {r.route}
              </th>
              <MetricCells m={r} />
              <td className="end">
                {r.exceedsThresholds ? (
                  <Badge variant="warn">Exceeded thresholds</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Within</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export const AiSection = memo(function AiSection({ report }: { report: CapacityReport }) {
  const m = aiModel(report);
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="report-ai-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="report-ai-heading" className="m-0 flex items-center gap-2 font-sans text-[1.0625rem] font-medium text-foreground">
          <span>AI-generated</span>
          <Badge variant="secondary">AI</Badge>
        </h2>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Written by an AI model. The headline values and tables on this page come from the stored metrics, not from the AI.
      </p>
      {m.notes.length > 0 ? (
        <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-muted-foreground" role={m.pending ? undefined : 'status'}>
          {m.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] min-[1180px]:gap-8">
        {m.explanation !== null ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">Explanation</h3>
            <p className="m-0 max-w-[72ch] text-sm leading-relaxed text-foreground">{m.explanation}</p>
          </div>
        ) : null}
        {m.suggestions.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">Suggestions</h3>
            <ol className="m-0 grid list-decimal gap-1.5 pl-5 text-sm leading-relaxed text-foreground">
              {m.suggestions.map((s, i) => (
                <li key={i} className="max-w-[72ch]">
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </TelemetryPanel>
  );
});

/**
 * The two export buttons for the report: the measured CSV file and the browser's
 * print dialog (save as PDF). Print opens every closed disclosure inside `[data-report-root="true"]`
 * and afterprint restores only those that were closed.
 */
export const ReportExport = memo(function ReportExport({ report }: { report: CapacityReport }) {
  const { announce } = useApp();

  useEffect(() => {
    let wereClosed: HTMLDetailsElement[] = [];
    const before = (): void => {
      wereClosed = Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-report-root="true"] details:not([open])'));
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
    <div className="flex flex-wrap items-center gap-2.5 print:hidden">
      <Button type="button" variant="secondary" onClick={downloadCsv}>
        <DownloadIcon data-icon="inline-start" />
        Download CSV
      </Button>
      <Button type="button" variant="secondary" onClick={() => window.print()}>
        <PrinterIcon data-icon="inline-start" />
        Print / save as PDF
      </Button>
    </div>
  );
});

export const ReportMeta = memo(function ReportMeta({ report }: { report: CapacityReport }) {
  const items: readonly [string, React.ReactNode, boolean][] = [
    ['Target', <span className="font-mono text-xs break-all text-foreground">{report.target}</span>, false],
    [
      'Stop thresholds',
      <span className="font-mono text-xs text-foreground tabular-nums">
        p95 {report.thresholds.p95Ms} ms, error rate {report.thresholds.errorRatePct}%
      </span>,
      false,
    ],
    ['Sandbox runtime', <span className="font-mono text-xs text-foreground">{report.runtime}</span>, false],
    ['Run ID', <span className="font-mono text-xs break-all text-foreground">{report.runId}</span>, false],
    ['Plan hash', <span className="font-mono text-xs break-all text-foreground">{report.planHash}</span>, true],
  ];
  return (
    <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([k, v, wide]) => (
        <div
          key={k}
          className={cn(
            'flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3',
            wide && 'sm:col-span-2 lg:col-span-4',
          )}
        >
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="m-0 min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
});

export interface InlineRunComparisonProps {
  a: string;
  b: string;
  loading: boolean;
  error: CompareViewError | null;
  comparison: Comparison | null;
  onRetry: () => void;
  onClose: () => void;
}

/** Inline Run Compare view rendered inside `RunsPanel`, reusing `CompareView` with a link to `#/compare/:a/:b`. */
export function InlineRunComparison({
  a,
  b,
  loading,
  error,
  comparison,
  onRetry,
  onClose,
}: InlineRunComparisonProps) {
  return (
    <div className="flex flex-col gap-3 pt-1 print:pt-0">
      <Separator className="print:hidden" />
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="m-0 font-sans text-[0.9375rem] font-medium text-foreground">Run comparison</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {a} vs {b}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            render={<a href={compareHref(a, b)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="border-bar"
          >
            Open full compare view
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <XIcon data-icon="inline-start" />
            Close comparison
          </Button>
        </div>
      </div>

      <CompareView a={a} b={b} loading={loading} error={error} comparison={comparison} onRetry={onRetry} />
    </div>
  );
}

/** Re-run the same approved plan, list its runs, and compare two runs inline via `CompareView`. */
export const RunsPanel = memo(function RunsPanel({ report }: { report: CapacityReport }) {
  const { navigate, announce } = useApp();
  const turnstile = useTurnstile();
  const [rows, setRows] = useState<RunListRow[] | null>(null);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparePair, setComparePair] = useState<{ a: string; b: string } | null>(null);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<ApiError | null>(null);
  const alive = useRef(true);

  const { loading: compareLoading, error: compareError, comparison, retry: retryCompare } = useRunComparison(comparePair);

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
    setRerunConfirmOpen(false);
    setRerunError(null);
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

  const toggle = (id: string, on: boolean) => setPicked((p) => togglePickedRun(p, id, on));

  const canCompare = picked.length === 2;

  const startCompare = () => {
    if (!canCompare) return;
    const next = { a: picked[0]!, b: picked[1]! };
    if (comparePair?.a === next.a && comparePair.b === next.b) {
      retryCompare();
      return;
    }
    setComparePair(next);
  };

  return (
    <TelemetryPanel
      ticks="bar"
      aria-labelledby="report-runs-heading"
      className={cn(
        comparePair === null ? 'print:hidden' : 'print:border-0 print:bg-transparent print:p-0',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
        <h2 id="report-runs-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Run again and compare
        </h2>
      </div>

      {canRerun(report.headline.status) ? (
        <div className="flex flex-col gap-2.5 print:hidden">
          <p className="m-0 text-sm text-muted-foreground">
            Start a new run of this same approved plan. The plan is not changed.
          </p>
          <TurnstileBox boxRef={turnstile.box} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="default" disabled={rerunBusy} onClick={() => setRerunConfirmOpen(true)}>
              <PlayIcon data-icon="inline-start" />
              Run this plan again
            </Button>
            {rerunBusy ? <Busy>Starting the run…</Busy> : null}
          </div>
          <Dialog open={rerunConfirmOpen} onOpenChange={setRerunConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Run this plan again?</DialogTitle>
                <DialogDescription>
                  Run &ldquo;{report.planName}&rdquo; again against{' '}
                  <span className="font-mono text-foreground">{report.target}</span>? This starts a new run of the same
                  approved plan.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
                <Button type="button" variant="default" disabled={rerunBusy} onClick={() => void rerun()}>
                  <PlayIcon data-icon="inline-start" />
                  Start new run
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertRegion error={rerunError} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 print:hidden">
        <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">Runs of this plan</h3>
        {listError ? (
          <AlertRegion error={listError} />
        ) : rows === null ? (
          <p className="m-0 text-sm text-muted-foreground" role="status">
            Loading runs.
          </p>
        ) : rows.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No runs of this plan were found.</p>
        ) : (
          <TableWrap label="Runs of this plan">
            <table className="data-table w-full min-w-[720px]">
              <caption className="sr-only">
                Most recent runs of this plan, newest first (up to {MAX_LISTED_RUNS})
              </caption>
              <colgroup>
                <col className="w-11" />
                <col />
                <col className="w-[190px]" />
                <col className="w-[140px]" />
                <col className="w-[130px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Select</span>
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
                    <tr key={r.runId} className={cn(on && 'bg-surface-2')}>
                      <td className="align-middle">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={picked.length >= 2 && !on}
                          aria-label={`Select run ${r.runId}`}
                          onChange={(e) => toggle(r.runId, e.target.checked)}
                          className="size-[18px] cursor-pointer rounded-sm align-middle accent-[var(--accent-text)] focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45"
                        />
                      </td>
                      <th scope="row" className="font-mono text-xs">
                        <a href={runHref(r.runId)} className="underline underline-offset-4 hover:text-accent-text">
                          {r.runId}
                        </a>
                        {r.runId === report.runId ? (
                          <span className="font-sans text-xs font-normal text-muted-foreground"> (this run)</span>
                        ) : null}
                      </th>
                      <td className="idx font-mono text-xs tabular-nums">{r.started}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="num font-mono tabular-nums">{r.safeCapacity}</td>
                      <td className="num font-mono tabular-nums">{r.breakingPoint}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button
          type="button"
          variant="secondary"
          disabled={!canCompare}
          onClick={startCompare}
        >
          <GitCompareIcon data-icon="inline-start" />
          Compare selected runs
        </Button>
        {picked.length > 0 ? (
          <Button type="button" variant="outline" size="sm" className="border-bar" onClick={() => setPicked([])}>
            Clear selection
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">Select two runs to compare them side by side.</span>
      </div>

      {comparePair !== null ? (
        <InlineRunComparison
          a={comparePair.a}
          b={comparePair.b}
          loading={compareLoading}
          error={compareError}
          comparison={comparison}
          onRetry={retryCompare}
          onClose={() => setComparePair(null)}
        />
      ) : null}
    </TelemetryPanel>
  );
});
