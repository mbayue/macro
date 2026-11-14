/**
 * Average latency per second inside one finished stage, one line per route,
 * with the seconds that saw errors marked. The only chart fed by the per-second
 * samples (SQLite stage_samples), so a stage without samples renders nothing.
 */
import type { StageView } from '../../../../../../src/api-types.ts';
import { fmtMs } from '../../../../../../src/run/format.ts';
import { niceScale } from '../../lib/chart.ts';
import { useWidth } from '../../hooks/useWidth.ts';

const H = 240;
const MIN_W = 320;
/** Dash patterns for the quiet routes, so each line can be told apart without colour. */
const DASHES = ['', '7 4', '2 4', '10 3 2 3', '4 3'];

interface Series {
  route: string;
  points: { second: number; avgMs: number }[];
}

export function SecondChart({
  stage,
  displayIndex,
  routes = [],
}: {
  stage: StageView;
  /** 1-based stage number for the drawing and the a11y text. */
  displayIndex: number;
  routes?: readonly { id: string; path: string }[];
}) {
  const [box, measured] = useWidth<HTMLDivElement>(720);
  const W = Math.max(MIN_W, measured);
  const M = { top: 30, right: W < 520 ? 124 : 156, bottom: 44, left: W < 520 ? 44 : 56 };

  const samples = stage.samples ?? [];
  const byRoute = new Map<string, Series>();
  for (const s of samples) {
    const series = byRoute.get(s.route) ?? { route: s.route, points: [] };
    series.points.push({ second: s.second, avgMs: s.avgMs });
    byRoute.set(s.route, series);
  }
  const series = [...byRoute.values()];
  for (const s of series) s.points.sort((a, b) => a.second - b.second);
  const lead = series.reduce<Series | null>((top, s) => {
    if (top === null) return s;
    return lastOf(s).avgMs > lastOf(top).avgMs ? s : top;
  }, null);

  const seconds = samples.map((s) => s.second);
  const xMax = Math.max(1, ...seconds, stage.durationSec - 1);
  const maxY = niceScale(Math.max(...series.flatMap((s) => s.points.map((p) => p.avgMs)), 1) * 1.08, 4);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const x = (sec: number) => M.left + (pw * sec) / xMax;
  const y = (v: number) => M.top + ph - (v / maxY.max) * ph;

  const errorSeconds = [...new Set(samples.filter((s) => s.errors > 0).map((s) => s.second))].sort((a, b) => a - b);
  const desc =
    series.length === 0
      ? `Stage ${displayIndex} has no per-second samples.`
      : `Average latency in milliseconds per second for stage ${displayIndex} (${stage.vus} VUs). ` +
        series
          .map((s) => `${s.route}: ${s.points.map((p) => `second ${p.second} ${fmtMs(p.avgMs)} ms`).join(', ')}`)
          .join('. ') +
        (errorSeconds.length > 0
          ? `. Requests failed during these seconds: ${errorSeconds.join(', ')}.`
          : '. No request failed during the stage.') +
        '.';

  // End labels, nudged apart from the bottom up so none overlap or drop into the axis labels.
  const floor = M.top + ph - 4;
  const labels = series
    .map((s) => ({
      route: s.route,
      at: y(lastOf(s).avgMs),
      y: Math.min(y(lastOf(s).avgMs) + 4, floor),
      lead: s === lead,
      x: x(lastOf(s).second),
    }))
    .sort((a, b) => b.y - a.y);
  for (let i = 1; i < labels.length; i++) {
    const below = labels[i - 1]!;
    if (below.y - labels[i]!.y < 15) labels[i]!.y = below.y - 15;
  }

  const secondTickStep = Math.max(1, Math.ceil(seconds.length > 90 ? 30 : seconds.length > 40 ? 15 : 10));
  const ticks: number[] = [];
  for (let t = 0; t <= xMax; t += secondTickStep) ticks.push(t);

  return (
    <div ref={box} className="chart-box">
      <svg
        className="second-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={`second-chart-title-${displayIndex} second-chart-desc-${displayIndex}`}
      >
        <title id={`second-chart-title-${displayIndex}`}>Average latency per second, stage {displayIndex}</title>
        <desc id={`second-chart-desc-${displayIndex}`}>{desc}</desc>
        {maxY.ticks.map((t) => (
          <g key={t}>
            <line className="second-chart__grid" x1={M.left} x2={M.left + pw} y1={y(t)} y2={y(t)} />
            <text className="second-chart__tick" x={M.left - 10} y={y(t) + 4} textAnchor="end">
              {fmtMs(t)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} className="second-chart__tick" x={x(t)} y={H - M.bottom + 22} textAnchor="middle">
            {t}s
          </text>
        ))}
        {W < 520 ? (
          <text className="second-chart__tick" x={M.left + pw / 2} y={H - 4} textAnchor="middle">
            Second of the stage
          </text>
        ) : null}
        {errorSeconds.map((sec) => (
          <g key={sec} className="second-chart__burst">
            <line x1={x(sec)} x2={x(sec)} y1={M.top - 8} y2={M.top - 1} />
          </g>
        ))}
        {errorSeconds.length > 0 ? (
          <text className="second-chart__tick" x={M.left + pw} y={M.top - 10} textAnchor="end">
            ticks: seconds with errors
          </text>
        ) : null}
        {series
          .filter((s) => s !== lead)
          .concat(lead ? [lead] : [])
          .map((s) => {
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.second).toFixed(1)} ${y(p.avgMs).toFixed(1)}`).join(' ');
            const cls = s === lead ? 'second-chart__line is-lead' : 'second-chart__line';
            const quiet = series.filter((q) => q !== lead).indexOf(s);
            const dash = s === lead ? undefined : DASHES[quiet % DASHES.length] || undefined;
            return (
              <g key={s.route} className={cls}>
                <path d={d} strokeDasharray={dash} />
              </g>
            );
          })}
        {labels.map((l) => {
          const quiet = series.filter((q) => q !== lead).findIndex((q) => q.route === l.route);
          const dash = l.lead ? undefined : DASHES[quiet % DASHES.length] || undefined;
          const ly = l.y - 4;
          return (
            <g key={l.route} className={l.lead ? 'second-chart__label is-lead' : 'second-chart__label'}>
              {Math.abs(ly - l.at) > 2 ? (
                <path className="second-chart__leader" d={`M${l.x + 5} ${l.at} L${l.x + 10} ${ly}`} />
              ) : null}
              <line className="second-chart__swatch" x1={l.x + 12} x2={l.x + 30} y1={ly} y2={ly} strokeDasharray={dash} />
              <text className={l.lead ? 'second-chart__name is-lead' : 'second-chart__name'} x={l.x + 35} y={l.y}>
                {routes.find((r) => r.id === l.route)?.path ?? l.route}
              </text>
            </g>
          );
        })}
        {series.length === 0 ? (
          <text className="second-chart__empty" x={M.left + pw / 2} y={M.top + ph / 2} textAnchor="middle">
            No per-second samples were stored for this stage.
          </text>
        ) : null}
      </svg>
    </div>
  );
}

const lastOf = (s: Series): { second: number; avgMs: number } => s.points[s.points.length - 1] ?? { second: 0, avgMs: 0 };
