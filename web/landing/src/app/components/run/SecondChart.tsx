/**
 * Average latency per second inside one finished stage, one line per route,
 * with the seconds that saw errors marked. The only chart fed by the per-second
 * samples (SQLite stage_samples), so a stage without samples renders nothing.
 */
import { memo } from 'react';
import type { StageView } from '../../../../../../src/api-types.ts';
import { fmtMs } from '../../../../../../src/run/format.ts';
import { LatencyLineChart, type LatencySeries } from './LatencyLineChart.tsx';

export const SecondChart = memo(function SecondChart({
  stage,
  displayIndex,
  routes = [],
}: {
  stage: StageView;
  /** 1-based stage number for the drawing and the a11y text. */
  displayIndex: number;
  routes?: readonly { id: string; path: string }[];
}) {
  const samples = stage.samples ?? [];
  const byRoute = new Map<string, { route: string; points: { x: number; y: number }[] }>();
  for (const s of samples) {
    const entry = byRoute.get(s.route) ?? { route: s.route, points: [] };
    entry.points.push({ x: s.second, y: s.avgMs });
    byRoute.set(s.route, entry);
  }
  const series: LatencySeries[] = [...byRoute.values()].map((s) => ({
    route: s.route,
    points: [...s.points].sort((a, b) => a.x - b.x),
  }));

  const seconds = samples.map((s) => s.second);
  const xMax = Math.max(1, ...seconds, stage.durationSec - 1);
  const errorSeconds = [...new Set(samples.filter((s) => s.errors > 0).map((s) => s.second))].sort((a, b) => a - b);

  const desc =
    series.length === 0
      ? `Stage ${displayIndex} has no per-second samples.`
      : `Average latency in milliseconds per second for stage ${displayIndex} (${stage.vus} VUs). ` +
        series
          .map((s) => `${s.route}: ${s.points.map((p) => `second ${p.x} ${fmtMs(p.y)} ms`).join(', ')}`)
          .join('. ') +
        (errorSeconds.length > 0
          ? `. Requests failed during these seconds: ${errorSeconds.join(', ')}.`
          : '. No request failed during the stage.') +
        '.';

  const secondTickStep = Math.max(1, Math.ceil(seconds.length > 90 ? 30 : seconds.length > 40 ? 15 : 10));
  const xTicks: { value: number; label: string }[] = [];
  for (let t = 0; t <= xMax; t += secondTickStep) xTicks.push({ value: t, label: `${t}s` });

  return (
    <LatencyLineChart
      series={series}
      height={240}
      topMargin={30}
      xPosition={(sec, pw, left) => left + (pw * sec) / xMax}
      xTicks={xTicks}
      xAxisLabel="Second of the stage"
      routes={routes}
      titleId={`second-chart-title-${displayIndex}`}
      descId={`second-chart-desc-${displayIndex}`}
      title={`Average latency per second, stage ${displayIndex}`}
      desc={desc}
      emptyText="No per-second samples were stored for this stage."
      beforePaths={({ margin, plotWidth, x }) => (
        <>
          {errorSeconds.map((sec) => (
            <g key={sec}>
              <line className="stroke-bad" strokeWidth={2} x1={x(sec)} x2={x(sec)} y1={margin.top - 8} y2={margin.top - 1} />
            </g>
          ))}
          {errorSeconds.length > 0 ? (
            <text className="fill-bad font-mono text-[11px]" x={margin.left + plotWidth} y={margin.top - 10} textAnchor="end">
              ticks: seconds with errors
            </text>
          ) : null}
        </>
      )}
    />
  );
});
