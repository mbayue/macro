import { memo } from 'react';
import { AlertTriangleIcon, ArrowRightIcon, RotateCcwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type Comparison, NOT_AVAILABLE, NOT_RUN } from '../../../../../../src/report/compare.ts';
import type { ApiError } from '../../lib/api.ts';
import { headlineCompareRows, stageCompareRows } from '../../lib/compare-view.ts';
import { fmtUtc } from '../../lib/format.ts';
import { runHref } from '../../router.ts';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';
import { ApiErrorText, TableWrap } from '../ui.tsx';

export type CompareViewError = ApiError | 'unreadable';

export interface CompareViewProps {
  a: string;
  b: string;
  loading: boolean;
  error: CompareViewError | null;
  comparison: Comparison | null;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}

const UNREADABLE_ERROR: ApiError = {
  code: 'internal',
  message: 'The comparison could not be read. Please try again.',
};

function isMutedCompareValue(text: string | null): boolean {
  return text === NOT_RUN || text === NOT_AVAILABLE || text === 'none' || text === 'not reached';
}

function CompareNavigationLinks({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button render={<a href={runHref(a)} />} nativeButton={false} variant="secondary" className="border border-bar-hover">
        Open run {a}
      </Button>
      <Button render={<a href={runHref(b)} />} nativeButton={false} variant="secondary" className="border border-bar-hover">
        Open run {b}
      </Button>
      <Button render={<a href="#/runs" />} nativeButton={false} variant="outline" className="border-bar">
        Back to Runs Table
      </Button>
    </div>
  );
}

/**
 * Reusable Run Compare presentation (`#/compare/:a/:b` and Capacity Report).
 * Handles loading, API/unreadable errors, `different_plan` notices, and full side-by-side tables.
 */
