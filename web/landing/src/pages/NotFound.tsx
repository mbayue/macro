import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { StageBand } from '../components/StageBand.tsx';

/** Shortcuts into the app, named as in GLOSSARY.md and the app's own navigation. */
const SHORTCUTS = [
  { href: '/app/#/probe', label: 'Containment Probe', note: 'Verify sandbox isolation with 5 live checks' },
  { href: '/app/#/runs', label: 'Runs Table', note: 'Reopen your saved or browser-local reports' },
  { href: '/app/#/sign-in', label: 'Sign in', note: 'Verify your own site and keep runs private' },
] as const;

/**
 * The 404 page: a framed telemetry card beside three shortcut tiles into /app/.
 * Prerendered and not hydrated, like the legal pages.
 */
export function NotFoundPage() {
  return (
    <>
      <SiteHeader />
      <main id="top" className="lp-container lp-sec-tight grid gap-4 split:grid-cols-2">
        <section className="lp-legal-card flex flex-col justify-between p-6 split:p-8" aria-labelledby="not-found-title">
          <div className="lp-stage-band" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <div className="py-10 split:py-14">
            <p className="lp-mono text-[clamp(4rem,10vw,8rem)] leading-[0.9] font-semibold tracking-[-0.04em] text-accent-text" aria-hidden="true">
              404
            </p>
            <h1
              id="not-found-title"
              className="lp-h2 mt-6 max-w-[14ch] animate-rise motion-reduce:animate-fade"
            >
              Nothing lives at this URL
            </h1>
            <p className="lp-lead mt-4 animate-rise [animation-delay:75ms] motion-reduce:animate-fade">
              The link may be mistyped or moved. Jump straight back into the load tester or return to the overview.
            </p>
            <div className="mt-8 flex animate-rise flex-wrap items-center gap-3 [animation-delay:150ms] motion-reduce:animate-fade">
              <a className="lp-btn lp-btn-primary" href="/app/">
                Open Macro
              </a>
              <a className="lp-btn lp-btn-secondary" href="/">
                Back to home
              </a>
            </div>
          </div>
        </section>

        <nav aria-label="Other places in Macro">
          <ul className="m-0 grid h-full list-none gap-3 p-0 split:grid-rows-3">
            {SHORTCUTS.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  className="lp-legal-card flex h-full min-h-32 flex-col justify-end gap-2 p-6 no-underline transition-colors duration-150 active:scale-[0.99] pointer-fine:hover:bg-surface-2"
                >
                  <span className="flex items-center gap-3 font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-tight font-semibold tracking-[-0.03em]">
                    <StageBand size="bullet" className="shrink-0" />
                    {s.label}
                  </span>
                  <span className="text-[0.875rem] text-muted">{s.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
