/**
 * App shell: skip link, side rail (top bar plus menu on phones), main region and the polite
 * live region. The rail's recent list comes from this browser's storage only.
 */
import { type ReactNode, useContext, useEffect, useId, useState } from 'react';
import { postSignOut } from '../lib/auth-api.ts';
import { loadRecentRuns, type RecentRun } from '../lib/recent-runs.ts';
import { ThemeToggle } from '../../components/Chrome.tsx';
import { AppContext } from '../context.tsx';
import { probeHref, type Route, runHref } from '../router.ts';

const RECENT_IN_RAIL = 4;

function currentKey(route: Route): string {
  if (route.view === 'run' || route.view === 'probe') return `${route.view}:${route.id}`;
  return route.view;
}

export function Shell({
  route,
  live,
  mainRef,
  children,
}: {
  route: Route;
  live: string;
  mainRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  // Shell renders during boot before AppContext exists; identity is optional then.
  const ctx = useContext(AppContext);
  const me = ctx?.me ?? null;
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const railId = useId();
  const key = currentKey(route);

  async function onSignOut() {
    if (!ctx) return;
    await postSignOut();
    await ctx.refreshMe();
    ctx.announce('Signed out.');
    ctx.navigate('/');
  }

  // Refresh the recent list and close the phone menu on every navigation.
  useEffect(() => {
    setRecent(loadRecentRuns().slice(0, RECENT_IN_RAIL));
    setOpen(false);
  }, [key]);

  const item = (href: string, label: ReactNode, active: boolean) => (
    <li key={href}>
      <a href={href} className={active ? 'rail__link is-current' : 'rail__link'} aria-current={active ? 'page' : undefined}>
        {label}
      </a>
    </li>
  );

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // A bare "#main" would change the hash route.
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <header className="topbar">
        <a className="wordmark" href="#/">
          Macro
        </a>
        <button
          type="button"
          className="topbar__menu"
          aria-expanded={open}
          aria-controls={railId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close menu' : 'Menu'}
        </button>
      </header>

      <nav id={railId} className={open ? 'rail is-open' : 'rail'} aria-label="App">
        <a className="wordmark rail__brand" href="#/">
          Macro
        </a>
        <a className={route.view === 'new' ? 'btn rail__new is-current' : 'btn rail__new'} href="#/" aria-current={route.view === 'new' ? 'page' : undefined}>
          New test
        </a>
        <ul className="rail__list">
          {item('#/runs', 'Recent runs', route.view === 'runs')}
          {item('#/probe', 'Containment probe', route.view === 'probe-start' || route.view === 'probe')}
        </ul>

        {recent.length > 0 ? (
          <div className="rail__recent">
            <h2 className="rail__heading">{me !== null ? 'Your runs' : 'In this browser'}</h2>
            <ul className="rail__list">
              {recent.map((r) => {
                const active = key === `${r.kind}:${r.id}`;
                return item(
                  r.kind === 'probe' ? probeHref(r.id) : runHref(r.id),
                  <>
                    <span className="rail__name">{r.kind === 'probe' ? 'Containment probe' : r.name}</span>
                    <span className="rail__id">{r.id.slice(0, 8)}</span>
                  </>,
                  active,
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="rail__foot">
          <div className="rail__identity">
            {me === null ? (
              <a
                className="rail__link rail__identity-link"
                href="#/sign-in"
                aria-current={route.view === 'sign-in' ? 'page' : undefined}
              >
                Sign in
              </a>
            ) : (
              <>
                <div className="rail__identity-row">
                  <p className="rail__identity-name">{me.user.githubLogin ?? me.user.email}</p>
                  <button type="button" className="rail__identity-out" onClick={() => void onSignOut()}>
                    Sign out
                  </button>
                </div>
                <p className="rail__identity-site muted">
                  {me.verifiedOrigin !== null ? me.verifiedOrigin.host : 'none'}
                </p>
              </>
            )}
          </div>
          <ThemeToggle />
          <ul className="rail__links">
            <li>
              <a href="/">About Macro</a>
            </li>
            <li>
              <a href="/privacy">Privacy</a>
            </li>
            <li>
              <a href="/terms">Terms</a>
            </li>
          </ul>
        </div>
      </nav>

      <main id="main" className="main" ref={mainRef} tabIndex={-1}>
        {children}
        <footer className="app-foot">
          <p>
            {me?.verifiedOrigin
              ? `You can load-test ${me.verifiedOrigin.host} (verified) or the public demo shop.`
              : 'Demo shop tests work signed out. Own-site tests need a signed-in account and a verified origin.'}
          </p>
        </footer>
      </main>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {live}
      </div>
    </div>
  );
}
