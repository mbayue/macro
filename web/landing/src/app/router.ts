/** Hash routes powered by TanStack Router (code-based route tree, preserving legacy /app/#/... URLs). */
import { createElement, lazy } from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  getRouteApi,
  notFound,
  Outlet,
  stripSearchParams,
  useSearch,
  type NotFoundRouteComponent,
  type RouteComponent,
  type RouterHistory,
  type RouterState,
} from '@tanstack/react-router';

export const ID_PATTERN = /^[A-Za-z0-9._~-]{1,100}$/;
export const RUN_TABS = ['overview', 'stages', 'ai', 'audit'] as const;
export type RunTab = (typeof RUN_TABS)[number];

/** Runs Table (`#/runs`) filters kept in the URL: `?type=`, `?status=`, `?q=`. */
export const RUNS_KIND_FILTERS = ['all', 'run', 'probe'] as const;
export const RUNS_STATUS_FILTERS = ['all', 'completed', 'running', 'stopped_halted', 'failed'] as const;
export type RunsKindFilter = (typeof RUNS_KIND_FILTERS)[number];
export type RunsStatusFilter = (typeof RUNS_STATUS_FILTERS)[number];
export interface RunsSearch {
  type: RunsKindFilter;
  status: RunsStatusFilter;
  q: string;
}
export const DEFAULT_RUNS_SEARCH: RunsSearch = { type: 'all', status: 'all', q: '' };
const RUNS_QUERY_MAX = 200;

export type Route =
  | { view: 'new' }
  | { view: 'run'; id: string; tab: RunTab }
  | { view: 'probe'; id: string }
  | { view: 'probe-start' }
  | { view: 'runs' }
  | { view: 'compare'; a: string; b: string }
  | { view: 'sign-in' }
  | { view: 'account' }
  | { view: 'notfound' };

const LazyNewTest = lazy(() => import('./pages/NewTest.tsx').then((m) => ({ default: m.NewTest })));
const LazyRunPage = lazy(() => import('./pages/Run.tsx').then((m) => ({ default: m.RunPage })));
const LazyProbeStart = lazy(() => import('./pages/ProbeStart.tsx').then((m) => ({ default: m.ProbeStart })));
const LazyProbePage = lazy(() => import('./pages/Probe.tsx').then((m) => ({ default: m.ProbePage })));
const LazyRecentRunsPage = lazy(() => import('./pages/RecentRuns.tsx').then((m) => ({ default: m.RecentRunsPage })));
const LazyComparePage = lazy(() => import('./pages/Compare.tsx').then((m) => ({ default: m.ComparePage })));
const LazySignIn = lazy(() => import('./pages/SignIn.tsx').then((m) => ({ default: m.SignIn })));
const LazyNotFound = lazy(() => import('./pages/NotFound.tsx').then((m) => ({ default: m.NotFound })));

const runRouteApi = getRouteApi('/run/$id');
const probeRouteApi = getRouteApi('/probe/$id');
const compareRouteApi = getRouteApi('/compare/$a/$b');

const NewTestScreen: RouteComponent = () => createElement(LazyNewTest);
const ProbeStartScreen: RouteComponent = () => createElement(LazyProbeStart);
const RecentRunsScreen: RouteComponent = () => createElement(LazyRecentRunsPage);
const SignInScreen: RouteComponent = () => createElement(LazySignIn);
const DefaultNotFoundScreen: NotFoundRouteComponent = () => createElement(LazyNotFound);

function RunScreen() {
  const { id } = runRouteApi.useParams();
  runRouteApi.useSearch();
  return createElement(LazyRunPage, { id });
}

function ProbeScreen() {
  const { id } = probeRouteApi.useParams();
  return createElement(LazyProbePage, { id });
}

function CompareScreen() {
  const { a, b } = compareRouteApi.useParams();
  return createElement(LazyComparePage, { a, b });
}

/** Validates a `?tab=` value for `#/run/:id`, falling back to `'overview'` for unknown inputs. */
export function parseRunTab(raw: unknown): RunTab {
  if (typeof raw !== 'string') return 'overview';
  return (RUN_TABS as readonly string[]).includes(raw) ? (raw as RunTab) : 'overview';
}

