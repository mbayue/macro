import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Comparison } from '../../../../../../src/report/compare.ts';
import { getCompare } from '../../lib/api.ts';
import { parseComparison } from '../../lib/compare-view.ts';
import type { CompareViewError } from './CompareView.tsx';

export type FetchComparisonResult =
  | { ok: true; comparison: Comparison }
  | { ok: false; error: CompareViewError };

export type RunComparisonState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; comparison: Comparison }
  | { kind: 'error'; error: CompareViewError };

export type RunComparisonEvent =
  | { type: 'reset' }
  | { type: 'load' }
  | { type: 'succeed'; comparison: Comparison }
  | { type: 'fail'; error: CompareViewError };

export function runComparisonReducer(
  state: RunComparisonState,
  event: RunComparisonEvent,
): RunComparisonState {
  switch (event.type) {
    case 'reset':
      return { kind: 'idle' };
    case 'load':
      return { kind: 'loading' };
    case 'succeed':
      return state.kind === 'loading' ? { kind: 'ready', comparison: event.comparison } : state;
    case 'fail':
      return state.kind === 'loading' ? { kind: 'error', error: event.error } : state;
  }
}

/** Fetches `/api/compare?a=...&b=...` and parses it into a validated `Comparison` or `CompareViewError`. */
export async function fetchComparison(
  a: string,
  b: string,
  signal?: AbortSignal,
): Promise<FetchComparisonResult> {
  const res = await getCompare(a, b, signal);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  const parsed = parseComparison(res.data);
  if (parsed === null) {
    return { ok: false, error: 'unreadable' };
  }
  return { ok: true, comparison: parsed };
}

/** Shared stateful Run Compare loader used by both `#/compare/:a/:b` and in-report `RunsPanel`. */
export function useRunComparison(pair: { a: string; b: string } | null): {
  state: RunComparisonState;
  loading: boolean;
  error: CompareViewError | null;
  comparison: Comparison | null;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, dispatch] = useReducer(
    runComparisonReducer,
    pair !== null ? { kind: 'loading' } : { kind: 'idle' },
  );

  const a = pair?.a ?? null;
  const b = pair?.b ?? null;

  useEffect(() => {
    if (a === null || b === null) {
      dispatch({ type: 'reset' });
      return;
    }

    const abort = new AbortController();
    dispatch({ type: 'load' });

    void fetchComparison(a, b, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (!result.ok) {
        dispatch({ type: 'fail', error: result.error });
        return;
      }
      dispatch({ type: 'succeed', comparison: result.comparison });
    });

    return () => {
      abort.abort();
    };
  }, [a, b, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return {
    state,
    loading: state.kind === 'loading',
    error: state.kind === 'error' ? state.error : null,
    comparison: state.kind === 'ready' ? state.comparison : null,
    retry,
  };
}
