import { describe, expect, test } from 'bun:test';
import { createMemoryHistory } from '@tanstack/react-router';
import {
  compareHref,
  createAppRouter,
  ID_PATTERN,
  parseRoute,
  parseRunTab,
  parseRunsSearch,
  probeHref,
  resolveRouterRoute,
  routeKey,
  routeTitle,
  runHref,
  type Route,
} from '../web/landing/src/app/router.ts';

async function loadMemoryRoute(entry: string): Promise<{
  route: Route;
  pathname: string;
  search: Record<string, unknown>;
  href: string;
}> {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    isServer: false,
  });
  await router.load();
  const route = resolveRouterRoute(router.state);
  const leaf = router.state.matches[router.state.matches.length - 1];
  return {
    route,
    pathname: router.state.location.pathname,
    search: (leaf?.search ?? {}) as Record<string, unknown>,
    href: router.state.location.href,
  };
}

describe('parseRoute & URL helpers', () => {
  test('parses empty, root, and verify-panel hashes as new test view', () => {
    expect(parseRoute('')).toEqual({ view: 'new' });
    expect(parseRoute('#')).toEqual({ view: 'new' });
    expect(parseRoute('#/')).toEqual({ view: 'new' });
    expect(parseRoute('#/verify-panel')).toEqual({ view: 'new' });
    expect(parseRoute('#/verify-panel/')).toEqual({ view: 'new' });
    expect(parseRoute('#/verify-panel?step=1')).toEqual({ view: 'new' });
  });

  test('parses static app routes and preserves sign-in query params', () => {
    expect(parseRoute('#/runs')).toEqual({ view: 'runs' });
    expect(parseRoute('#/runs/')).toEqual({ view: 'runs' });
    expect(parseRoute('#/probe')).toEqual({ view: 'probe-start' });
    expect(parseRoute('#/probe/')).toEqual({ view: 'probe-start' });
    expect(parseRoute('#/sign-in')).toEqual({ view: 'sign-in' });
    expect(parseRoute('#/sign-in?error=github_email')).toEqual({ view: 'sign-in' });
    expect(parseRoute('#/sign-in?error=google_email')).toEqual({ view: 'sign-in' });
    expect(parseRoute('#/account')).toEqual({ view: 'account' });
  });

  test('parses run routes with tab validation and fallback to overview', () => {
    expect(parseRoute('#/run/run_1.test~a-b')).toEqual({
      view: 'run',
      id: 'run_1.test~a-b',
      tab: 'overview',
    });
    expect(parseRoute('#/run/abc?tab=overview')).toEqual({ view: 'run', id: 'abc', tab: 'overview' });
    expect(parseRoute('#/run/abc?tab=stages')).toEqual({ view: 'run', id: 'abc', tab: 'stages' });
    expect(parseRoute('#/run/abc?tab=ai')).toEqual({ view: 'run', id: 'abc', tab: 'ai' });
    expect(parseRoute('#/run/abc?tab=audit')).toEqual({ view: 'run', id: 'abc', tab: 'audit' });
    expect(parseRoute('#/run/abc?tab=bogus')).toEqual({ view: 'run', id: 'abc', tab: 'overview' });
    expect(parseRoute('#/run/abc?tab=STAGES')).toEqual({ view: 'run', id: 'abc', tab: 'overview' });

    expect(parseRunTab('overview')).toBe('overview');
    expect(parseRunTab('stages')).toBe('stages');
    expect(parseRunTab('ai')).toBe('ai');
    expect(parseRunTab('audit')).toBe('audit');
    expect(parseRunTab('bogus')).toBe('overview');
    expect(parseRunTab(undefined)).toBe('overview');
    expect(parseRunTab(42)).toBe('overview');
  });

  test('parses probe and compare routes with valid IDs', () => {
    const maxId = 'a'.repeat(100);
    expect(ID_PATTERN.test(maxId)).toBe(true);
    expect(ID_PATTERN.test('a'.repeat(101))).toBe(false);

    expect(parseRoute(`#/probe/${maxId}`)).toEqual({ view: 'probe', id: maxId });
    expect(parseRoute('#/probe/probe%2D1')).toEqual({ view: 'probe', id: 'probe-1' });
    expect(parseRoute('#/compare/run-a/run-b')).toEqual({ view: 'compare', a: 'run-a', b: 'run-b' });
    expect(parseRoute(`#/compare/${maxId}/b_2~1.0`)).toEqual({
      view: 'compare',
      a: maxId,
      b: 'b_2~1.0',
    });
  });

  test('rejects invalid, empty, overlong, and undecodable IDs to notfound', () => {
    const tooLong = 'a'.repeat(101);
    const badHashes = [
      '#/run',
      '#/run/',
      '#/run/../x',
      '#/run/..%2Fx',
      '#/run/a%2Fb',
      '#/run/%ZZ',
      `#/run/${tooLong}`,
      '#/run/bad$id',
      '#/run/bad%20id',
      '#/probe//',
      '#/probe/%20',
      '#/probe/../x',
      '#/probe/%ZZ',
      '#/probe/a%2Fb',
      `#/probe/${tooLong}`,
      '#/compare',
      '#/compare/run-a',
      '#/compare/run-a/',
      '#/compare/run-a/run-b/extra',
      '#/compare/%ZZ/run-b',
      '#/compare/run-a/%ZZ',
      '#/compare/a%2Fb/run-b',
      '#/compare/run-a/..%2Fx',
      `#/compare/${tooLong}/run-b`,
      `#/compare/run-a/${tooLong}`,
      '#/does-not-exist',
    ];
    for (const hash of badHashes) {
      expect(parseRoute(hash)).toEqual({ view: 'notfound' });
    }
  });

  test('builds titles, keys, and encoded hrefs', () => {
    expect(routeTitle({ view: 'new' })).toBe('Macro: new load test');
    expect(routeTitle({ view: 'run', id: 'r1', tab: 'stages' })).toBe('Macro: run');
    expect(routeTitle({ view: 'probe-start' })).toBe('Macro: containment probe');
    expect(routeTitle({ view: 'probe', id: 'p1' })).toBe('Macro: containment probe');
    expect(routeTitle({ view: 'runs' })).toBe('Macro: recent runs');
    expect(routeTitle({ view: 'compare', a: 'r1', b: 'r2' })).toBe('Macro: compare runs');
    expect(routeTitle({ view: 'sign-in' })).toBe('Macro: sign in');
    expect(routeTitle({ view: 'account' })).toBe('Macro: account');
    expect(routeTitle({ view: 'notfound' })).toBe('Macro: page not found');

    expect(routeKey({ view: 'run', id: 'r1', tab: 'overview' })).toBe('run:r1');
    expect(routeKey({ view: 'run', id: 'r1', tab: 'audit' })).toBe('run:r1');
    expect(routeKey({ view: 'probe', id: 'p1' })).toBe('probe:p1');
    expect(routeKey({ view: 'compare', a: 'r1', b: 'r2' })).toBe('compare:r1:r2');

    expect(runHref('r 1')).toBe('#/run/r%201');
    expect(runHref('r1', 'stages')).toBe('#/run/r1?tab=stages');
    expect(runHref('r1', 'overview')).toBe('#/run/r1');
    expect(probeHref('p 1')).toBe('#/probe/p%201');
    expect(compareHref('a 1', 'b 2')).toBe('#/compare/a%201/b%202');
  });
});

