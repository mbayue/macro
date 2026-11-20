/**
 * The small header for the pages without a hero card (privacy, terms, 404): the wordmark as the home
 * link, the theme toggle and the one action. A filled bar inside the 12 px page margin, like the
 * hero card. These pages are not hydrated: theme.ts bindThemeToggle() wires the toggle by hand.
 */
import { ThemeToggle } from './Chrome.tsx';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <header aria-label="Site" className="p-3">
        <div className="flex items-center justify-between gap-3 rounded bg-surface py-2 pr-2 pl-4 split:pl-5">
          <a href="/" className="inline-flex min-h-11 items-center font-display text-[28px] leading-none font-light tracking-[-0.04em] no-underline split:text-[32px]">
            Macro
          </a>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a className="site-btn" href="/app/">
              Try the live demo
            </a>
          </div>
        </div>
      </header>
    </>
  );
}
