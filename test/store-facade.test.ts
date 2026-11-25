import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContestedOriginError,
  LIMIT_ROW_TTL_MS,
  PURGE_INTERVAL_MS,
  Store,
} from '../src/store/db.ts';

const NOW = 1_770_000_000_000;

describe('Store facade seam', () => {
  test('re-exports limit constants and ContestedOriginError', () => {
    expect(LIMIT_ROW_TTL_MS).toBe(24 * 3_600_000);
    expect(PURGE_INTERVAL_MS).toBe(3_600_000);
    const err = new ContestedOriginError('shop.example.com');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('contested_origin');
  });

  test('Store.open creates macro.db with WAL mode and foreign keys enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-store-open-'));
    const nested = join(dir, 'nested');
    try {
      const store = Store.open(nested);
      try {
        expect(existsSync(join(nested, 'macro.db'))).toBe(true);
        const journal = store.db.prepare<{ journal_mode: string }, []>('PRAGMA journal_mode').get();
        const fk = store.db.prepare<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get();
        expect(journal?.journal_mode.toLowerCase()).toBe('wal');
        expect(fk?.foreign_keys).toBe(1);
      } finally {
        store.close();
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Windows SQLite WAL handle cleanup in temp dir
      }
    }
  });

  test('deleteUser atomically cascades across auth, verification, limits, and private runs', () => {
    const store = new Store(':memory:');
    try {
      const user = store.createUser('owner@example.com', NOW);
      const session = store.createSession(user.id, NOW, 60_000);
      store.linkIdentity(user.id, 'email', 'owner@example.com');
      store.setVerifiedOrigin(user.id, 'https://shop.example', 'shop.example', 'tok', NOW);
      store.putAccountDraft(user.id, {
        trafficEvent: 'Flash sale traffic',
        targetMode: 'own',
        targetOrigin: 'https://shop.example',
        lastEditedAt: NOW,
      });
      store.recordPlanningRequest(`user:${user.id}`, NOW);
      store.recordClientStart(`user:${user.id}`, NOW);

      store.storeApprovedPlan({ hash: 'h1', text: 'plan', approvedAt: NOW });
      store.createRun({
        id: 'run-private',
        kind: 'run',
        planHash: 'h1',
        runtime: 'runc',
        startedAt: NOW,
        ownerUserId: user.id,
        visibility: 'private',
      });
      store.startStage({ runId: 'run-private', idx: 0, vus: 10, durationSec: 10, startedAt: NOW });
      store.appendEvent({ runId: 'run-private', type: 'stage_start', stageIdx: 0, ts: NOW });
      store.saveReport({ runId: 'run-private', body: { ok: true }, aiStatus: 'unavailable' });

      store.createRun({
        id: 'run-public',
        kind: 'run',
        planHash: 'h1',
        runtime: 'runc',
        startedAt: NOW + 1,
        ownerUserId: user.id,
        visibility: 'public',
      });

      expect(store.deleteUser(user.id)).toBe(true);
      expect(store.deleteUser(user.id)).toBe(false);
      expect(store.getUser(user.id)).toBeNull();
      expect(store.getSession(session.id)).toBeNull();
      expect(store.getVerifiedOrigin(user.id)).toBeNull();
      expect(store.getAccountDraft(user.id)).toBeNull();
      expect(store.planningRequestTimestamps(`user:${user.id}`, 0)).toEqual([]);
      expect(store.clientStartTimestamps(`user:${user.id}`, 0)).toEqual([]);
      expect(store.getRun('run-private')).toBeNull();
      expect(store.getStages('run-private')).toEqual([]);
      expect(store.getReport('run-private')).toBeNull();
      expect(store.getRun('run-public')?.ownerUserId).toBeNull();
    } finally {
      store.close();
    }
  });

  test('onRunUpdate notifies on events and status changes, isolates errors, and unsubscribes', () => {
    const store = new Store(':memory:');
    try {
      store.createRun({
        id: 'run-1',
        kind: 'run',
        planHash: null,
        runtime: 'runc',
        startedAt: NOW,
      });

      let calls = 0;
      const unsubThrowing = store.onRunUpdate('run-1', () => {
        throw new Error('listener failure');
      });
      const unsubCounting = store.onRunUpdate('run-1', () => {
        calls++;
      });

      store.appendEvent({ runId: 'run-1', type: 'stage_start', stageIdx: 0, ts: NOW });
      expect(calls).toBe(1);

      expect(store.setRunStatus('run-1', 'completed', null, NOW + 1000)).toBe(true);
      expect(calls).toBe(2);

      unsubCounting();
      unsubThrowing();
      store.appendEvent({ runId: 'run-1', type: 'status', ts: NOW + 2000 });
      expect(calls).toBe(2);
    } finally {
      store.close();
    }
  });

  test('purgeOldLimitRows deletes only rows older than LIMIT_ROW_TTL_MS', () => {
    const store = new Store(':memory:');
    try {
      const staleTs = NOW - LIMIT_ROW_TTL_MS - 1;
      const boundaryTs = NOW - LIMIT_ROW_TTL_MS;
      const freshTs = NOW - 1000;

      store.recordPlanningRequest('198.51.100.1', staleTs);
      store.recordPlanningRequest('198.51.100.1', boundaryTs);
      store.recordClientStart('198.51.100.1', staleTs);
      store.recordClientStart('198.51.100.1', freshTs);

      expect(store.purgeOldLimitRows(NOW)).toBe(2);
      expect(store.planningRequestTimestamps('198.51.100.1', 0)).toEqual([boundaryTs]);
      expect(store.clientStartTimestamps('198.51.100.1', 0)).toEqual([freshTs]);
    } finally {
      store.close();
    }
  });

  test('markRunningInterrupted interrupts only running runs', () => {
    const store = new Store(':memory:');
    try {
      store.createRun({ id: 'r-run', kind: 'run', planHash: null, status: 'running', runtime: 'runc', startedAt: NOW });
      store.createRun({ id: 'r-queue', kind: 'run', planHash: null, status: 'queued', runtime: 'runc', startedAt: NOW + 1 });
      store.createRun({ id: 'r-done', kind: 'run', planHash: null, status: 'running', runtime: 'runc', startedAt: NOW + 2 });
      store.setRunStatus('r-done', 'completed', null, NOW + 10);

      expect(store.markRunningInterrupted(NOW + 100)).toBe(1);
      expect(store.getRun('r-run')?.status).toBe('interrupted');
      expect(store.getRun('r-run')?.statusReason).toBe('macro-api restarted');
      expect(store.getRun('r-queue')?.status).toBe('queued');
      expect(store.getRun('r-done')?.status).toBe('completed');
    } finally {
      store.close();
    }
  });
});
