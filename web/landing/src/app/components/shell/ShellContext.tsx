import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountRunsResponse, MeResponse, QuotaResponse } from '../../../../../../src/api-types.ts';
import { currentTheme, setTheme, type Theme } from '../../../theme.ts';
import { AppContext } from '../../context.tsx';
import { getQuota } from '../../lib/api.ts';
import { clearReviewState, postSignOut } from '../../lib/auth-api.ts';
import { clearRecentRuns, loadRecentRuns } from '../../lib/recent-runs.ts';
import { type Route, routeKey } from '../../router.ts';
import {
  type ContextTargetView,
  DEFAULT_QUICK_JUMP_RUN_LIMIT,
  formatIdentityLabel,
  formatShortcutHint,
  mapAccountRunsToQuickJump,
  mapBrowserRunsToQuickJump,
  type QuickJumpRunItem,
  readRailCollapsed,
  resolveContextTarget,
  writeRailCollapsed,
} from './shell-view.ts';

export type ShellTargetMode = 'demo' | 'own' | null;

export interface ShellState {
  route: Route;
  railCollapsed: boolean;
  mobileOpen: boolean;
  quickJumpOpen: boolean;
  theme: Theme;
  quota: QuotaResponse | null;
  quotaLoading: boolean;
  recentRuns: QuickJumpRunItem[];
  recentRunsSource: 'account' | 'browser';
  signOutConfirmOpen: boolean;
  signingOut: boolean;
  me: MeResponse | null;
  target: ContextTargetView;
  targetModeOverride: ShellTargetMode;
  identityLabel: string | null;
}

export interface ShellActions {
  toggleRailCollapsed: () => void;
  setMobileOpen: (open: boolean) => void;
  setQuickJumpOpen: (open: boolean) => void;
  openQuickJump: () => void;
  toggleTheme: () => void;
  signOut: () => void;
  setSignOutConfirmOpen: (open: boolean) => void;
  confirmSignOut: () => Promise<void>;
  navigateTo: (pathOrHash: string) => void;
  setTargetModeOverride: (mode: ShellTargetMode) => void;
}

export interface ShellMeta {
  shortcutHint: string;
  mainRef: React.RefObject<HTMLElement | null>;
  lastFocusBeforeQuickJumpRef: React.MutableRefObject<HTMLElement | null>;
}

export interface ShellContextValue {
  state: ShellState;
  actions: ShellActions;
  meta: ShellMeta;
}

const ShellContext = createContext<ShellContextValue | null>(null);

function detectApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function ShellProvider({
  route,
  mainRef,
  children,
}: {
  route: Route;
  mainRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  // Shell renders during boot before AppContext exists; identity and config are optional then.
  const ctx = use(AppContext);
  const me = ctx?.me ?? null;
  const webOrigin = ctx?.config.webOrigin ?? '';
  const activeRouteKey = routeKey(route);

  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => readRailCollapsed());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickJumpOpen, setQuickJumpOpenState] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [targetModeOverride, setTargetModeOverride] = useState<ShellTargetMode>(null);
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== 'undefined' && currentTheme() === 'light' ? 'light' : 'dark',
  );
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [recentRuns, setRecentRuns] = useState<QuickJumpRunItem[]>(() =>
    mapBrowserRunsToQuickJump(loadRecentRuns(), DEFAULT_QUICK_JUMP_RUN_LIMIT),
  );
  const [recentRunsSource, setRecentRunsSource] = useState<'account' | 'browser'>('browser');
  const [signingOut, setSigningOut] = useState(false);
  const [shortcutHint, setShortcutHint] = useState(() => formatShortcutHint(false));

  const lastFocusBeforeQuickJumpRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setShortcutHint(formatShortcutHint(detectApplePlatform()));
    setThemeState(currentTheme());
  }, []);

  // Reset target mode override when signed out.
  useEffect(() => {
    if (me === null) setTargetModeOverride(null);
  }, [me]);

  // Close mobile navigation sheet whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [activeRouteKey]);

  const setQuickJumpOpen = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      lastFocusBeforeQuickJumpRef.current =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setQuickJumpOpenState(nextOpen);
  }, []);

  const openQuickJump = useCallback(() => {
    setQuickJumpOpen(true);
  }, [setQuickJumpOpen]);

  // Global Ctrl/Cmd+K shortcut toggles Quick Jump.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickJumpOpenState((prev) => {
          if (!prev) {
            lastFocusBeforeQuickJumpRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Refresh /api/quota when identity or active route changes.
  useEffect(() => {
    const abort = new AbortController();
    setQuotaLoading(true);
    void getQuota(abort.signal).then((res) => {
      if (abort.signal.aborted) return;
      setQuotaLoading(false);
      if (res.ok) setQuota(res.data);
    });
    return () => abort.abort();
  }, [me?.user.id, activeRouteKey]);

  // Keep Quick Jump recent runs synced from /api/account/runs (signed in) or browser storage (signed out).
  useEffect(() => {
    if (me === null) {
      setRecentRunsSource('browser');
      setRecentRuns(mapBrowserRunsToQuickJump(loadRecentRuns(), DEFAULT_QUICK_JUMP_RUN_LIMIT));
      return;
    }

    const abort = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/account/runs', { credentials: 'same-origin', signal: abort.signal });
        if (abort.signal.aborted) return;
        if (!res.ok) {
          setRecentRunsSource('browser');
          setRecentRuns(mapBrowserRunsToQuickJump(loadRecentRuns(), DEFAULT_QUICK_JUMP_RUN_LIMIT));
          return;
        }
        const body = (await res.json()) as AccountRunsResponse;
        if (abort.signal.aborted) return;
        setRecentRunsSource('account');
        setRecentRuns(mapAccountRunsToQuickJump(body.runs, DEFAULT_QUICK_JUMP_RUN_LIMIT));
      } catch {
        if (!abort.signal.aborted) {
          setRecentRunsSource('browser');
          setRecentRuns(mapBrowserRunsToQuickJump(loadRecentRuns(), DEFAULT_QUICK_JUMP_RUN_LIMIT));
        }
      }
    })();

    return () => abort.abort();
  }, [me, activeRouteKey, quickJumpOpen]);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      writeRailCollapsed(next);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
    ctx?.announce(`Switched to ${next} theme.`);
  }, [ctx]);

  const navigateTo = useCallback(
    (pathOrHash: string) => {
      setMobileOpen(false);
      setQuickJumpOpenState(false);
      const clean = pathOrHash.replace(/^#/, '');
      const normalized = clean.startsWith('/') ? clean : `/${clean}`;
      if (ctx) {
        ctx.navigate(normalized);
        return;
      }
      window.location.hash = `#${normalized}`;
    },
    [ctx],
  );

  const signOut = useCallback(() => {
    if (signingOut) return;
    setMobileOpen(false);
    setQuickJumpOpenState(false);
    setSignOutConfirmOpen(true);
  }, [signingOut]);

  const confirmSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await postSignOut();
      clearRecentRuns();
      clearReviewState();
      setRecentRuns([]);
      setTargetModeOverride(null);
      setSignOutConfirmOpen(false);
      await ctx?.refreshMe();
      ctx?.announce('Signed out.');
      if (ctx) ctx.navigate('/');
      else window.location.hash = '#/';
    } finally {
      setSigningOut(false);
    }
  }, [ctx, signingOut]);

  const target = useMemo(
    () =>
      resolveContextTarget({
        me,
        webOrigin,
        targetMode: targetModeOverride ?? undefined,
      }),
    [me, webOrigin, targetModeOverride],
  );
  const identityLabel = useMemo(() => formatIdentityLabel(me), [me]);

  const value = useMemo<ShellContextValue>(
    () => ({
      state: {
        route,
        railCollapsed,
        mobileOpen,
        quickJumpOpen,
        theme,
        quota,
        quotaLoading,
        recentRuns,
        recentRunsSource,
        signOutConfirmOpen,
        signingOut,
        me,
        target,
        targetModeOverride,
        identityLabel,
      },
      actions: {
        toggleRailCollapsed,
        setMobileOpen,
        setQuickJumpOpen,
        openQuickJump,
        toggleTheme,
        signOut,
        setSignOutConfirmOpen,
        confirmSignOut,
        navigateTo,
        setTargetModeOverride,
      },
      meta: {
        shortcutHint,
        mainRef,
        lastFocusBeforeQuickJumpRef,
      },
    }),
    [
      route,
      railCollapsed,
      mobileOpen,
      quickJumpOpen,
      theme,
      quota,
      quotaLoading,
      recentRuns,
      recentRunsSource,
      signOutConfirmOpen,
      signingOut,
      me,
      target,
      targetModeOverride,
      identityLabel,
      toggleRailCollapsed,
      setQuickJumpOpen,
      openQuickJump,
      toggleTheme,
      signOut,
      confirmSignOut,
      navigateTo,
      shortcutHint,
      mainRef,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Reads ShellContext when inside `<ShellProvider>`, or returns `null` in standalone renders/tests. */
export function useOptionalShell(): ShellContextValue | null {
  return use(ShellContext);
}

export function useShell(): ShellContextValue {
  const value = use(ShellContext);
  if (!value) throw new Error('useShell must be used inside <ShellProvider>');
  return value;
}
