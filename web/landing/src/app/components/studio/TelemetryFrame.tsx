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
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
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
        'relative flex min-w-0 flex-col gap-3.5 rounded-md border p-5 sm:px-6',
        tone === 'live'
          ? 'border-transparent bg-primary text-primary-foreground'
          : tone === 'bad'
            ? 'border-bad bg-surface text-foreground'
            : 'border-border bg-surface text-foreground',
        className,
      )}
      {...props}
    >
      {ticks ? <CornerTicks tone={ticks} /> : null}
      {children}
    </section>
  );
}
