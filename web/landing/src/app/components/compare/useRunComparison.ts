import { useCallback, useEffect, useState } from 'react';
import type { Comparison } from '../../../../../../src/report/compare.ts';
import { getCompare } from '../../lib/api.ts';
import { parseComparison } from '../../lib/compare-view.ts';
import type { CompareViewError } from './CompareView.tsx';

export type FetchComparisonResult =
  | { ok: true; comparison: Comparison }
  | { ok: false; error: CompareViewError };

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
  loading: boolean;
  error: CompareViewError | null;
  comparison: Comparison | null;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(pair !== null);
  const [error, setError] = useState<CompareViewError | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const a = pair?.a ?? null;
  const b = pair?.b ?? null;

  useEffect(() => {
    if (a === null || b === null) {
      setLoading(false);
      setError(null);
      setComparison(null);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setComparison(null);

    void fetchComparison(a, b, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setComparison(result.comparison);
      setLoading(false);
    });

    return () => {
      abort.abort();
    };
  }, [a, b, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { loading, error, comparison, retry };
}
