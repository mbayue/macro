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
 * The 404 page: a filled card (stage band strip, the code, the headline, the way back) beside three
 * filled shortcut tiles into /app/. Prerendered and not hydrated, like the legal pages.
 */
export function NotFoundPage() {
  return (
    <>
      <SiteHeader />
      <main id="top" className="grid gap-3 px-3 split:min-h-[calc(100svh-100px)] split:grid-cols-2">
        <section className="flex flex-col rounded bg-surface p-3.5 split:p-5" aria-labelledby="not-found-title">
          <StageBand size="strip" upTo={1} />
          <div className="flex flex-1 flex-col justify-center px-1 py-12 split:px-3 split:py-16">
            <p className="font-display text-[clamp(88px,14vw,200px)] leading-[0.85] font-light tracking-[-0.05em] text-accent-text" aria-hidden="true">
              404
            </p>
            <h1
              id="not-found-title"
              className="mt-8 max-w-[12ch] animate-rise text-(length:--step-head) motion-reduce:animate-fade"
            >
              Nothing lives at this URL
            </h1>
            <p className="mt-5 max-w-[36ch] animate-rise text-(length:--step-lead) leading-[1.45] text-muted [animation-delay:75ms] motion-reduce:animate-fade">
              The link may be mistyped or moved. Jump straight back into the load tester or return to the overview.
            </p>
            <div className="mt-9 flex animate-rise flex-wrap items-center gap-x-7 gap-y-3 [animation-delay:150ms] motion-reduce:animate-fade">
              <a className="site-btn" href="/app/">
                Open Macro
              </a>
              <a className="press inline-flex min-h-11 items-center text-[17px] no-underline pointer-fine:hover:underline" href="/">
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
                  className="flex h-full min-h-32 flex-col justify-end gap-2 rounded bg-surface p-5 no-underline transition-transform duration-150 active:scale-[0.99] split:p-7 pointer-fine:hover:bg-surface-2"
                >
                  <span className="flex items-center gap-3 font-display text-[clamp(28px,3vw,44px)] leading-none font-light tracking-[-0.03em]">
                    <StageBand size="bullet" className="shrink-0" />
                    {s.label}
                  </span>
                  <span className="text-(length:--step-small) text-muted">{s.note}</span>
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
