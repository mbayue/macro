import type { Database } from 'bun:sqlite';
import type { DiscoveredRoute } from '../plan/discover.ts';

export interface DraftRow {
  id: string;
  trafficEvent: string;
  createdAt: number;
  origin: string | null;
  routes: DiscoveredRoute[] | null;
  selectedIds: string[] | null;
}

export interface PlanTargetRow {
  planHash: string;
  webOrigin: string;
  apiOrigin: string;
  routes: DiscoveredRoute[];
}

export interface PlanRow {
  hash: string;
  text: string;
  approvedAt: number;
}

interface RawDraft {
  id: string;
  traffic_event: string;
  created_at: number;
  origin: string | null;
  routes_json: string | null;
  selected_ids_json: string | null;
}

interface RawPlan {
  hash: string;
  text: string;
  approved_at: number;
}

interface CountRow {
  n: number;
}

function parseSelectedIds(raw: string | null): string[] | null {
  if (raw === null || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return null;
  return value;
}

function parseDiscoveredRoutes(raw: string | null): DiscoveredRoute[] | null {
  if (raw === null || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const out: DiscoveredRoute[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    if (!('id' in item) || !('kind' in item) || !('path' in item) || !('method' in item)) return null;
    const { id, kind, path, method } = item;
    if (typeof id !== 'string' || typeof path !== 'string' || method !== 'GET') return null;
    if (kind !== 'document' && kind !== 'script' && kind !== 'style' && kind !== 'asset' && kind !== 'page') return null;
    const storedOn = 'defaultOn' in item ? item.defaultOn : kind !== 'asset';
    if (typeof storedOn !== 'boolean') return null;
    out.push({ id, kind, method: 'GET', path, defaultOn: storedOn });
  }
  return out;
}

/** Persistence operations for drafts, discovered route selections, approved plans, and plan targets. */
export class PlansStore {
  constructor(private readonly db: Database) {}

  createDraft(draft: { id: string; trafficEvent: string; createdAt: number }): void {
    this.db
      .prepare('INSERT INTO drafts (id, traffic_event, created_at) VALUES (?, ?, ?)')
      .run(draft.id, draft.trafficEvent, draft.createdAt);
  }

  getDraft(id: string): DraftRow | null {
    const r = this.db
      .prepare<RawDraft, [string]>(
        'SELECT id, traffic_event, created_at, origin, routes_json, selected_ids_json FROM drafts WHERE id = ?',
      )
      .get(id);
    if (r === null) return null;
    const routes = parseDiscoveredRoutes(r.routes_json);
    return {
      id: r.id,
      trafficEvent: r.traffic_event,
      createdAt: r.created_at,
      origin: r.origin,
      routes,
      selectedIds:
        parseSelectedIds(r.selected_ids_json) ?? routes?.filter((row) => row.defaultOn).map((row) => row.id) ?? null,
    };
  }

  latestDiscovery(origin: string): DraftRow | null {
    const r = this.db
      .prepare<{ id: string }, [string]>(
        'SELECT id FROM drafts WHERE origin = ? AND routes_json IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      )
      .get(origin);
    return r === null ? null : this.getDraft(r.id);
  }

  setDraftDiscovery(id: string, origin: string, routes: readonly DiscoveredRoute[], selectedIds?: readonly string[]): void {
    const ids = selectedIds ?? routes.filter((row) => row.defaultOn).map((row) => row.id);
    this.db
      .prepare('UPDATE drafts SET origin = ?, routes_json = ?, selected_ids_json = ? WHERE id = ?')
      .run(origin, JSON.stringify(routes), JSON.stringify(ids), id);
  }

  storePlanTarget(row: PlanTargetRow): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO plan_targets (plan_hash, web_origin, api_origin, routes_json) VALUES (?, ?, ?, ?)',
      )
      .run(row.planHash, row.webOrigin, row.apiOrigin, JSON.stringify(row.routes));
  }

  getPlanTarget(planHash: string): PlanTargetRow | null {
    const r = this.db
      .prepare<{ plan_hash: string; web_origin: string; api_origin: string; routes_json: string }, [string]>(
        'SELECT plan_hash, web_origin, api_origin, routes_json FROM plan_targets WHERE plan_hash = ?',
      )
      .get(planHash);
    if (r === undefined || r === null) return null;
    const routes = parseDiscoveredRoutes(r.routes_json);
    if (routes === null) return null;
    return { planHash: r.plan_hash, webOrigin: r.web_origin, apiOrigin: r.api_origin, routes };
  }

  /**
   * Stores an approved canonical plan. Idempotent by hash: an existing row is
   * left untouched. Returns true when a new row was inserted.
   */
  storeApprovedPlan(plan: { hash: string; text: string; approvedAt: number }): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO plans (hash, text, approved_at) VALUES (?, ?, ?)')
      .run(plan.hash, plan.text, plan.approvedAt);
    return res.changes > 0;
  }

  getPlan(hash: string): PlanRow | null {
    const r = this.db
      .prepare<RawPlan, [string]>('SELECT hash, text, approved_at FROM plans WHERE hash = ?')
      .get(hash);
    return r ? { hash: r.hash, text: r.text, approvedAt: r.approved_at } : null;
  }

  hasApprovedPlan(hash: string): boolean {
    return (
      this.db.prepare<CountRow, [string]>('SELECT COUNT(*) AS n FROM plans WHERE hash = ?').get(hash)?.n === 1
    );
  }
}
