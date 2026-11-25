import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmtMs } from '../../../../../../src/run/format.ts';
import { useWidth } from '../../hooks/useWidth.ts';
import { layoutRouteEndLabels, niceScale, routeDash } from '../../lib/chart.ts';
import { RouteEndLabels } from './RouteEndLabels.tsx';

const MIN_W = 320;

export interface LatencySeriesPoint {
  x: number;
  y: number;
}

export interface LatencySeries {
  route: string;
  points: readonly LatencySeriesPoint[];
}

export interface LatencyXTick {
  value: number;
  label: string;
  compactLabel?: string;
}

export interface LatencyChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LatencyChartLayout {
  width: number;
  height: number;
  compact: boolean;
  margin: LatencyChartMargin;
  plotWidth: number;
  plotHeight: number;
  x: (value: number) => number;
  y: (value: number) => number;
}

export interface LatencyPointRenderArgs {
  series: LatencySeries;
  isLead: boolean;
  layout: LatencyChartLayout;
}

export interface LatencyLineChartProps {
  series: readonly LatencySeries[];
  height: number;
  topMargin?: number;
  yFloor?: number;
  xPosition: (value: number, plotWidth: number, marginLeft: number) => number;
  xTicks: readonly LatencyXTick[];
  xAxisLabel?: string;
  routes?: readonly { id: string; path: string }[];
  titleId: string;
  descId: string;
  title: string;
  desc: string;
  emptyText: string;
  beforePaths?: (layout: LatencyChartLayout) => ReactNode;
  afterPaths?: (layout: LatencyChartLayout) => ReactNode;
  renderPoints?: (args: LatencyPointRenderArgs) => ReactNode;
}

/**
 * Shared responsive SVG latency line chart primitive for Run charts.
 * Owns width measurement, layout margins, niceScale Y-axis gridlines and ticks,
 * lead vs quiet series partitioning, dashed strokes, end labels, a11y metadata, and empty state.
 */
export function LatencyLineChart({
  series,
  height,
  topMargin = 24,
  yFloor = 1,
  xPosition,
  xTicks,
  xAxisLabel,
  routes = [],
  titleId,
  descId,
  title,
  desc,
  emptyText,
  beforePaths,
  afterPaths,
  renderPoints,
}: LatencyLineChartProps) {
  const [box, measured] = useWidth<HTMLDivElement>(720);
  const width = Math.max(MIN_W, measured);
  const compact = width < 520;
  const margin: LatencyChartMargin = {
    top: topMargin,
    right: compact ? 124 : 156,
    bottom: 44,
    left: compact ? 44 : 56,
  };

  const sortedSeries: LatencySeries[] = series.map((s) => ({
    route: s.route,
    points: [...s.points].sort((a, b) => a.x - b.x),
  }));
  const lastY = (s: LatencySeries) => s.points[s.points.length - 1]?.y ?? 0;
  const lead = sortedSeries.reduce<LatencySeries | null>(
    (top, s) => (top === null || lastY(s) > lastY(top) ? s : top),
    null,
  );
  const quietSeries = sortedSeries.filter((s) => s !== lead);

  const maxY = niceScale(
    Math.max(yFloor, ...sortedSeries.flatMap((s) => s.points.map((p) => p.y))) * 1.08,
    4,
  );
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (value: number) => xPosition(value, plotWidth, margin.left);
  const y = (value: number) => margin.top + plotHeight - (value / maxY.max) * plotHeight;
  const layout: LatencyChartLayout = {
    width,
    height,
    compact,
    margin,
    plotWidth,
    plotHeight,
    x,
    y,
  };

  const labels = layoutRouteEndLabels(
    sortedSeries.map((s) => {
      const tip = s.points[s.points.length - 1] ?? { x: 0, y: 0 };
      return {
        route: s.route,
        x: x(tip.x),
        at: y(tip.y),
        lead: s === lead,
        dash: routeDash(quietSeries.indexOf(s), s === lead),
      };
    }),
    margin.top + plotHeight - 4,
  );

  return (
    <div ref={box} className="min-w-0">
      <svg
        className="block h-auto w-full font-sans"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        {maxY.ticks.map((t) => (
          <g key={t}>
            <line
              className={cn(t === 0 ? 'stroke-bar' : 'stroke-border')}
              strokeWidth={1}
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="fill-muted-foreground font-mono text-[11px] tabular-nums"
              x={margin.left - 10}
              y={y(t) + 4}
              textAnchor="end"
            >
              {fmtMs(t)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={tick.value}
            className="fill-muted-foreground font-mono text-[11px] tabular-nums"
            x={x(tick.value)}
            y={height - margin.bottom + 22}
            textAnchor="middle"
          >
            {compact && tick.compactLabel !== undefined ? tick.compactLabel : tick.label}
          </text>
        ))}
        {compact && xAxisLabel ? (
          <text
            className="fill-muted-foreground font-mono text-[11px]"
            x={margin.left + plotWidth / 2}
            y={height - 4}
            textAnchor="middle"
          >
            {xAxisLabel}
          </text>
        ) : null}
        {beforePaths?.(layout)}
        {quietSeries.concat(lead ? [lead] : []).map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');
          const isLead = s === lead;
          const dash = routeDash(quietSeries.indexOf(s), isLead);
          return (
            <g key={s.route}>
              <path
                className={cn('fill-none', isLead ? 'stroke-accent-text' : 'stroke-bar')}
                strokeWidth={isLead ? 2.5 : 1.75}
                strokeLinejoin="round"
                d={d}
                strokeDasharray={dash}
              />
              {renderPoints?.({ series: s, isLead, layout })}
            </g>
          );
        })}
        {afterPaths?.(layout)}
        <RouteEndLabels labels={labels} routes={routes} />
        {sortedSeries.length === 0 ? (
          <text
            className="fill-muted-foreground font-sans text-sm"
            x={margin.left + plotWidth / 2}
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
          >
            {emptyText}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
