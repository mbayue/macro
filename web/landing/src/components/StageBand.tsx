/**
 * The stage band, the page's one ornament: four segments sized 1 : 2 : 4 : 8 like the four Stages
 * (25, 50, 100, 200 users) with 4 px gaps. Segments up to and including the Stage index `upTo` (0 to 3,
 * 0 = first Stage only) take the accent, the rest the surface tone. Decorative only (aria-hidden); say the Stage in text nearby.
 *
 * Sizes: `strip` (the hero card's top strip), `track` (slider track, run fragment progress) and
 * `bullet` (a miniature for list bullets). Inside a `data-ui` product fragment, pass `tone="ui"` for
 * the fragment's fixed dark colours.
 */
export type StageBandSize = 'strip' | 'track' | 'bullet';

const HEIGHT: Record<StageBandSize, string> = {
  strip: 'h-10 split:h-14',
  track: 'h-3.5',
  bullet: 'h-2 w-3.5',
};

const SEGMENT = ['flex-[1_1_0]', 'flex-[2_1_0]', 'flex-[4_1_0]', 'flex-[8_1_0]'] as const;

export function StageBand({
  upTo = 3,
  size = 'track',
  tone = 'page',
  className = '',
}: {
  upTo?: number;
  size?: StageBandSize;
  tone?: 'page' | 'ui';
  className?: string;
}) {
  const off = tone === 'ui' ? 'bg-ui-line' : 'bg-surface-2';
  const gap = size === 'bullet' ? 'gap-px' : 'gap-1';
  return (
    <span className={`flex ${gap} ${size === 'bullet' ? '' : 'w-full'} ${HEIGHT[size]} ${className}`} aria-hidden="true">
      {SEGMENT.map((flex, i) => (
        <span
          key={flex}
          className={`block h-full rounded-[2px] transition-colors duration-[240ms] ${flex} ${i <= upTo ? 'bg-accent' : off}`}
        />
      ))}
    </span>
  );
}