describe('TanStack Router integration (memory history)', () => {
  test('matches every legacy route and keeps verify-panel without redirecting', async () => {
    const root = await loadMemoryRoute('/');
    expect(root.route).toEqual({ view: 'new' });
    expect(root.pathname).toBe('/');

    const verify = await loadMemoryRoute('/verify-panel');
    expect(verify.route).toEqual({ view: 'new' });
    expect(verify.pathname).toBe('/verify-panel');

    const runs = await loadMemoryRoute('/runs');
    expect(runs.route).toEqual({ view: 'runs' });

    const probeStart = await loadMemoryRoute('/probe');
    expect(probeStart.route).toEqual({ view: 'probe-start' });

    const probe = await loadMemoryRoute('/probe/probe-42');
    expect(probe.route).toEqual({ view: 'probe', id: 'probe-42' });

    const account = await loadMemoryRoute('/account');
    expect(account.route).toEqual({ view: 'account' });
  });

  test('preserves sign-in query parameters', async () => {
    const github = await loadMemoryRoute('/sign-in?error=github_email');
    expect(github.route).toEqual({ view: 'sign-in' });
    expect(github.search['error']).toBe('github_email');

    const google = await loadMemoryRoute('/sign-in?error=google_email');
    expect(google.route).toEqual({ view: 'sign-in' });
    expect(google.search['error']).toBe('google_email');
  });

  test('validates /run/$id search tab and falls back to overview', async () => {
    const def = await loadMemoryRoute('/run/run-1');
    expect(def.route).toEqual({ view: 'run', id: 'run-1', tab: 'overview' });
    expect(def.search['tab']).toBe('overview');

    for (const tab of ['overview', 'stages', 'ai', 'audit'] as const) {
      const res = await loadMemoryRoute(`/run/run-1?tab=${tab}`);
      expect(res.route).toEqual({ view: 'run', id: 'run-1', tab });
      expect(res.search['tab']).toBe(tab);
    }

    const bogus = await loadMemoryRoute('/run/run-1?tab=bogus');
    expect(bogus.route).toEqual({ view: 'run', id: 'run-1', tab: 'overview' });
    expect(bogus.search['tab']).toBe('overview');
  });

  test('matches /compare/$a/$b and rejects invalid IDs to notfound', async () => {
    const cmp = await loadMemoryRoute('/compare/run-1/run-2');
    expect(cmp.route).toEqual({ view: 'compare', a: 'run-1', b: 'run-2' });

    const invalidEntries = [
      '/run/../x',
      '/run/..%2Fx',
      '/run/%ZZ',
      '/run/a%2Fb',
      `/run/${'a'.repeat(101)}`,
      '/probe/%ZZ',
      '/probe/a%2Fb',
      '/compare/run-1',
      '/compare/%ZZ/run-2',
      '/compare/run-1/%ZZ',
      '/compare/a%2Fb/run-2',
      '/compare/run-1/a%2Fb',
      `/compare/${'a'.repeat(101)}/run-2`,
      '/unknown-path',
    ];
    for (const entry of invalidEntries) {
      const res = await loadMemoryRoute(entry);
      expect(res.route).toEqual({ view: 'notfound' });
      expect(routeTitle(res.route)).toBe('Macro: page not found');
    }
  });

  test('supports programmatic navigation across routes and tab search updates', async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: false,
    });
    await router.load();
    expect(resolveRouterRoute(router.state)).toEqual({ view: 'new' });

    await router.navigate({ href: '/run/run-9?tab=ai' });
    expect(resolveRouterRoute(router.state)).toEqual({ view: 'run', id: 'run-9', tab: 'ai' });

    await router.navigate({
      to: '/run/$id',
      params: { id: 'run-9' },
      search: { tab: 'overview' },
    });
    expect(resolveRouterRoute(router.state)).toEqual({ view: 'run', id: 'run-9', tab: 'overview' });
    expect(router.state.location.href).toBe('/run/run-9');

    await router.navigate({ href: '/compare/run-1/run-9' });
    expect(resolveRouterRoute(router.state)).toEqual({ view: 'compare', a: 'run-1', b: 'run-9' });
  });
});

