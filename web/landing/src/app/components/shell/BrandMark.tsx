import { cn } from '@/lib/utils';

/**
 * Monochrome Macro monogram mark shared by the permanent dark rail (`surface="rail"`)
 * and themed headers/sheets (`surface="default"`), leaving `+ New test` as the single spring-green accent.
 */
export function BrandMark({ surface = 'default' }: { surface?: 'default' | 'rail' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid size-7 shrink-0 place-items-center rounded-md font-display text-[0.9375rem] leading-none font-semibold',
        surface === 'rail'
          ? 'border border-white/18 bg-white/12 text-rail-ink'
          : 'bg-foreground text-background',
      )}
    >
      M
    </span>
  );
}
