import { describe, expect, test } from 'bun:test';
import {
  formatIdentityLabel,
  formatQuotaReadout,
  formatShortcutHint,
  isNavRouteActive,
  mapAccountRunsToQuickJump,
  mapBrowserRunsToQuickJump,
  RAIL_COLLAPSED_STORAGE_KEY,
  readRailCollapsed,
  resolveContextTarget,
  writeRailCollapsed,
} from '../web/landing/src/app/components/shell/shell-view.ts';

describe('resolveContextTarget', () => {
  test('uses demo origin host when signed out or unverified, and preserves pending verification host', () => {
    expect(resolveContextTarget({ me: null, webOrigin: 'https://yue.macro.my.id' })).toEqual({
      host: 'yue.macro.my.id',
      kind: 'demo',
      badgeLabel: 'Demo',
      pendingHost: null,
    });

    expect(
      resolveContextTarget({
        me: {
          user: { id: 'u1', email: 'a@example.com', githubLogin: 'bayu' },
          verifiedOrigin: null,
          pendingVerification: { origin: 'https://app.example.com', host: 'app.example.com' },
        },
        webOrigin: 'https://yue.macro.my.id/',
      }),
    ).toEqual({
      host: 'yue.macro.my.id',
      kind: 'demo',
      badgeLabel: 'Demo',
      pendingHost: 'app.example.com',
    });
  });

  test('prefers verifiedOrigin host when signed-in account has a verified origin', () => {
    expect(
      resolveContextTarget({
        me: {
          user: { id: 'u1', email: 'a@example.com', githubLogin: null },
          verifiedOrigin: { origin: 'https://shop.example.org:8443', host: 'shop.example.org:8443' },
          pendingVerification: null,
        },
        webOrigin: 'https://yue.macro.my.id',
      }),
    ).toEqual({
      host: 'shop.example.org:8443',
      kind: 'verified',
      badgeLabel: 'Verified',
      pendingHost: null,
    });
  });

  test('falls back safely when webOrigin is empty during boot', () => {
    expect(resolveContextTarget({ me: null, webOrigin: '' })).toEqual({
      host: null,
      kind: 'demo',
      badgeLabel: 'Demo',
      pendingHost: null,
    });
  });
});

describe('formatQuotaReadout', () => {
  test('returns null when quota has not loaded', () => {
    expect(formatQuotaReadout(null)).toBeNull();
  });

  test('formats planning and daily runs as used/limit and adds per IP only for ip scope', () => {
    expect(
      formatQuotaReadout({
        scope: 'ip',
        planning: { used: 3, limit: 10, remaining: 7 },
        dailyRuns: { used: 1, limit: 5, remaining: 4 },
      }),
    ).toEqual({
      planning: '3/10',
      dailyRuns: '1/5',
      scopeLabel: 'per IP',
    });

    expect(
      formatQuotaReadout({
        scope: 'account',
        planning: { used: 12, limit: 30, remaining: 18 },
        dailyRuns: { used: 4, limit: 50, remaining: 46 },
      }),
    ).toEqual({
      planning: '12/30',
      dailyRuns: '4/50',
      scopeLabel: null,
    });
  });
});

describe('rail collapsed preference persistence', () => {
  test('defaults to false and reads/writes true/false under macro.railCollapsed.v1', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };

    expect(RAIL_COLLAPSED_STORAGE_KEY).toBe('macro.railCollapsed.v1');
    expect(readRailCollapsed(storage)).toBe(false);

    writeRailCollapsed(true, storage);
    expect(store.get('macro.railCollapsed.v1')).toBe('true');
    expect(readRailCollapsed(storage)).toBe(true);

    writeRailCollapsed(false, storage);
    expect(readRailCollapsed(storage)).toBe(false);

    store.set('macro.railCollapsed.v1', 'unexpected');
    expect(readRailCollapsed(storage)).toBe(false);
  });

  test('ignores null or throwing storage without failing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRailCollapsed(null)).toBe(false);
    expect(readRailCollapsed(broken)).toBe(false);
    expect(() => writeRailCollapsed(true, null)).not.toThrow();
    expect(() => writeRailCollapsed(true, broken)).not.toThrow();
  });
});

