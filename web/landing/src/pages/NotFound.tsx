import { Footer, Nav } from '../components/Chrome.tsx';

const APP_DESTINATIONS = [
  { href: '/app/#/probe', label: 'Containment probe', path: '/app/#/probe', note: 'Verify sandbox isolation with 5 live checks' },
  { href: '/app/#/runs', label: 'Recent runs', path: '/app/#/runs', note: 'Reopen your saved or browser-local reports' },
  { href: '/app/#/sign-in', label: 'Sign in', path: '/app/#/sign-in', note: 'Verify your own site and keep runs private' },
] as const;

export function NotFoundPage() {
  return (
    <>
      <Nav home={false} />
      <main className="not-found wrap" id="top">
        <section className="not-found__copy">
          <p className="not-found__code">HTTP 404 · ROUTE NOT FOUND</p>
          <h1>Nothing lives at this URL</h1>
          <p className="not-found__lead">
            The link may be mistyped or moved. Jump straight back into the load tester or return to the overview.
          </p>
          <div className="not-found__actions">
            <a className="btn" href="/app/">
              Open Macro
            </a>
            <a className="btn btn--quiet" href="/">
              Back to home
            </a>
          </div>
        </section>

        <aside className="not-found__card" aria-label="Other places in Macro">
          <div className="not-found__hero" aria-hidden="true">
            <span className="not-found__num">404</span>
            <span className="not-found__tag">Try one of these</span>
          </div>
          <ul className="not-found__routes">
            {APP_DESTINATIONS.map((r) => (
              <li key={r.href}>
                <a className="not-found__route" href={r.href}>
                  <span className="not-found__route-label">{r.label}</span>
                  <span className="not-found__route-path">{r.path}</span>
                  <span className="not-found__route-note">{r.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </main>
      <Footer />
    </>
  );
}
