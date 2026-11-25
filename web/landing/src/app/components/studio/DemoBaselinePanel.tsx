import type { DemoTrendsResponse } from '../../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { TelemetryPanel } from './TelemetryFrame.tsx';

export interface DemoBaselinePanelProps {
  demoTrends: DemoTrendsResponse | null;
}

/** 30-day observed Demo Target route latency and error baseline panel. */
export function DemoBaselinePanel({ demoTrends }: DemoBaselinePanelProps) {
  if (!demoTrends?.available || demoTrends.routes.length === 0) {
    return null;
  }

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="demo-baseline-heading">
      <div className="flex flex-col gap-1">
        <h2
          id="demo-baseline-heading"
          className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground"
        >
          30-day demo baseline
        </h2>
        <p className="text-sm text-muted-foreground">
          Observed across public demo runs over the last 30 days.
        </p>
      </div>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
        {demoTrends.routes.slice(0, 6).map((r) => {
          const errPct = typeof r.errorRatePct === 'number' ? r.errorRatePct.toFixed(1) : '0.0';
          const health = r.status ?? 'steady';
          return (
            <div key={r.route} className="contents">
              <dt className="font-mono text-muted-foreground">{r.route}</dt>
              <dd className="m-0 flex flex-wrap items-center justify-end gap-2 font-mono text-foreground tabular-nums">
                <span>
                  {r.avgMs !== null ? `${Math.round(r.avgMs)} ms` : 'n/a'} · {errPct}% err
                </span>
                <Badge variant={health === 'degraded' ? 'destructive' : health === 'spiky' ? 'warn' : 'ok'}>
                  {health}
                </Badge>
              </dd>
            </div>
          );
        })}
      </dl>
    </TelemetryPanel>
  );
}