describe('Runs Table search params', () => {
  test('parseRunsSearch keeps valid type, status and query', () => {
    expect(parseRunsSearch({ type: 'probe', status: 'failed', q: 'flash sale' })).toEqual({
      type: 'probe',
      status: 'failed',
      q: 'flash sale',
    });
    expect(parseRunsSearch({ type: 'run', status: 'stopped_halted' })).toEqual({
      type: 'run',
      status: 'stopped_halted',
      q: '',
    });
  });

  test('parseRunsSearch falls back to defaults for missing, unknown or wrong-typed values', () => {
    expect(parseRunsSearch({})).toEqual({ type: 'all', status: 'all', q: '' });
    expect(parseRunsSearch({ type: 'PROBE', status: 'halted' })).toEqual({ type: 'all', status: 'all', q: '' });
    expect(parseRunsSearch({ type: ['probe'], status: null, q: { a: 1 } })).toEqual({ type: 'all', status: 'all', q: '' });
  });

  test('parseRunsSearch keeps a numeric query from a hand-typed link as text', () => {
    expect(parseRunsSearch({ q: 42 }).q).toBe('42');
  });

  test('parseRunsSearch caps an overlong query at 200 characters', () => {
    expect(parseRunsSearch({ q: 'x'.repeat(500) }).q).toBe('x'.repeat(200));
  });

  test('a shared /runs link restores filters; invalid values fall back and defaults are stripped from the URL', async () => {
    const shared = await loadMemoryRoute('/runs?type=probe&status=completed&q=checkout');
    expect(shared.route).toEqual({ view: 'runs' });
    expect(shared.search).toEqual({ type: 'probe', status: 'completed', q: 'checkout' });

    const bogus = await loadMemoryRoute('/runs?type=nope&status=nope');
    expect(bogus.route).toEqual({ view: 'runs' });
    expect(bogus.search).toEqual({ type: 'all', status: 'all', q: '' });

    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ['/runs?type=probe'] }),
      isServer: false,
    });
    await router.load();
    await router.navigate({ to: '/runs', search: { type: 'all', status: 'failed', q: '' } });
    expect(router.state.location.href).toBe('/runs?status=failed');
  });
});