function pick<T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Validates `#/runs` search params; unknown or wrong-typed values fall back to the defaults. */
export function parseRunsSearch(search: Record<string, unknown>): RunsSearch {
  const q = search['q'];
  return {
    type: pick(RUNS_KIND_FILTERS, search['type'], DEFAULT_RUNS_SEARCH.type),
    status: pick(RUNS_STATUS_FILTERS, search['status'], DEFAULT_RUNS_SEARCH.status),
    q:
      typeof q === 'string'
        ? q.slice(0, RUNS_QUERY_MAX)
        : typeof q === 'number' && Number.isFinite(q)
          ? String(q)
          : DEFAULT_RUNS_SEARCH.q,
  };
}

function decodeValidId(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return ID_PATTERN.test(decoded) ? decoded : null;
}

function requireValidId(id: string): string {
  if (!ID_PATTERN.test(id)) throw notFound();
  return id;
}

/** Parses a hash string (`""`, `#/...`) into a typed `Route` for standalone callers and tests. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#[/]?/, '');
  const qIndex = path.indexOf('?');
  const rawPath = qIndex === -1 ? path : path.slice(0, qIndex);
  const searchStr = qIndex === -1 ? '' : path.slice(qIndex + 1);
  const bare = rawPath.replace(/\/$/, '');

  if (bare === '' || bare === 'verify-panel' || bare === 'verify') return { view: 'new' };

  const [kind, first, second, ...rest] = bare.split('/');
  if (kind === 'sign-in' && first === undefined && rest.length === 0) return { view: 'sign-in' };
  if (kind === 'account' && first === undefined && rest.length === 0) return { view: 'account' };
  if (kind === 'runs' && first === undefined && rest.length === 0) return { view: 'runs' };
  if (kind === 'probe' && first === undefined && rest.length === 0) return { view: 'probe-start' };

  if (kind === 'run' && first !== undefined && second === undefined && rest.length === 0) {
    const id = decodeValidId(first);
    if (id === null) return { view: 'notfound' };
    const tab = parseRunTab(new URLSearchParams(searchStr).get('tab'));
    return { view: 'run', id, tab };
  }

  if (kind === 'probe' && first !== undefined && second === undefined && rest.length === 0) {
    const id = decodeValidId(first);
    return id === null ? { view: 'notfound' } : { view: 'probe', id };
  }

  if (kind === 'compare' && first !== undefined && second !== undefined && rest.length === 0) {
    const a = decodeValidId(first);
    const b = decodeValidId(second);
    return a === null || b === null ? { view: 'notfound' } : { view: 'compare', a, b };
  }

  return { view: 'notfound' };
}

/** Returns the browser document title for a resolved route. */
export function routeTitle(route: Route): string {
  switch (route.view) {
    case 'new':
      return 'Macro: new load test';
    case 'run':
      return 'Macro: run';
    case 'probe':
    case 'probe-start':
      return 'Macro: containment probe';
    case 'runs':
      return 'Macro: recent runs';
    case 'compare':
      return 'Macro: compare runs';
    case 'sign-in':
      return 'Macro: sign in';
    case 'account':
      return 'Macro: account';
    case 'notfound':
      return 'Macro: page not found';
  }
}

/** Returns a stable identity key for screen remounting (ignoring search-only tab changes on a run). */
export function routeKey(route: Route): string {
  if (route.view === 'run' || route.view === 'probe') return `${route.view}:${route.id}`;
  if (route.view === 'compare') return `compare:${route.a}:${route.b}`;
  return route.view;
}

