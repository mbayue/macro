/**
 * p95 latency per route, one point per finished stage, against the plan's stop limit.
 * The route with the highest latest p95 is drawn in the accent; the others stay quiet.
 * Metrics only exist for finished stages, so a running stage shows no point yet.
 */
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { StageView } from '../../../../../../src/api-types.ts';
import { fmtMs } from '../../../../../../src/run/format.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { groupLatencySeries, LatencyLineChart } from './LatencyLineChart.tsx';

export const RouteChart = memo(function RouteChart({
  stages,
  plan,
  limitMs,
  routes = [],
}: {
  stages: readonly StageView[];
  plan: TestPlan | null;
  limitMs: number;
  routes?: readonly { id: string; path: string }[];
}) {
  const total = Math.max(plan?.stages.length ?? 0, ...stages.map((s) => s.index + 1), 1);
  const done = stages.filter((s) => s.status === 'done' && s.metrics !== null);

  const stageRoutePoints = done.flatMap((s) =>
    Object.entries(s.metrics!.routes).map(([route, m]) => (m ? { route, x: s.index, y: m.p95 } : null)),
  );
  const series = groupLatencySeries(stageRoutePoints, (pt) => pt);

  const desc =
    series.length === 0
      ? 'No stage has finished yet, so there is no latency to draw.'
      : `p95 latency in milliseconds per route after each finished stage. Stop limit ${fmtMs(limitMs)} ms. ` +
        series.map((s) => `${s.route}: ${s.points.map((p) => `stage ${p.x + 1} ${fmtMs(p.y)} ms`).join(', ')}`).join('. ') +
        '.';

  const xTicks = Array.from({ length: total }, (_, i) => ({
    value: i,
    label: `Stage ${i + 1}`,
    compactLabel: String(i + 1),
  }));

  return (
    <LatencyLineChart
      series={series}
      height={300}
      topMargin={24}
      yFloor={limitMs}
      xPosition={(stage, pw, left) => left + (total === 1 ? pw / 2 : (pw * stage) / (total - 1))}
      xTicks={xTicks}
      xAxisLabel="Stage"
      routes={routes}
      titleId="route-chart-title"
      descId="route-chart-desc"
      title="p95 latency per route"
      desc={desc}
      emptyText="Latency appears here when stage 1 finishes."
      beforePaths={({ margin, plotWidth, y }) => (
        <>
          <line
            className="stroke-bad"
            strokeWidth={1.5}
            strokeDasharray="6 5"
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={y(limitMs)}
            y2={y(limitMs)}
          />
          <text className="fill-bad font-mono text-[11px] tabular-nums" x={margin.left + 8} y={y(limitMs) - 8}>
            stop threshold {fmtMs(limitMs)} ms
          </text>
        </>
      )}
      renderPoints={({ series: s, isLead, layout }) =>
        s.points.map((p) => (
          <circle
            key={p.x}
            className={cn(isLead ? 'fill-accent-text' : 'fill-bar')}
            cx={layout.x(p.x)}
            cy={layout.y(p.y)}
            r={isLead ? 4 : 3}
          />
        ))
      }
    />
  );
});
