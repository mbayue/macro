import { cn } from '@/lib/utils';
import type { RouteEndLabel } from '../../lib/chart.ts';

/** Right-hand SVG leader lines, dash swatches, and route labels shared by multi-route charts. */
export function RouteEndLabels({
  labels,
  routes,
}: {
  labels: readonly RouteEndLabel[];
  routes: readonly { id: string; path: string }[];
}) {
  return (
    <>
      {labels.map((l) => {
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
              strokeDasharray={l.dash}
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
    </>
  );
}
