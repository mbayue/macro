import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompareView } from '../components/compare/CompareView.tsx';
import { useRunComparison } from '../components/compare/useRunComparison.ts';

/** Run Compare screen (`#/compare/:a/:b`): fetches `/api/compare` and delegates rendering to `CompareView`. */
export function ComparePage({ a, b }: { a: string; b: string }) {
  const { loading, error, comparison, retry } = useRunComparison({ a, b });

  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6">
      <header className="flex flex-col justify-between gap-4 min-[861px]:flex-row min-[861px]:items-end">
        <div className="grid gap-2">
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Run Compare
          </h1>
          <p className="m-0 max-w-[64ch] text-muted-foreground">
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
