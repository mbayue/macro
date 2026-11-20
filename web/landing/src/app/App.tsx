/**
 * App root: loads /api/config once, then renders the TanStack Router screen inside Shell.
 * On every navigation after the first: scroll to the top, focus main, announce the title.
 */
import { Component, Fragment, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, RouterProvider, useRouter, useRouterState } from '@tanstack/react-router';
import { RotateCcwIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ConfigResponse, MeResponse } from '../../../../src/api-types.ts';
import { getConfig } from './lib/api.ts';
import { claimRecentBrowserRuns, getMe } from './lib/auth-api.ts';
import { Shell } from './components/Shell.tsx';
import { TelemetryPanel } from './components/studio/TelemetryFrame.tsx';
import { PageSkeleton } from './components/ui.tsx';
import { AppContext, type AppContextValue } from './context.tsx';
import { createAppRouter, resolveRouterRoute, type Route, routeKey, routeTitle } from './router.ts';

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
        <section className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6">
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Something went wrong
          </h1>
          <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-3 bg-card">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">Screen error</Badge>
            </div>
            <p className="m-0 text-sm text-foreground">This page failed to load. Reload the page to try again.</p>
          </TelemetryPanel>
        </section>
      );
    }
    return this.props.children;
  }
}

function isSplitRoute(route: Route): boolean {
  return route.view === 'new' || route.view === 'run' || route.view === 'probe' || route.view === 'probe-start';
}

function RoutePendingFallback() {
  return <PageSkeleton title="Loading Macro workspace…" />;
}

function RootLayout() {
  const router = useRouter();
  const route = useRouterState({
    select: resolveRouterRoute,
    structuralSharing: true,
  });
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  // Bumped when navigate() targets the current route, so the screen remounts like a fresh visit.
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

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  const announce = useCallback((message: string) => {
    setLive('');
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setLive(message), 50);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      const clean = path.replace(/^#/, '');
      const href = clean.startsWith('/') ? clean : `/${clean}`;
      const currentHref = router.latestLocation.href;
      if (currentHref === href || (href === '/' && currentHref === '' && router.latestLocation.pathname === '/')) {
        setVisit((v) => v + 1);
        return;
      }
      void router.navigate({ href });
    },
    [router],
  );

  const key = `${routeKey(route)}#${visit}`;
  const title = routeTitle(route);

  useEffect(() => {
    document.title = title;
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
    announce(title);
  }, [key, title, announce]);

  const ctx = useMemo<AppContextValue | null>(
    () => (boot.kind === 'ready' ? { config: boot.config, me, refreshMe, navigate, announce } : null),
    [boot, me, refreshMe, navigate, announce],
  );

  let screen: ReactNode;
  if (boot.kind === 'loading') {
    screen = <PageSkeleton title="Loading Macro workspace…" showSplit={isSplitRoute(route)} />;
  } else if (boot.kind === 'error' || !ctx) {
    screen = (
      <section className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6">
        <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
          Something went wrong
        </h1>
        <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-4 bg-card">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">Connection error</Badge>
          </div>
          <p className="m-0 text-sm text-foreground">
            Macro could not load its settings from the server. Check your connection and try again.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void load()}>
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          </div>
        </TelemetryPanel>
      </section>
    );
  } else {
    screen = (
      <Suspense fallback={<PageSkeleton title="Loading Macro workspace…" showSplit={isSplitRoute(route)} />}>
        <Fragment key={key}>
          <Outlet />
        </Fragment>
      </Suspense>
    );
  }

  const body = (
    <Shell route={route} live={live} mainRef={mainRef}>
      <ScreenBoundary resetKey={key}>{screen}</ScreenBoundary>
    </Shell>
  );
  return ctx ? <AppContext.Provider value={ctx}>{body}</AppContext.Provider> : body;
}

export function App() {
  const [router] = useState(() =>
    createAppRouter({
      rootComponent: RootLayout,
      pendingComponent: RoutePendingFallback,
    }),
  );
  return <RouterProvider router={router} />;
}
