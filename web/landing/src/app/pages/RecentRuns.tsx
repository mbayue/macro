/**
 * Runs Table (`#/runs`): signed-in account runs (up to 50) when available; otherwise browser-local runs (up to 10).
 * Filterable by kind, status, and search query, with two-row selection for Run Compare.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { GitCompareIcon, RotateCcwIcon, SearchIcon, XIcon } from 'lucide-react';
import type { AccountRunsResponse } from '../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  canComparePickedRuns,
  compareSelectionHint,
  filterRunsRows,
  formatCapacityCell,
  getPickedComparePair,
  KIND_FILTER_OPTIONS,
  mapAccountRunRow,
  mapBrowserRunRow,
  prunePickedRuns,
  type RunsTableRow,
  STATUS_FILTER_OPTIONS,
  togglePickedRun,
} from '../components/compare/runs-table-view.ts';
import { StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { StatusBadge, TableWrap } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { getRun } from '../lib/api.ts';
import { forgetRun, loadRecentRuns } from '../lib/recent-runs.ts';
import { compareHref, DEFAULT_RUNS_SEARCH, probeHref, runHref, type RunsSearch } from '../router.ts';

const MAX_ACCOUNT_RUNS = 50;
const runsRouteApi = getRouteApi('/runs');

function isoOrUndefined(ms: number): string | undefined {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function RecentRunsPage() {
  const { config, me, navigate } = useApp();
  const searchInputId = useId();
  const [reloadTick, setReloadTick] = useState(0);
  const [browserFallback, setBrowserFallback] = useState(false);

  const [rows, setRows] = useState<RunsTableRow[]>(() =>
    me !== null ? [] : loadRecentRuns().map((r) => mapBrowserRunRow(r)),
  );
  const [source, setSource] = useState<'account' | 'browser'>(() => (me !== null ? 'account' : 'browser'));
  const [loading, setLoading] = useState<boolean>(() => me !== null);
  const [error, setError] = useState<string | null>(null);

  // Filters live in the URL (`?type=&status=&q=`) so back, reload and shared links keep them.
  const search = runsRouteApi.useSearch();
  const navigateRuns = runsRouteApi.useNavigate();
  const kindFilter = search.type;
  const statusFilter = search.status;
  const updateSearch = useCallback(
    (patch: Partial<RunsSearch>) => {
      void navigateRuns({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigateRuns],
  );
  // The box keeps its own state so typing never waits on the router; URL changes made elsewhere
  // (back, forward, a pasted link) flow back in.
  const [searchQuery, setSearchQueryState] = useState(search.q);
  const lastWrittenQuery = useRef(search.q);
  useEffect(() => {
    if (search.q === lastWrittenQuery.current) return;
    lastWrittenQuery.current = search.q;
    setSearchQueryState(search.q);
  }, [search.q]);
  const setSearchQuery = useCallback(
    (q: string) => {
      setSearchQueryState(q);
      lastWrittenQuery.current = q;
      updateSearch({ q });
    },
    [updateSearch],
  );
  const setKindFilter = (type: RunsSearch['type']) => updateSearch({ type });
  const setStatusFilter = (status: RunsSearch['status']) => updateSearch({ status });
  const deferredQuery = useDeferredValue(searchQuery);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    setBrowserFallback(false);
  }, [me]);

  useEffect(() => {
    const abort = new AbortController();
    let timer: number | undefined;

    const loadBrowser = () => {
      setSource('browser');
      setError(null);
      setLoading(false);
      const local = loadRecentRuns();
      const initial = local.map((r) => mapBrowserRunRow(r));
      setRows(initial);
      setPicked((prev) => prunePickedRuns(initial, prev));

      for (const entry of local) {
        void getRun(entry.id, abort.signal).then((res) => {
          if (abort.signal.aborted) return;
          if (res.ok) {
            const hydrated = mapBrowserRunRow(entry, res.data);
            setRows((prev) => prev.map((r) => (r.runId === entry.id ? hydrated : r)));
          } else if (res.error.code === 'not_found') {
            forgetRun(entry.id);
            setRows((prev) => {
              const next = prev.filter((r) => r.runId !== entry.id);
              setPicked((p) => prunePickedRuns(next, p));
              return next;
            });
          } else {
            const unknown = mapBrowserRunRow(entry, null, 'unknown');
            setRows((prev) => prev.map((r) => (r.runId === entry.id ? unknown : r)));
          }
        });
      }
    };

    const loadAccount = async (isPoll = false): Promise<void> => {
      setSource('account');
      if (!isPoll) {
        setRows([]);
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch('/api/account/runs', { credentials: 'same-origin', signal: abort.signal });
        if (abort.signal.aborted) return;
        if (res.status === 401 || res.status === 503) {
          loadBrowser();
          return;
        }
        if (!res.ok) {
          setLoading(false);
          setError('Could not load your account runs from the server. Check your connection and try again.');
          return;
        }
        const body = (await res.json()) as AccountRunsResponse;
        if (abort.signal.aborted) return;
        const mapped = Array.isArray(body.runs)
          ? body.runs.slice(0, MAX_ACCOUNT_RUNS).map(mapAccountRunRow)
          : [];
        setRows(mapped);
        setPicked((prev) => prunePickedRuns(mapped, prev));
        setLoading(false);
        setError(null);
        const hasPending = mapped.some((r) => r.status === 'queued' || r.status === 'running');
        if (hasPending) {
          timer = window.setTimeout(() => {
            if (!abort.signal.aborted) void loadAccount(true);
          }, 3000);
        }
      } catch {
        if (abort.signal.aborted) return;
        setLoading(false);
        setError('Could not reach the server to load your account runs. Check your connection and try again.');
      }
    };

    if (me !== null && !browserFallback) {
      void loadAccount();
    } else {
      loadBrowser();
    }

    return () => {
      abort.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [me, reloadTick, browserFallback]);

  const visibleRows = useMemo(
    () =>
      filterRunsRows(rows, {
        kind: kindFilter,
        status: statusFilter,
        query: deferredQuery,
      }),
    [rows, kindFilter, statusFilter, deferredQuery],
  );

  const hasActiveFilters = kindFilter !== 'all' || statusFilter !== 'all' || searchQuery.trim() !== '';

  const clearFilters = useCallback(() => {
    setSearchQueryState('');
    lastWrittenQuery.current = '';
    updateSearch(DEFAULT_RUNS_SEARCH);
  }, [updateSearch]);

  const onToggleRow = useCallback((runId: string, on: boolean) => {
    setPicked((prev) => togglePickedRun(prev, runId, on));
  }, []);

  const canCompare = useMemo(() => canComparePickedRuns(rows, picked), [rows, picked]);
  const comparePair = useMemo(() => getPickedComparePair(rows, picked), [rows, picked]);
  const selectionHint = useMemo(() => compareSelectionHint(rows, picked), [rows, picked]);

  const onCompare = useCallback(() => {
    if (!comparePair) return;
    navigate(compareHref(comparePair.a, comparePair.b).replace(/^#/, ''));
  }, [comparePair, navigate]);

  const hasBrowserFallback = useMemo(
    () => error !== null && me !== null && !browserFallback && loadRecentRuns().length > 0,
    [error, me, browserFallback],
  );

  return (
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-5">
      <header className="flex flex-col justify-between gap-3 min-[861px]:flex-row min-[861px]:items-end">
        <div className="grid gap-1.5">
          <StageBand />
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Runs Table
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {source === 'account' ? 'Signed in · up to 50 runs' : 'Browser local · up to 10 runs'}
          </Badge>
          <Button render={<a href="#/" />} nativeButton={false} size="sm">
            + New test
          </Button>
        </div>
      </header>

      {loading ? (
        <TelemetryPanel ticks="bar" role="status" aria-busy="true" aria-label="Loading runs">
          <p className="m-0 text-sm text-muted-foreground">Loading your account runs…</p>
          <div className="flex animate-pulse flex-col gap-2.5 motion-reduce:animate-none">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="h-10 w-full rounded-sm bg-surface-2" />
            ))}
          </div>
        </TelemetryPanel>
      ) : error !== null ? (
        <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">Could not load runs</Badge>
          </div>
          <p className="m-0 text-sm text-foreground">{error}</p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="button" variant="secondary" onClick={() => setReloadTick((t) => t + 1)}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
            {hasBrowserFallback ? (
              <Button
                type="button"
                variant="outline"
                className="border-bar"
                onClick={() => setBrowserFallback(true)}
              >
                Show browser recent runs
              </Button>
            ) : null}
          </div>
        </TelemetryPanel>
      ) : rows.length === 0 ? (
        <TelemetryPanel ticks="bar" className="gap-4">
          <p className="m-0 max-w-[64ch] text-sm text-foreground">
            {source === 'account'
              ? 'No account runs yet. Draft a plan and approve it, or claim demo runs from this browser after sign-in.'
              : 'No runs yet. Every run you start or open appears here, so you can get back to it.'}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button render={<a href="#/" />} nativeButton={false}>
              Start a new test
            </Button>
            {config.sampleRunId ? (
              <Button render={<a href={runHref(config.sampleRunId)} />} nativeButton={false} variant="secondary">
                View sample report
              </Button>
            ) : null}
            <Button
              render={<a href="#/probe" />}
              nativeButton={false}
              variant="outline"
              className="border-bar"
            >
              Run the containment probe
            </Button>
          </div>
        </TelemetryPanel>
      ) : (
        <>
          <TelemetryPanel ticks="bar" aria-label="Filter and search runs" className="gap-4">
            <div className="flex flex-col gap-3 min-[1020px]:flex-row min-[1020px]:items-center min-[1020px]:justify-between">
              <div className="relative flex w-full max-w-md items-center">
                <label htmlFor={searchInputId} className="sr-only">
                  Search runs by name or ID
                </label>
                <SearchIcon
                  className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id={searchInputId}
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by plan name or run ID…"
                  className="h-10 w-full rounded-md border border-bar bg-background pr-9 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring"
                />
                {searchQuery !== '' ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {visibleRows.length} of {rows.length} {rows.length === 1 ? 'run' : 'runs'}
                </span>
                {hasActiveFilters ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-bar"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6 lg:gap-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter runs by kind">
                <span className="mr-1 text-xs text-muted-foreground">Type</span>
                {KIND_FILTER_OPTIONS.map((opt) => {
                  const active = kindFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKindFilter(opt.value)}
                      className={cn(
                        'min-h-9 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring max-[860px]:min-h-10',
                        active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-bar bg-background text-foreground hover:border-bar-hover',
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter runs by status">
                <span className="mr-1 text-xs text-muted-foreground">Status</span>
                {STATUS_FILTER_OPTIONS.map((opt) => {
                  const active = statusFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(opt.value)}
                      className={cn(
                        'min-h-9 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring max-[860px]:min-h-10',
                        active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-bar bg-background text-foreground hover:border-bar-hover',
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </TelemetryPanel>

          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 sm:px-6"
            role="region"
            aria-label="Run Compare selection"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant={canCompare ? 'default' : 'secondary'}
                disabled={!canCompare}
                onClick={onCompare}
              >
                <GitCompareIcon data-icon="inline-start" />
                Compare selected runs
              </Button>
              {picked.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-bar"
                  onClick={() => setPicked([])}
                >
                  Clear selection
                </Button>
              ) : null}
              <p className="m-0 text-xs text-muted-foreground" aria-live="polite">
                {selectionHint}
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {picked.length}/2 selected
            </span>
          </div>

          {visibleRows.length === 0 ? (
            <TelemetryPanel ticks="bar" className="gap-3">
              <p className="m-0 text-sm text-foreground">No runs match your current filters.</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            </TelemetryPanel>
          ) : (
            <TelemetryPanel ticks="bar" aria-label="Runs Table results">
              <TableWrap label="Runs Table">
                <table className="data-table w-full min-w-[900px]">
                  <caption className="sr-only">
                    {source === 'account' ? 'Account runs' : 'Browser recent runs'}
                  </caption>
                  <colgroup>
                    <col className="w-11" />
                    <col className="w-[26%]" />
                    <col className="w-[20%]" />
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
                      <th scope="col">Run</th>
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
                    {visibleRows.map((row) => {
                      const selected = picked.includes(row.runId);
                      const checkboxDisabled = picked.length >= 2 && !selected;
                      const href = row.kind === 'probe' ? probeHref(row.runId) : runHref(row.runId);

                      return (
                        <tr key={row.runId} className={cn(selected && 'bg-surface-2')}>
                          <td className="align-middle">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={checkboxDisabled}
                              aria-label={`Select run ${row.runId}`}
                              onChange={(e) => onToggleRow(row.runId, e.target.checked)}
                              className="size-[18px] cursor-pointer rounded-sm align-middle accent-[var(--accent-text)] focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45"
                            />
                          </td>
                          <th scope="row" className="min-w-56">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <a
                                href={href}
                                className="min-w-0 font-medium wrap-anywhere text-foreground underline decoration-bar underline-offset-4 hover:text-accent-text hover:decoration-accent-text"
                              >
                                {row.title}
                              </a>
                              {row.kind === 'probe' ? <Badge variant="outline">Probe</Badge> : null}
                            </div>
                          </th>
                          <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                            {row.runId}
                          </td>
                          <td className="idx font-mono text-xs whitespace-nowrap text-foreground tabular-nums">
                            <time dateTime={isoOrUndefined(row.startedAt)} title={row.startedUtc}>
                              {row.startedUtcLabel}
                            </time>
                          </td>
                          <td>
                            {row.status === 'checking' ? (
                              <Badge variant="outline">checking</Badge>
                            ) : row.status === 'unknown' ? (
                              <Badge variant="outline">status unknown</Badge>
                            ) : (
                              <StatusBadge status={row.status} />
                            )}
                          </td>
                          <td className="num font-mono text-xs text-foreground tabular-nums">
                            {formatCapacityCell('safeCapacity', row.safeCapacity, row.hasReport)}
                          </td>
                          <td className="num font-mono text-xs text-foreground tabular-nums">
                            {formatCapacityCell('breakingPoint', row.breakingPoint, row.hasReport)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </TelemetryPanel>
          )}
        </>
      )}
    </div>
  );
}
