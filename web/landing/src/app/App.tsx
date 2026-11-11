/**
 * App root: loads /api/config once, then renders the screen for the hash route.
 * On every navigation after the first: scroll to the top, focus main, announce the title.
 */
import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getConfig } from './lib/api.ts';
import { claimRecentBrowserRuns, getMe } from './lib/auth-api.ts';
import type { ConfigResponse, MeResponse } from '../../../../src/api-types.ts';
import { Shell } from './components/Shell.tsx';
import { PageSkeleton } from './components/ui.tsx';
import { AppContext, type AppContextValue } from './context.tsx';
import { NewTest } from './pages/NewTest.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { ProbePage } from './pages/Probe.tsx';
import { ProbeStart } from './pages/ProbeStart.tsx';
import { RecentRunsPage } from './pages/RecentRuns.tsx';
import { RunPage } from './pages/Run.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { parseRoute, type Route, routeTitle } from './router.ts';

type Boot = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; config: ConfigResponse };

/** A screen that throws while rendering shows a message instead of an empty page. */
class ScreenBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  override state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  override render() {
    if (this.state.failed) {
      return (
        <section className="page">
          <h1 className="page__title">Something went wrong</h1>
          <div className="alert" role="alert">
            <p>This page failed to load. Reload the page to try again.</p>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

function routeKey(route: Route): string {
  return route.view === 'run' || route.view === 'probe' ? `${route.view}:${route.id}` : route.view;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  // Bumped when navigate() targets the current hash, so the screen remounts like a fresh visit.
  const [visit, setVisit] = useState(0);
  const [live, setLive] = useState('');
  const [me, setMe] = useState<MeResponse | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const announceTimer = useRef<number | undefined>(undefined);
  const first = useRef(true);
  const claimedForUser = useRef<string | null>(null);

  const refreshMe = useCallback(async () => {
    const res = await getMe();
    if (!res.ok) return;
    setMe(res.data);
    if (res.data !== null && claimedForUser.current !== res.data.user.id) {
      claimedForUser.current = res.data.user.id;
      void claimRecentBrowserRuns();
    }
    if (res.data === null) claimedForUser.current = null;
  }, []);

  const load = useCallback(async () => {
    setBoot({ kind: 'loading' });
    const res = await getConfig();
    setBoot(res.ok ? { kind: 'ready', config: res.data } : { kind: 'error' });
    if (res.ok) void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const announce = useCallback((message: string) => {
    setLive('');
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setLive(message), 50);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.replace(/^#/, '');
    const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`;
    if (window.location.hash === target) {
      setRoute(parseRoute(target));
      setVisit((v) => v + 1);
    } else {
      window.location.hash = target;
    }
  }, []);

  const key = `${routeKey(route)}#${visit}`;

  useEffect(() => {
    document.title = routeTitle(route);
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
    announce(document.title);
  }, [key, route, announce]);

  const ctx = useMemo<AppContextValue | null>(
    () => (boot.kind === 'ready' ? { config: boot.config, me, refreshMe, navigate, announce } : null),
    [boot, me, refreshMe, navigate, announce],
  );

  let screen: ReactNode;
  if (boot.kind === 'loading') {
    screen = <PageSkeleton title="Loading Macro workspace…" />;
  } else if (boot.kind === 'error' || !ctx) {
    screen = (
      <section className="page">
        <h1 className="page__title">Something went wrong</h1>
        <div className="alert" role="alert">
          <p>Macro could not load its settings from the server. Check your connection and try again.</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--quiet" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </section>
    );
  } else {
    switch (route.view) {
      case 'new':
        screen = <NewTest key={key} />;
        break;
      case 'run':
        screen = <RunPage key={key} id={route.id} />;
        break;
      case 'probe':
        screen = <ProbePage key={key} id={route.id} />;
        break;
      case 'probe-start':
        screen = <ProbeStart key={key} />;
        break;
      case 'runs':
        screen = <RecentRunsPage key={key} />;
        break;
      case 'sign-in':
        screen = <SignIn key={key} />;
        break;
      default:
        screen = <NotFound />;
    }
  }

  const body = (
    <Shell route={route} live={live} mainRef={mainRef}>
      <ScreenBoundary resetKey={key}>{screen}</ScreenBoundary>
    </Shell>
  );
  return ctx ? <AppContext.Provider value={ctx}>{body}</AppContext.Provider> : body;
}
