import { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { CornerTicks } from '../studio/TelemetryFrame.tsx';
import type { KpiStripItem } from './report-tabs.ts';

/** Progress through the running stage along the foot of the spring-green tile, updated via CSSOM. */
function TileProgress({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.style.setProperty('--p', String(value));
  }, [value]);
  return (
    <span className="absolute right-5 bottom-3 left-5 h-1.5 overflow-hidden rounded-sm bg-primary-foreground/20" aria-hidden="true">
      <span
        ref={ref}
        className="block h-full w-[calc(var(--p,0)*100%)] bg-primary-foreground transition-[width] duration-900 ease-linear motion-reduce:transition-none"
      />
    </span>
  );
}

const VALUE_TONE_CLASS: Record<KpiStripItem['tone'], string> = {
  live: 'text-accent-text',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-foreground',
};

/** Full-size four-tile live board / report headline shown on Overview. */
export function SignatureTiles({
  items,
  reportMode,
  ref,
}: {
  items: readonly KpiStripItem[];
  reportMode: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 min-[1180px]:grid-cols-4"
      role="group"
      aria-label={reportMode ? 'Headline values' : 'Live numbers'}
    >
      {items.map((item) => {
        const isLive = item.tone === 'live';
        const isHeroSafe = reportMode && item.id === 'stage-or-safe' && item.value.length <= 9;
        const isLongText = item.value.length > 9;
        const fullSub = item.unit ? `${item.unit}, ${item.sourceNote}` : item.sourceNote;

        return (
          <div
            key={item.id}
            className={cn(
              'relative flex min-h-[116px] min-w-0 flex-col justify-start gap-1.5 overflow-hidden rounded-md p-4 sm:p-5 min-[861px]:min-h-[136px] min-[861px]:pb-6',
              isLive
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-surface text-foreground',
            )}
          >
            <CornerTicks tone={isLive ? 'ink' : item.tone === 'bad' ? 'bad' : 'bar'} />
            <span className={cn('text-[0.8125rem]', isLive ? 'text-accent-ink-soft' : 'text-muted-foreground')}>
              {item.label}
            </span>
            <span
              className={cn(
                'font-display leading-none font-light break-words tabular-nums',
                isHeroSafe
                  ? 'text-[clamp(3rem,2.4rem+2.2vw,5rem)] tracking-[-0.04em]'
                  : isLongText
                    ? 'text-[1.375rem] leading-[1.1] tracking-[-0.015em] min-[861px]:text-[1.75rem]'
                    : 'text-[2.125rem] tracking-[-0.03em] min-[861px]:text-[2.75rem]',
                isLive ? 'text-primary-foreground' : VALUE_TONE_CLASS[item.tone],
              )}
            >
              {item.value}
            </span>
            <span
              className={cn(
                'font-mono text-xs leading-snug tabular-nums',
                isLive ? 'text-accent-ink-soft' : 'text-muted-foreground',
              )}
            >
              {fullSub}
            </span>
            {item.progress !== undefined ? <TileProgress value={item.progress} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function compactStripSource(sourceNote: string): string {
  const stageMatch = /\bfrom stage \d+\b/i.exec(sourceNote);
  if (stageMatch) return stageMatch[0].toLowerCase();
  if (sourceNote.includes('after stage 1 ends')) return 'after stage 1 ends';
  if (sourceNote.startsWith('no stage stayed')) return 'no stage passed';
  if (sourceNote.startsWith('every stage stayed')) return 'within thresholds';
  if (sourceNote.startsWith('no single route')) return 'within limits';
  return sourceNote;
}

/** Sticky one-line KPI strip shown above tabs when Overview tiles scroll out of view or on non-Overview tabs. */
export const KpiStrip = memo(function KpiStrip({ items }: { items: readonly KpiStripItem[] }) {
  return (
    <section
      aria-label="Key metrics summary"
      className="relative rounded-md border border-bar bg-surface text-foreground"
    >
      <CornerTicks tone="bar" />
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 min-[1180px]:flex min-[1180px]:divide-x min-[1180px]:divide-y-0">
        {items.map((item, idx) => {
          const isLive = item.tone === 'live';
          const readout = item.unit ? `${item.value} ${item.unit}` : item.value;
          const compactSource = compactStripSource(item.sourceNote);
          return (
            <div
              key={item.id}
              className={cn(
                'flex min-w-0 flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5 px-2 py-2 min-[1180px]:flex-auto min-[1180px]:flex-nowrap',
                idx % 2 === 1 && 'sm:border-l sm:border-border min-[1180px]:border-l-0',
                idx >= 2 && 'sm:border-t sm:border-border min-[1180px]:border-t-0',
                isLive && 'border-l-2 border-l-accent-text',
              )}
            >
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={item.label}>
                {item.label}
              </span>
              <span className="inline-flex shrink-0 flex-wrap items-baseline gap-x-1.5 font-mono tabular-nums">
                <span className={cn('text-xs font-medium', VALUE_TONE_CLASS[item.tone])}>
                  {readout}
                </span>
                <span className="text-[11px] text-muted-foreground" title={item.sourceNote}>
                  {compactSource}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
});
