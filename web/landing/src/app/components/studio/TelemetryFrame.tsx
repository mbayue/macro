import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type TickTone = 'bar' | 'accent' | 'ink' | 'bad';

const TICK_TONE_CLASS: Record<TickTone, string> = {
  bar: 'border-bar',
  accent: 'border-accent-text',
  ink: 'border-primary-foreground/60',
  bad: 'border-bad',
};

/** Hairline 1px L-shaped corner ticks for key telemetry frames. */
export function CornerTicks({ tone = 'bar' }: { tone?: TickTone }) {
  const borderClass = TICK_TONE_CLASS[tone];
  return (
    <span className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      <span className={cn('absolute top-0 left-0 size-2 rounded-tl-[5px] border-t border-l', borderClass)} />
      <span className={cn('absolute top-0 right-0 size-2 rounded-tr-[5px] border-t border-r', borderClass)} />
      <span className={cn('absolute bottom-0 left-0 size-2 rounded-bl-[5px] border-b border-l', borderClass)} />
      <span className={cn('absolute right-0 bottom-0 size-2 rounded-br-[5px] border-r border-b', borderClass)} />
    </span>
  );
}

/** Flat telemetry surface container with 1px hairline border and optional corner ticks. */
export function TelemetryPanel({
  children,
  className,
  ticks,
  tone = 'default',
  ...props
}: React.ComponentProps<'section'> & {
  ticks?: TickTone | undefined;
  tone?: 'default' | 'bad' | 'live' | undefined;
}) {
  return (
    <section
      className={cn(
        'relative flex min-w-0 flex-col gap-3.5 rounded-md border p-5 sm:p-6',
        tone === 'live'
          ? 'border-transparent bg-primary text-primary-foreground'
          : tone === 'bad'
            ? 'border-bad bg-surface text-foreground'
            : 'border-[var(--ap-line-strong)] bg-surface text-foreground',
        className,
      )}
      {...props}
    >
      {ticks && ticks !== 'bar' ? <CornerTicks tone={ticks} /> : null}
      {children}
    </section>
  );
}

/** Compact 4-segment `1 : 2 : 4 : 8` stage band motif anchored above primary screen headings. */
export function StageBand({ className }: { className?: string }) {
  return (
    <div className={cn('stage-band', className)} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

/** Flush 92px Bayer-dithered banner strip with frosted mono caption bar inside a `TelemetryPanel`. */
export function DitherBanner({
  src,
  label,
  meta,
  className,
}: {
  src: string;
  label: string;
  meta?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'relative -mx-5 -mt-5 mb-1 h-[92px] overflow-hidden rounded-t-[5px] border-b border-border sm:-mx-6 sm:-mt-6 print:hidden',
        className,
      )}
    >
      <img className="dither-banner-img" src={src} width={1920} height={1280} alt="" aria-hidden="true" />
      <div className="dither-banner-caption absolute right-3 bottom-2.5 left-3 flex items-center justify-between gap-2 rounded-sm px-2.5 py-1 font-mono text-[11px] text-foreground">
        <span className="truncate">{label}</span>
        {meta ? <strong className="shrink-0 font-medium">{meta}</strong> : null}
      </div>
    </div>
  );
}
