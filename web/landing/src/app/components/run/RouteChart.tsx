/**
 * p95 latency per route, one point per finished stage, against the plan's stop limit.
 * The route with the highest latest p95 is drawn in the accent; the others stay quiet.
 * Metrics only exist for finished stages, so a running stage shows no point yet.
 */
import type { StageView } from '../../../../../../src/api-types.ts';
import { fmtMs } from '../../../../../../src/run/format.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { niceScale } from '../../../../../chart.ts';
import { useWidth } from '../../hooks/useWidth.ts';

const H = 300;
const MIN_W = 560;
const M = { top: 24, right: 132, bottom: 44, left: 56 };

interface Series {
  route: string;
  points: { stage: number; p95: number }[];
}

export function RouteChart({ stages, plan, limitMs }: { stages: readonly StageView[]; plan: TestPlan | null; limitMs: number }) {
  const [box, measured] = useWidth<HTMLDivElement>(720);
  const W = Math.max(MIN_W, measured);
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

  // End labels, nudged apart so they never overlap.
  const labels = series
    .map((s) => ({ route: s.route, y: y(last(s)), lead: s === lead, x: x(s.points[s.points.length - 1]?.stage ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!;
    if (labels[i]!.y - prev.y < 16) labels[i]!.y = prev.y + 16;
  }

  return (
    <div ref={box} className="chart-box">
      <svg className="route-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="route-chart-title route-chart-desc">
        <title id="route-chart-title">p95 latency per route</title>
        <desc id="route-chart-desc">{desc}</desc>
        {maxY.ticks.map((t) => (
          <g key={t}>
            <line className="route-chart__grid" x1={M.left} x2={M.left + pw} y1={y(t)} y2={y(t)} />
            <text className="route-chart__tick" x={M.left - 10} y={y(t) + 4} textAnchor="end">
              {fmtMs(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: total }, (_, i) => (
          <text key={i} className="route-chart__tick" x={x(i)} y={H - M.bottom + 22} textAnchor="middle">
            Stage {i + 1}
          </text>
        ))}
        <line className="route-chart__limit" x1={M.left} x2={M.left + pw} y1={y(limitMs)} y2={y(limitMs)} />
        <text className="route-chart__limit-label" x={M.left + 8} y={y(limitMs) - 8}>
          stop limit {fmtMs(limitMs)} ms
        </text>
        {series
          .filter((s) => s !== lead)
          .concat(lead ? [lead] : [])
          .map((s) => {
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.stage).toFixed(1)} ${y(p.p95).toFixed(1)}`).join(' ');
            const cls = s === lead ? 'route-chart__line is-lead' : 'route-chart__line';
            return (
              <g key={s.route} className={cls}>
                <path d={d} />
                {s.points.map((p) => (
                  <circle key={p.stage} cx={x(p.stage)} cy={y(p.p95)} r={s === lead ? 4.5 : 3.5} />
                ))}
              </g>
            );
          })}
        {labels.map((l) => (
          <text key={l.route} className={l.lead ? 'route-chart__name is-lead' : 'route-chart__name'} x={l.x + 12} y={l.y + 4}>
            {l.route}
          </text>
        ))}
        {series.length === 0 ? (
          <text className="route-chart__empty" x={M.left + pw / 2} y={M.top + ph / 2} textAnchor="middle">
            Latency appears here when stage 1 finishes.
          </text>
        ) : null}
      </svg>
    </div>
  );
}
