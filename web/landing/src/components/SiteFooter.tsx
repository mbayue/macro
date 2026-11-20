/**
 * The footer shared by the landing pages: MACRO built from five blocks of rising height (the last in
 * the accent, like the stage band's last segment), the footer links, and the photo credits.
 * The letters hang from the top of their blocks and are sized from the mark's own height and width
 * (container units), so even the shortest block holds its whole letter at every width.
 */
import { SANOK_AUTHOR, SANOK_LICENCE, SANOK_PHOTOS } from '../sanok.ts';

const BLOCK_HEIGHT = ['h-1/2', 'h-[62%]', 'h-3/4', 'h-[87%]', 'h-full'] as const;

const LINKS = [
  { href: '/app/', label: 'Live demo' },
  { href: 'https://github.com/mbayue/macro', label: 'GitHub' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: 'mailto:hello@macro.my.id', label: 'hello@macro.my.id' },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-[clamp(120px,14vw,200px)] px-3 pb-8">
      <p
        className="m-0 flex h-[max(22svh,160px)] items-end gap-1 [container-type:size] split:h-[max(34svh,220px)]"
        aria-label="Macro"
        role="img"
      >
        {'MACRO'.split('').map((letter, i) => (
          <span
            key={i}
            aria-hidden="true"
            data-reveal
            data-i={String(i)}
            className={`${BLOCK_HEIGHT[i]} flex flex-1 justify-center overflow-hidden rounded pt-[0.06em] font-display text-[min(44cqh,21cqw)] leading-none font-light ${
              i === 4 ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-bg'
            }`}
          >
            {letter}
          </span>
        ))}
      </p>
      <div className="mt-12 flex flex-wrap justify-between gap-x-8 gap-y-4 text-[15px]">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="press inline-flex min-h-11 items-center pointer-fine:hover:text-accent-text">
              {l.label}
            </a>
          ))}
        </nav>
        <p className="max-w-[60ch] text-muted">
          Photographs of the Sanok bridge load test by {SANOK_AUTHOR}:{' '}
          {SANOK_PHOTOS.map((p, i) => (
            <span key={p.name}>
              <a href={p.source}>{p.label}</a>
              {i < SANOK_PHOTOS.length - 1 ? ', ' : '; '}
            </span>
          ))}
          <a href={SANOK_LICENCE.url}>{SANOK_LICENCE.name}</a>, via Wikimedia Commons. 2026 Macro.
        </p>
      </div>
    </footer>
  );
}
