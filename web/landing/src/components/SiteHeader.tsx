/**
 * Clean header for editorial pages without a full-bleed hero (privacy, terms, 404).
 * Not hydrated: theme.ts bindThemeToggle() wires the toggle by hand.
 */
import { ThemeToggle } from './ThemeToggle.tsx';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <header aria-label="Site" className="lp-container pt-5">
        <div className="lp-nav">
          <a href="/" className="lp-brand press">
            <span className="lp-mark rounded" aria-hidden="true">M</span>
            <span>Macro</span>
          </a>
          <div className="lp-row">
            <ThemeToggle />
            <a className="lp-btn lp-btn-ink lp-btn-compact" href="/app/">
              Open Studio
            </a>
          </div>
        </div>
      </header>
    </>
  );
}
