/**
 * Data loading, 3s live polling, 401/503 browser fallback, and browser-local run hydration
 * for the Runs Table (`#/runs`).
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { MeResponse } from '../../../../../src/api-types.ts';
import { mapAccountRunRow, mapBrowserRunRow, type RunsTableRow } from '../components/compare/runs-table-view.ts';
import { getRun } from '../lib/api.ts';
import { getAccountRuns } from '../lib/auth-api.ts';
import { forgetRun, loadRecentRuns } from '../lib/recent-runs.ts';

const MAX_ACCOUNT_RUNS = 50;
const POLL_INTERVAL_MS = 3000;
const ACCOUNT_LOAD_ERROR = 'Could not load your account runs from the server. Check your connection and try again.';

export interface RecentRunsDataState {
  rows: RunsTableRow[];
  source: 'account' | 'browser';
  loading: boolean;
  error: string | null;
  hasBrowserFallback: boolean;
  retry: () => void;
  showBrowserFallback: () => void;
}

export interface RecentRunsSyncSink {
  setRows: (next: RunsTableRow[] | ((prev: RunsTableRow[]) => RunsTableRow[])) => void;
  setSource: (source: 'account' | 'browser') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export interface RecentRunsTimers {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

export interface RecentRunsSyncOptions {
  mode: 'account' | 'browser';
  sink: RecentRunsSyncSink;
  timers?: RecentRunsTimers;
}

/**
 * Starts account run polling or browser-local run hydration and returns a cleanup function
 * that aborts in-flight requests and cancels any scheduled poll timer.
 */
export function startRecentRunsSync({ mode, sink, timers }: RecentRunsSyncOptions): () => void {
  const abort = new AbortController();
  const schedule = timers?.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancel = timers?.clearTimeout ?? ((id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const loadBrowser = (): void => {
    sink.setSource('browser');
    sink.setError(null);
    sink.setLoading(false);
    const local = loadRecentRuns();
    sink.setRows(local.map((r) => mapBrowserRunRow(r)));

    for (const entry of local) {
      void getRun(entry.id, abort.signal).then((res) => {
        if (abort.signal.aborted) return;
        if (res.ok) {
          const hydrated = mapBrowserRunRow(entry, res.data);
          sink.setRows((prev) => prev.map((r) => (r.runId === entry.id ? hydrated : r)));
        } else if (res.error.code === 'not_found') {
          forgetRun(entry.id);
          sink.setRows((prev) => prev.filter((r) => r.runId !== entry.id));
        } else {
          const unknown = mapBrowserRunRow(entry, null, 'unknown');
          sink.setRows((prev) => prev.map((r) => (r.runId === entry.id ? unknown : r)));
        }
      });
    }
  };

  const loadAccount = async (isPoll = false): Promise<void> => {
    sink.setSource('account');
    if (!isPoll) {
      sink.setRows([]);
      sink.setLoading(true);
      sink.setError(null);
    }
    const res = await getAccountRuns(abort.signal);
    if (abort.signal.aborted) return;
    if (!res.ok) {
      if (res.error.code === 'auth_required' || res.error.code === 'auth_unavailable') {
        loadBrowser();
        return;
      }
      sink.setLoading(false);
      sink.setError(ACCOUNT_LOAD_ERROR);
      return;
    }
    const mapped = Array.isArray(res.data.runs)
      ? res.data.runs.slice(0, MAX_ACCOUNT_RUNS).map(mapAccountRunRow)
      : [];
    sink.setRows(mapped);
    sink.setLoading(false);
    sink.setError(null);
    const hasPending = mapped.some((r) => r.status === 'queued' || r.status === 'running');
    if (hasPending) {
      timer = schedule(() => {
        if (!abort.signal.aborted) void loadAccount(true);
      }, POLL_INTERVAL_MS);
    }
  };

  if (mode === 'account') {
    void loadAccount();
  } else {
    loadBrowser();
  }

  return () => {
    abort.abort();
    if (timer !== undefined) cancel(timer);
  };
}

export type RecentRunsState =
  | { kind: 'browser'; rows: RunsTableRow[] }
  | { kind: 'account_loading'; rows: RunsTableRow[] }
  | { kind: 'account_ready'; rows: RunsTableRow[] }
  | { kind: 'account_error'; rows: RunsTableRow[]; error: string };

export type RecentRunsEvent =
  | { type: 'enter_browser'; rows: RunsTableRow[] }
  | { type: 'update_rows'; next: RunsTableRow[] | ((prev: RunsTableRow[]) => RunsTableRow[]) }
  | { type: 'account_loading' }
  | { type: 'account_ready'; rows?: RunsTableRow[] }
  | { type: 'account_error'; error: string };

export function recentRunsReducer(state: RecentRunsState, event: RecentRunsEvent): RecentRunsState {
  switch (event.type) {
    case 'enter_browser':
      return { kind: 'browser', rows: event.rows };
    case 'update_rows': {
      const rows = typeof event.next === 'function' ? event.next(state.rows) : event.next;
      return { ...state, rows };
    }
    case 'account_loading':
      return { kind: 'account_loading', rows: [] };
    case 'account_ready':
      return { kind: 'account_ready', rows: event.rows ?? state.rows };
    case 'account_error':
      return { kind: 'account_error', rows: state.rows, error: event.error };
  }
}

/**
 * Loads and polls Runs Table rows for the signed-in account, falling back cleanly to
 * browser-local runs when signed out or when auth returns 401/503.
 */
export function useRecentRunsData(me: MeResponse | null): RecentRunsDataState {
  const [reloadTick, setReloadTick] = useState(0);
  const [browserFallback, setBrowserFallback] = useState(false);

  const [state, dispatch] = useReducer(
    recentRunsReducer,
    me,
    (initialMe): RecentRunsState =>
      initialMe !== null
        ? { kind: 'account_loading', rows: [] }
        : { kind: 'browser', rows: loadRecentRuns().map((r) => mapBrowserRunRow(r)) },
  );

  useEffect(() => {
    setBrowserFallback(false);
  }, [me]);

  useEffect(() => {
    const mode = me !== null && !browserFallback ? 'account' : 'browser';
    let currentSource: 'account' | 'browser' = mode;
    const sink: RecentRunsSyncSink = {
      setSource: (next) => {
        currentSource = next;
        if (next === 'browser') {
          dispatch({ type: 'enter_browser', rows: [] });
        }
      },
      setRows: (next) => dispatch({ type: 'update_rows', next }),
      setLoading: (loading) => {
        if (currentSource === 'browser') return;
        if (loading) dispatch({ type: 'account_loading' });
        else dispatch({ type: 'account_ready' });
      },
      setError: (err) => {
        if (currentSource === 'browser') return;
        if (err !== null) dispatch({ type: 'account_error', error: err });
      },
    };
    return startRecentRunsSync({ mode, sink });
  }, [me, reloadTick, browserFallback]);

  const source: 'account' | 'browser' = state.kind === 'browser' ? 'browser' : 'account';
  const loading = state.kind === 'account_loading';
  const error = state.kind === 'account_error' ? state.error : null;

  const hasBrowserFallback = useMemo(
    () => error !== null && me !== null && !browserFallback && loadRecentRuns().length > 0,
    [error, me, browserFallback],
  );

  const retry = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  const showBrowserFallback = useCallback(() => {
    setBrowserFallback(true);
  }, []);

  return {
    rows: state.rows,
    source,
    loading,
    error,
    hasBrowserFallback,
    retry,
    showBrowserFallback,
  };
}