export const CompareView = memo(function CompareView({
  a,
  b,
  loading,
  error,
  comparison,
  onRetry,
  className,
}: CompareViewProps) {
  if (loading) {
    return (
      <div
        className={cn('flex flex-col gap-4', className)}
        role="status"
        aria-busy="true"
        aria-label={`Loading comparison for runs ${a} and ${b}`}
      >
        <p className="m-0 text-sm text-muted-foreground">
          Comparing runs <span className="font-mono text-xs text-foreground">{a}</span> and{' '}
          <span className="font-mono text-xs text-foreground">{b}</span>…
        </p>
        <div className="grid grid-cols-1 gap-3 min-[861px]:grid-cols-2">
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="flex animate-pulse flex-col gap-3 rounded-md border border-border bg-surface p-5 motion-reduce:animate-none"
            >
              <div className="h-3.5 w-32 rounded-sm bg-surface-2" />
              <div className="h-4 w-56 rounded-sm bg-surface-2" />
              <div className="h-3 w-40 rounded-sm bg-surface-2" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="h-12 rounded-sm bg-surface-2" />
                <div className="h-12 rounded-sm bg-surface-2" />
                <div className="h-12 rounded-sm bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex animate-pulse flex-col gap-3 rounded-md border border-border bg-surface p-5 motion-reduce:animate-none">
          <div className="h-4 w-44 rounded-sm bg-surface-2" />
          <div className="h-28 w-full rounded-sm bg-surface-2" />
        </div>
      </div>
    );
  }

  if (error !== null) {
    const resolvedError = error === 'unreadable' ? UNREADABLE_ERROR : error;
    return (
      <TelemetryPanel tone="bad" ticks="bad" role="alert" className={cn('gap-4', className)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">Comparison unavailable</Badge>
        </div>
        <ApiErrorText error={resolvedError} />
        <div className="flex flex-wrap items-center gap-2.5">
          {onRetry ? (
            <Button type="button" variant="secondary" className="border border-bar-hover" onClick={onRetry}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          ) : null}
          <CompareNavigationLinks a={a} b={b} />
        </div>
      </TelemetryPanel>
    );
  }

  if (comparison === null) {
    return (
      <TelemetryPanel ticks="bar" className={cn('gap-4', className)}>
        <p className="m-0 text-sm text-muted-foreground">No comparison data is available for these runs.</p>
        <div className="flex flex-wrap items-center gap-2.5">
          {onRetry ? (
            <Button type="button" variant="secondary" className="border border-bar-hover" onClick={onRetry}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          ) : null}
          <CompareNavigationLinks a={a} b={b} />
        </div>
      </TelemetryPanel>
    );
  }

  if (comparison.kind === 'different_plan') {
    return (
      <TelemetryPanel
        ticks="bar"
        role="status"
        aria-labelledby="compare-different-plan-heading"
        className={cn('gap-4 border-warn', className)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 shrink-0 text-warn" aria-hidden="true" />
            <h2 id="compare-different-plan-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              These runs cannot be compared
            </h2>
          </div>
          <Badge variant="warn">Different plans</Badge>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="m-0 max-w-[72ch] text-sm text-foreground">{comparison.message}</p>
          <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
            Metrics and stage breakdowns cannot be compared side by side unless both runs used the same approved Test Plan.
          </p>
        </div>
        <CompareNavigationLinks a={a} b={b} />
      </TelemetryPanel>
    );
  }

  const head = headlineCompareRows(comparison);
  const summaries = [
    { role: 'Baseline (earlier run)', tag: 'Baseline', variant: 'outline' as const, run: comparison.baseline },
    { role: 'Later run', tag: 'Later', variant: 'secondary' as const, run: comparison.later },
  ];

  return (
    <div className={cn('compare flex flex-col gap-4', className)}>
      <div className="grid grid-cols-1 gap-3 min-[861px]:grid-cols-2" role="group" aria-label="Compared runs">
        {summaries.map(({ role, tag, variant, run }) => (
          <TelemetryPanel key={`${tag}-${run.runId}`} ticks="bar" className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.8125rem] text-muted-foreground">{role}</span>
              <Badge variant={variant}>{tag}</Badge>
            </div>
            <div className="flex flex-col gap-1">
              <a
                href={runHref(run.runId)}
                className="inline-flex w-fit items-center gap-1.5 font-mono text-sm font-medium break-all text-foreground underline decoration-bar underline-offset-4 hover:text-accent-text hover:decoration-accent-text"
              >
                <span>{run.runId}</span>
                <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
              </a>
              <p className="m-0 font-mono text-xs text-muted-foreground tabular-nums">
                Started {fmtUtc(run.startedAt)}
              </p>
            </div>
            <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-0.5 bg-background px-3 py-2">
                <dt className="text-xs text-muted-foreground">Safe capacity</dt>
                <dd className="m-0 font-mono text-sm text-foreground tabular-nums">
                  {run.safeCapacityDisplay}
                  {run.safeCapacity !== null ? <span className="text-xs text-muted-foreground"> VUs</span> : null}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 bg-background px-3 py-2">
                <dt className="text-xs text-muted-foreground">Breaking point</dt>
                <dd className="m-0 font-mono text-sm text-foreground tabular-nums">
                  {run.breakingPointDisplay}
                  {run.breakingPoint !== null ? <span className="text-xs text-muted-foreground"> VUs</span> : null}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 bg-background px-3 py-2">
                <dt className="text-xs text-muted-foreground">First degraded</dt>
                <dd className="m-0 font-mono text-xs break-all text-foreground">
                  {run.firstDegradedRouteDisplay}
                </dd>
              </div>
            </dl>
          </TelemetryPanel>
        ))}
      </div>

      <TelemetryPanel ticks="bar" aria-labelledby="compare-headline-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="compare-headline-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Headline comparison
          </h2>
          <span className="text-xs text-muted-foreground">From each capacity report headline</span>
        </div>
        <TableWrap label="Headline comparison">
          <table className="data-table w-full min-w-[520px]">
            <caption className="sr-only">Headline values</caption>
            <thead>
              <tr>
                <th scope="col">Value</th>
                <th scope="col" className="num">
                  Baseline
                </th>
                <th scope="col" className="num">
                  Later
                </th>
              </tr>
            </thead>
            <tbody>
              {head.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td
                    className={cn(
                      'num font-mono tabular-nums',
                      isMutedCompareValue(r.baseline) ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {r.baseline}
                  </td>
                  <td
                    className={cn(
                      'num font-mono tabular-nums',
                      isMutedCompareValue(r.later) ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {r.later}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </TelemetryPanel>

      {comparison.stages.length === 0 ? (
        <TelemetryPanel ticks="bar">
          <p className="m-0 text-sm text-muted-foreground">Neither run has stage metrics to compare.</p>
        </TelemetryPanel>
      ) : (
        comparison.stages.map((st) => {
          const rows = stageCompareRows(st);
          return (
            <TelemetryPanel
              key={st.index}
              ticks="bar"
              aria-labelledby={`compare-stage-${st.index}-heading`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id={`compare-stage-${st.index}-heading`}
                  className="m-0 font-sans text-[1.0625rem] font-medium text-foreground"
                >
                  Stage {st.displayIndex}
                </h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {st.vus} VUs · from stage {st.displayIndex}
                </span>
              </div>
              <TableWrap label={`Stage ${st.displayIndex} comparison`}>
                <table className="data-table w-full min-w-[680px]">
                  <caption className="sr-only">
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
                    {rows.map((row, i) => {
                      const cells = [
                        row.value.baseline,
                        row.value.later,
                        row.value.difference,
                        row.value.percentChange,
                      ];
                      return (
                        <tr key={`${row.scope}-${row.metric}-${i}`}>
                          <th
                            scope="row"
                            className={cn(
                              'text-xs text-foreground',
                              row.scope === 'Overall' ? 'font-sans font-medium' : 'font-mono',
                            )}
                          >
                            {row.scope}
                          </th>
                          <td>{row.metric}</td>
                          {cells.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className={cn(
                                'num font-mono tabular-nums',
                                isMutedCompareValue(cell) ? 'text-muted-foreground' : 'text-foreground',
                              )}
                            >
                              {cell ?? ''}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </TelemetryPanel>
          );
        })
      )}
    </div>
  );
});
