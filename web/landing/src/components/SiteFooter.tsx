/**
 * Compact single-row footer shared by the home, privacy, terms, and 404 pages.
 * Credits all four Sanok bridge load-test photographs (Marsilar, CC BY-SA 4.0, Wikimedia Commons).
 */
import { SANOK_AUTHOR, SANOK_LICENCE, SANOK_PHOTOS } from '../sanok.ts';

const LINKS = [
  { href: '/app/', label: 'Test Studio' },
  { href: 'https://github.com/mbayue/macro', label: 'GitHub', external: true },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: 'mailto:hello@macro.my.id', label: 'hello@macro.my.id' },
] as const;

export function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-row">
        <div className="lp-row">
          <span className="lp-mark rounded" aria-hidden="true">M</span>
          <span>Macro. Load tests that stay contained.</span>
        </div>
        <div className="lp-row">
          <nav aria-label="Footer" className="lp-row">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="press inline-flex min-h-11 items-center pointer-fine:hover:text-accent-text"
                {...('external' in l && l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <p className="text-muted">
            Sanok bridge photos ({SANOK_PHOTOS.map((p, i) => (
              <span key={p.name}>
                {i > 0 ? ', ' : ''}
                <a href={p.source} target="_blank" rel="noopener noreferrer">{p.label}</a>
              </span>
            ))}) by {SANOK_AUTHOR},{' '}
            <a href={SANOK_LICENCE.url} target="_blank" rel="noopener noreferrer">{SANOK_LICENCE.name}</a>, via Wikimedia Commons. 2026 Macro.
          </p>
        </div>
      </div>
    </footer>
  );
}
