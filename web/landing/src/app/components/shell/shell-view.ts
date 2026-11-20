import type { MeResponse, QuotaResponse, RunListItem } from '../../../../../../src/api-types.ts';
import type { RunKind, RunStatus } from '../../../../../../src/types.ts';
import type { RecentRun } from '../../lib/recent-runs.ts';
import { probeHref, type Route, runHref } from '../../router.ts';

export interface QuotaReadoutView {
  planning: string;
  dailyRuns: string;
  scopeLabel: 'per IP' | null;
}

/** Formats `/api/quota` counters as `used/limit` strings for monospace display. */
export function formatQuotaReadout(quota: QuotaResponse | null): QuotaReadoutView | null {
  if (quota === null) return null;
  return {
    planning: `${quota.planning.used}/${quota.planning.limit}`,
    dailyRuns: `${quota.dailyRuns.used}/${quota.dailyRuns.limit}`,
    scopeLabel: quota.scope === 'ip' ? 'per IP' : null,
  };
}

export interface ContextTargetView {
  host: string | null;
  kind: 'verified' | 'demo';
  badgeLabel: 'Verified' | 'Demo';
  pendingHost: string | null;
}

function extractHost(origin: string): string | null {
  const trimmed = origin.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed).host || null;
  } catch {
    const stripped = trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    return stripped === '' ? null : stripped;
  }
}

/** Resolves the active context bar target host, verification badge, and any pending origin check. */
export function resolveContextTarget({
  me,
  webOrigin,
  targetMode,
}: {
  me: MeResponse | null;
  webOrigin: string;
  targetMode?: 'demo' | 'own' | undefined;
}): ContextTargetView {
  const pendingHost = me?.pendingVerification?.host ?? null;
  if (targetMode !== 'demo' && me?.verifiedOrigin) {
    return {
      host: me.verifiedOrigin.host,
      kind: 'verified',
      badgeLabel: 'Verified',
      pendingHost,
    };
  }
  return {
    host: extractHost(webOrigin),
    kind: 'demo',
    badgeLabel: 'Demo',
    pendingHost,
  };
}

export const RAIL_COLLAPSED_STORAGE_KEY = 'macro.railCollapsed.v1';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Reads the user's collapsed-rail preference from localStorage, defaulting to expanded (`false`). */
export function readRailCollapsed(storage: StorageReader | null = defaultStorage()): boolean {
  if (storage === null) return false;
  try {
    const raw = storage.getItem(RAIL_COLLAPSED_STORAGE_KEY);
    return raw === 'true' || raw === '1';
  } catch {
    return false;
  }
}

/** Persists the collapsed-rail preference to localStorage, ignoring storage failures. */
export function writeRailCollapsed(
  collapsed: boolean,
  storage: StorageWriter | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(RAIL_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Storage may be full or disabled in private browsing; ignore silently.
  }
}

export const DEFAULT_QUICK_JUMP_RUN_LIMIT = 8;

export interface QuickJumpRunItem {
  id: string;
  kind: RunKind;
  title: string;
  shortId: string;
  href: string;
  status?: RunStatus;
  startedAt: number;
}

function resolveRunTitle(rawTitle: string | undefined, kind: RunKind): string {
  const trimmed = rawTitle?.trim() ?? '';
  if (trimmed !== '') return trimmed;
  return kind === 'probe' ? 'Containment probe' : 'Load test';
}

function resolveRunHref(id: string, kind: RunKind): string {
  return kind === 'probe' ? probeHref(id) : runHref(id);
}

/** Maps `/api/account/runs` entries into Quick Jump items, capped to `limit`. */
export function mapAccountRunsToQuickJump(
  runs: readonly RunListItem[],
  limit = DEFAULT_QUICK_JUMP_RUN_LIMIT,
): QuickJumpRunItem[] {
  const cap = Math.max(0, limit);
  return runs.slice(0, cap).map((r) => {
    const kind: RunKind = r.kind ?? 'run';
    return {
      id: r.runId,
      kind,
      title: resolveRunTitle(r.title, kind),
      shortId: r.runId.slice(0, 8),
      href: resolveRunHref(r.runId, kind),
      status: r.status,
      startedAt: r.startedAt,
    };
  });
}

/** Maps browser-local recent runs into Quick Jump items, capped to `limit`. */
export function mapBrowserRunsToQuickJump(
  runs: readonly RecentRun[],
  limit = DEFAULT_QUICK_JUMP_RUN_LIMIT,
): QuickJumpRunItem[] {
  const cap = Math.max(0, limit);
  return runs.slice(0, cap).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: resolveRunTitle(r.name, r.kind),
    shortId: r.id.slice(0, 8),
    href: resolveRunHref(r.id, r.kind),
    startedAt: r.startedAt,
  }));
}

export type NavRouteId = 'new' | 'runs' | 'probe' | 'account';

/** Returns whether a primary workspace navigation item matches the active route. */
export function isNavRouteActive(navId: NavRouteId, route: Route): boolean {
  switch (navId) {
    case 'new':
      return route.view === 'new';
    case 'runs':
      return route.view === 'runs';
    case 'probe':
      return route.view === 'probe-start' || route.view === 'probe';
    case 'account':
      return route.view === 'account' || route.view === 'sign-in';
  }
}

/** Resolves the display label for the signed-in account, preferring GitHub login over email. */
export function formatIdentityLabel(me: MeResponse | null): string | null {
  if (me === null) return null;
  const login = me.user.githubLogin?.trim() ?? '';
  return login !== '' ? login : me.user.email;
}

/** Returns the platform-appropriate Quick Jump keyboard shortcut label. */
export function formatShortcutHint(isApplePlatform: boolean): string {
  return isApplePlatform ? '⌘K' : 'Ctrl+K';
}
