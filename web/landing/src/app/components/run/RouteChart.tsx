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
import { useWidth } from '../../hooks/useWidth.ts';
import { niceScale } from '../../lib/chart.ts';

const H = 300;
const MIN_W = 320;
/** Dash patterns for the quiet routes, so each line can be told apart without colour. */
const DASHES = ['', '7 4', '2 4', '10 3 2 3', '4 3'];

interface Series {
  route: string;
  points: { stage: number; p95: number }[];
}

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
  const [box, measured] = useWidth<HTMLDivElement>(720);
  const W = Math.max(MIN_W, measured);
  const M = { top: 24, right: W < 520 ? 124 : 156, bottom: 44, left: W < 520 ? 44 : 56 };
  const total = Math.max(plan?.stages.length ?? 0, ...stages.map((s) => s.index + 1), 1);
  const done = stages.filter((s) => s.status === 'done' && s.metrics !== null);

  const byRoute = new Map<string, Series>();
  for (const s of done) {
    for (const [route, m] of Object.entries(s.metrics!.routes)) {
      if (!m) continue;
      const series = byRoute.get(route) ?? { route, points: [] };
      series.points.push({ stage: s.index, p95: m.p95 });
      byRoute.set(route, series);
    }
  }
  const series = [...byRoute.values()];
  for (const s of series) s.points.sort((a, b) => a.stage - b.stage);
  const last = (s: Series) => s.points[s.points.length - 1]?.p95 ?? 0;
  const lead = series.reduce<Series | null>((top, s) => (top === null || last(s) > last(top) ? s : top), null);

  const maxY = niceScale(Math.max(limitMs, ...series.flatMap((s) => s.points.map((p) => p.p95))) * 1.08, 4);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const x = (stage: number) => M.left + (total === 1 ? pw / 2 : (pw * stage) / (total - 1));
  const y = (v: number) => M.top + ph - (v / maxY.max) * ph;

  const desc =
    series.length === 0
      ? 'No stage has finished yet, so there is no latency to draw.'
      : `p95 latency in milliseconds per route after each finished stage. Stop limit ${fmtMs(limitMs)} ms. ` +
        series.map((s) => `${s.route}: ${s.points.map((p) => `stage ${p.stage + 1} ${fmtMs(p.p95)} ms`).join(', ')}`).join('. ') +
        '.';

  // End labels, nudged apart from the bottom up so none overlap or drop into the axis labels.
  const floor = M.top + ph - 4;
  const labels = series
    .map((s) => ({
      route: s.route,
      y: Math.min(y(last(s)) + 4, floor),
      at: y(last(s)),
      lead: s === lead,
      x: x(s.points[s.points.length - 1]?.stage ?? 0),
    }))
    .sort((a, b) => b.y - a.y);
  for (let i = 1; i < labels.length; i++) {
    const below = labels[i - 1]!;
    if (below.y - labels[i]!.y < 15) labels[i]!.y = below.y - 15;
  }

  return (
    <div ref={box} className="min-w-0">
      <svg
        className="block h-auto w-full font-sans"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="route-chart-title route-chart-desc"
      >
        <title id="route-chart-title">p95 latency per route</title>
        <desc id="route-chart-desc">{desc}</desc>
        {maxY.ticks.map((t) => (
          <g key={t}>
            <line
              className={cn(t === 0 ? 'stroke-bar' : 'stroke-border')}
              strokeWidth={1}
              x1={M.left}
              x2={M.left + pw}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="fill-muted-foreground font-mono text-[11px] tabular-nums"
              x={M.left - 10}
              y={y(t) + 4}
              textAnchor="end"
            >
              {fmtMs(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: total }, (_, i) => (
          <text
            key={i}
            className="fill-muted-foreground font-mono text-[11px] tabular-nums"
            x={x(i)}
            y={H - M.bottom + 22}
            textAnchor="middle"
          >
            {W < 520 ? i + 1 : `Stage ${i + 1}`}
          </text>
        ))}
        {W < 520 ? (
          <text
            className="fill-muted-foreground font-mono text-[11px]"
            x={M.left + pw / 2}
            y={H - 4}
            textAnchor="middle"
          >
            Stage
          </text>
        ) : null}
        <line
          className="stroke-bad"
          strokeWidth={1.5}
          strokeDasharray="6 5"
          x1={M.left}
          x2={M.left + pw}
          y1={y(limitMs)}
          y2={y(limitMs)}
        />
        <text className="fill-bad font-mono text-[11px] tabular-nums" x={M.left + 8} y={y(limitMs) - 8}>
          stop threshold {fmtMs(limitMs)} ms
        </text>
        {series
          .filter((s) => s !== lead)
          .concat(lead ? [lead] : [])
          .map((s) => {
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.stage).toFixed(1)} ${y(p.p95).toFixed(1)}`).join(' ');
            const isLead = s === lead;
            const quiet = series.filter((q) => q !== lead).indexOf(s);
            const dash = isLead ? undefined : DASHES[quiet % DASHES.length] || undefined;
            return (
              <g key={s.route}>
                <path
                  className={cn('fill-none', isLead ? 'stroke-accent-text' : 'stroke-bar')}
                  strokeWidth={isLead ? 2.5 : 1.75}
                  strokeLinejoin="round"
                  d={d}
                  strokeDasharray={dash}
                />
                {s.points.map((p) => (
                  <circle
                    key={p.stage}
                    className={cn(isLead ? 'fill-accent-text' : 'fill-bar')}
                    cx={x(p.stage)}
                    cy={y(p.p95)}
                    r={isLead ? 4 : 3}
                  />
                ))}
              </g>
            );
          })}
        {labels.map((l) => {
          // Each label carries a swatch drawn in its line's own dash pattern, and a leader to its last point.
          const quiet = series.filter((q) => q !== lead).findIndex((q) => q.route === l.route);
          const dash = l.lead ? undefined : DASHES[quiet % DASHES.length] || undefined;
          const ly = l.y - 4;
          return (
            <g key={l.route}>
              {Math.abs(ly - l.at) > 2 ? (
                <path className="fill-none stroke-bar" strokeWidth={1} d={`M${l.x + 5} ${l.at} L${l.x + 10} ${ly}`} />
              ) : null}
              <line
                className={cn(l.lead ? 'stroke-accent-text' : 'stroke-bar')}
                strokeWidth={l.lead ? 2.5 : 1.75}
                x1={l.x + 12}
                x2={l.x + 30}
                y1={ly}
                y2={ly}
                strokeDasharray={dash}
              />
              <text
                className={cn(
                  'font-mono text-[11px]',
                  l.lead ? 'fill-foreground font-medium' : 'fill-muted-foreground',
                )}
                x={l.x + 35}
                y={l.y}
              >
                {routes.find((r) => r.id === l.route)?.path ?? l.route}
              </text>
            </g>
          );
        })}
        {series.length === 0 ? (
          <text className="fill-muted-foreground font-sans text-sm" x={M.left + pw / 2} y={M.top + ph / 2} textAnchor="middle">
            Latency appears here when stage 1 finishes.
          </text>
        ) : null}
      </svg>
    </div>
  );
});
