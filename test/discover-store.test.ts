import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store/db.ts';
import type { DiscoveredRoute } from '../src/plan/discover.ts';

const ROUTES: DiscoveredRoute[] = [
  { id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true },
  { id: 'r2', kind: 'script', method: 'GET', path: '/assets/app.js', defaultOn: true },
];

describe('discover store', () => {
  test('setDraftDiscovery round-trips origin and routes through getDraft', () => {
    const store = new Store(':memory:');
    store.createDraft({ id: 'd1', trafficEvent: 'x'.repeat(20), createdAt: 1 });
    const before = store.getDraft('d1');
    expect(before?.origin).toBeNull();
    expect(before?.routes).toBeNull();
    store.setDraftDiscovery('d1', 'https://sketch.my.id', ROUTES);
    const after = store.getDraft('d1');
    expect(after?.origin).toBe('https://sketch.my.id');
    expect(after?.routes).toEqual(ROUTES);
  });

  test('storePlanTarget round-trips and second store for same hash does not change the row', () => {
    const store = new Store(':memory:');
    store.createDraft({ id: 'd2', trafficEvent: 'y'.repeat(20), createdAt: 2 });
    store.setDraftDiscovery('d2', 'https://sketch.my.id', ROUTES);
    store.storeApprovedPlan({ hash: 'h1', text: 'plan', approvedAt: 3 });
    store.storePlanTarget({ planHash: 'h1', webOrigin: 'https://sketch.my.id', apiOrigin: 'https://sketch.my.id', routes: ROUTES });
    expect(store.getPlanTarget('h1')).toEqual({
      planHash: 'h1',
      webOrigin: 'https://sketch.my.id',
      apiOrigin: 'https://sketch.my.id',
      routes: ROUTES,
    });
    store.storePlanTarget({
      planHash: 'h1',
      webOrigin: 'https://other.example',
      apiOrigin: 'https://other.example',
      routes: [{ id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true }],
    });
    expect(store.getPlanTarget('h1')?.webOrigin).toBe('https://sketch.my.id');
  });

  test('a database created without plan_targets gains the table on open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-discover-'));
    const path = join(dir, 'macro.db');
    const legacy = new Database(path);
    legacy.exec('CREATE TABLE drafts (id TEXT PRIMARY KEY, traffic_event TEXT NOT NULL, created_at INTEGER NOT NULL)');
    legacy.exec("INSERT INTO drafts (id, traffic_event, created_at) VALUES ('old', 'traffic event here!!', 1)");
    legacy.exec('CREATE TABLE plans (hash TEXT PRIMARY KEY, text TEXT NOT NULL, approved_at INTEGER NOT NULL)');
    legacy.close();
    const store = new Store(path);
    const draft = store.getDraft('old');
    expect(draft?.origin).toBeNull();
    expect(draft?.routes).toBeNull();
    store.setDraftDiscovery('old', 'https://sketch.my.id', ROUTES);
    expect(store.getDraft('old')?.routes).toEqual(ROUTES);
    store.storeApprovedPlan({ hash: 'h-old', text: 'plan', approvedAt: 1 });
    store.storePlanTarget({ planHash: 'h-old', webOrigin: 'https://sketch.my.id', apiOrigin: 'https://sketch.my.id', routes: ROUTES });
    expect(store.getPlanTarget('h-old')?.routes).toEqual(ROUTES);
  });
});