describe('Quick Jump run mappers', () => {
  test('mapAccountRunsToQuickJump normalizes titles, hrefs, shortId, status, and applies limit', () => {
    const mapped = mapAccountRunsToQuickJump(
      [
        {
          runId: 'run-1234567890',
          kind: 'run',
          startedAt: 1_700_000_000_000,
          status: 'running',
          safeCapacity: null,
          breakingPoint: null,
          title: '  Checkout flash sale  ',
        },
        {
          runId: 'probe_abcdefgh',
          kind: 'probe',
          startedAt: 1_699_999_000_000,
          status: 'completed',
          safeCapacity: null,
          breakingPoint: null,
          title: '',
        },
        {
          runId: 'run-third-ignored',
          startedAt: 1_699_998_000_000,
          status: 'completed',
          safeCapacity: 40,
          breakingPoint: null,
          title: '',
        },
      ],
      2,
    );

    expect(mapped).toEqual([
      {
        id: 'run-1234567890',
        kind: 'run',
        title: 'Checkout flash sale',
        shortId: 'run-1234',
        href: '#/run/run-1234567890',
        status: 'running',
        startedAt: 1_700_000_000_000,
      },
      {
        id: 'probe_abcdefgh',
        kind: 'probe',
        title: 'Containment probe',
        shortId: 'probe_ab',
        href: '#/probe/probe_abcdefgh',
        status: 'completed',
        startedAt: 1_699_999_000_000,
      },
    ]);
  });

  test('mapBrowserRunsToQuickJump maps browser-stored runs with URI-safe hrefs and cap', () => {
    const mapped = mapBrowserRunsToQuickJump(
      [
        { id: 'run 1', kind: 'run', name: '', startedAt: 100 },
        { id: 'probe-999999', kind: 'probe', name: 'Probe', startedAt: 90 },
        { id: 'run-extra', kind: 'run', name: 'Extra', startedAt: 80 },
      ],
      2,
    );

    expect(mapped).toEqual([
      {
        id: 'run 1',
        kind: 'run',
        title: 'Load test',
        shortId: 'run 1',
        href: '#/run/run%201',
        startedAt: 100,
      },
      {
        id: 'probe-999999',
        kind: 'probe',
        title: 'Probe',
        shortId: 'probe-99',
        href: '#/probe/probe-999999',
        startedAt: 90,
      },
    ]);
  });
});

describe('shell navigation and identity helpers', () => {
  test('isNavRouteActive highlights matching routes only', () => {
    expect(isNavRouteActive('new', { view: 'new' })).toBe(true);
    expect(isNavRouteActive('new', { view: 'runs' })).toBe(false);
    expect(isNavRouteActive('runs', { view: 'runs' })).toBe(true);
    expect(isNavRouteActive('runs', { view: 'run', id: 'r1', tab: 'overview' })).toBe(false);
    expect(isNavRouteActive('probe', { view: 'probe-start' })).toBe(true);
    expect(isNavRouteActive('probe', { view: 'probe', id: 'p1' })).toBe(true);
    expect(isNavRouteActive('account', { view: 'account' })).toBe(true);
    expect(isNavRouteActive('account', { view: 'sign-in' })).toBe(true);
    expect(isNavRouteActive('account', { view: 'notfound' })).toBe(false);
  });

  test('formatIdentityLabel prefers non-empty githubLogin then falls back to email', () => {
    expect(formatIdentityLabel(null)).toBeNull();
    expect(
      formatIdentityLabel({
        user: { id: 'u1', email: 'a@example.com', githubLogin: 'mbayue' },
        verifiedOrigin: null,
        pendingVerification: null,
      }),
    ).toBe('mbayue');
    expect(
      formatIdentityLabel({
        user: { id: 'u1', email: 'a@example.com', githubLogin: null },
        verifiedOrigin: null,
        pendingVerification: null,
      }),
    ).toBe('a@example.com');
    expect(
      formatIdentityLabel({
        user: { id: 'u1', email: 'a@example.com', githubLogin: '  ' },
        verifiedOrigin: null,
        pendingVerification: null,
      }),
    ).toBe('a@example.com');
  });

  test('formatShortcutHint switches between Apple and non-Apple labels', () => {
    expect(formatShortcutHint(true)).toBe('⌘K');
    expect(formatShortcutHint(false)).toBe('Ctrl+K');
  });
});