export const runHref = (id: string, tab?: RunTab): string => {
  const base = `#/run/${encodeURIComponent(id)}`;
  return tab !== undefined && tab !== 'overview' ? `${base}?tab=${tab}` : base;
};
export const probeHref = (id: string): string => `#/probe/${encodeURIComponent(id)}`;
export const compareHref = (a: string, b: string): string =>
  `#/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;

/** Reads the validated `?tab=` search param on the `/run/$id` route, defaulting to `'overview'`. */
export function useRunTab(): RunTab {
  const tab = useSearch({
    strict: false,
    select: (search) => (search as Record<string, unknown>)['tab'],
  });
  return parseRunTab(tab);
}

export interface CreateAppRouterOptions {
  history?: RouterHistory;
  rootComponent?: RouteComponent;
  notFoundComponent?: NotFoundRouteComponent;
  pendingComponent?: RouteComponent;
  isServer?: boolean;
}

function buildRouteTree(options?: CreateAppRouterOptions) {
  const rootRoute = createRootRoute({
    component: options?.rootComponent ?? Outlet,
    notFoundComponent: options?.notFoundComponent ?? DefaultNotFoundScreen,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: NewTestScreen,
  });

  // Alias of `#/`; keep the path intact so NewTest.tsx can detect `verify-panel` or `verify`.
  const verifyPanelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/verify-panel',
    component: NewTestScreen,
  });

  const verifyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/verify',
    component: NewTestScreen,
  });

  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/run/$id',
    params: {
      parse: ({ id }) => ({ id: requireValidId(id) }),
    },
    validateSearch: (search: Record<string, unknown>): { tab: RunTab } => ({
      tab: parseRunTab(search['tab']),
    }),
    search: {
      middlewares: [stripSearchParams<{ tab: RunTab }>({ tab: 'overview' })],
    },
    component: RunScreen,
  });

  const probeStartRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/probe',
    component: ProbeStartScreen,
  });

  const probeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/probe/$id',
    params: {
      parse: ({ id }) => ({ id: requireValidId(id) }),
    },
    component: ProbeScreen,
  });

  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs',
    validateSearch: parseRunsSearch,
    search: {
      middlewares: [stripSearchParams<RunsSearch>(DEFAULT_RUNS_SEARCH)],
    },
    component: RecentRunsScreen,
  });

  const compareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/compare/$a/$b',
    params: {
      parse: ({ a, b }) => ({
        a: requireValidId(a),
        b: requireValidId(b),
      }),
    },
    component: CompareScreen,
  });

  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: SignInScreen,
  });

  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/account',
    component: SignInScreen,
  });

  return rootRoute.addChildren([
    indexRoute,
    verifyPanelRoute,
    verifyRoute,
    runRoute,
    probeStartRoute,
    probeRoute,
    runsRoute,
    compareRoute,
    signInRoute,
    accountRoute,
  ]);
}

/** Creates the code-based TanStack Router instance using hash history by default in the browser. */
export function createAppRouter(options?: CreateAppRouterOptions) {
  const routeTree = buildRouteTree(options);
  return createRouter({
    routeTree,
    history: options?.history ?? createHashHistory(),
    isServer: options?.isServer ?? false,
    origin: typeof window !== 'undefined' && window.origin !== 'null' ? window.origin : 'http://localhost',
    ...(options?.pendingComponent ? { defaultPendingComponent: options.pendingComponent } : {}),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

type ResolvableRouterState = Pick<RouterState<AppRouter['routeTree']>, 'location' | 'matches'>;

/** Maps live TanStack Router state (matches + location) to the app's `Route` union. */
export function resolveRouterRoute(state: ResolvableRouterState): Route {
  if (state.matches.length === 0) {
    return parseRoute(`#${state.location.href}`);
  }
  const rootMatch = state.matches[0];
  const leafMatch = state.matches[state.matches.length - 1];
  if (
    !rootMatch ||
    rootMatch._notFound ||
    state.matches.some((m) => m.status === 'notFound' || m.paramsError !== undefined) ||
    state.matches.length < 2 ||
    !leafMatch
  ) {
    return { view: 'notfound' };
  }

  switch (leafMatch.routeId) {
    case '/':
    case '/verify-panel':
    case '/verify':
      return { view: 'new' };
    case '/run/$id': {
      const id = (leafMatch.params as { id?: unknown }).id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { view: 'notfound' };
      const tab = parseRunTab((leafMatch.search as { tab?: unknown }).tab);
      return { view: 'run', id, tab };
    }
    case '/probe':
      return { view: 'probe-start' };
    case '/probe/$id': {
      const id = (leafMatch.params as { id?: unknown }).id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { view: 'notfound' };
      return { view: 'probe', id };
    }
    case '/runs':
      return { view: 'runs' };
    case '/compare/$a/$b': {
      const params = leafMatch.params as { a?: unknown; b?: unknown };
      if (
        typeof params.a !== 'string' ||
        !ID_PATTERN.test(params.a) ||
        typeof params.b !== 'string' ||
        !ID_PATTERN.test(params.b)
      ) {
        return { view: 'notfound' };
      }
      return { view: 'compare', a: params.a, b: params.b };
    }
    case '/sign-in':
      return { view: 'sign-in' };
    case '/account':
      return { view: 'account' };
    default:
      return { view: 'notfound' };
  }
}
