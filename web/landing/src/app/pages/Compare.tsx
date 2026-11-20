import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import type { Comparison } from '../../../../../src/report/compare.ts';
import { Button } from '@/components/ui/button';
import { CompareView, type CompareViewError } from '../components/compare/CompareView.tsx';
import { getCompare } from '../lib/api.ts';
import { parseComparison } from '../lib/compare-view.ts';

/** Run Compare screen (`#/compare/:a/:b`): fetches `/api/compare` and delegates rendering to `CompareView`. */
export function ComparePage({ a, b }: { a: string; b: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CompareViewError | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setComparison(null);

    void getCompare(a, b, abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      const parsed = parseComparison(res.data);
      if (parsed === null) {
        setError('unreadable');
        setLoading(false);
        return;
      }
      setComparison(parsed);
      setLoading(false);
    });

    return () => {
      abort.abort();
    };
  }, [a, b, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div className="page">
      <header className="flex flex-col justify-between gap-4 min-[861px]:flex-row min-[861px]:items-end">
        <div className="page__head">
          <h1 className="page__title">Run Compare</h1>
          <p className="page__lead">
            Side-by-side capacity report comparison for runs{' '}
            <span className="font-mono text-xs text-foreground">{a}</span> and{' '}
            <span className="font-mono text-xs text-foreground">{b}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button render={<a href="#/runs" />} nativeButton={false} variant="outline" className="border-bar">
            <ArrowLeftIcon data-icon="inline-start" />
            Runs Table
          </Button>
        </div>
      </header>

      <CompareView
        a={a}
        b={b}
        loading={loading}
        error={error}
        comparison={comparison}
        onRetry={retry}
      />
    </div>
  );
}
