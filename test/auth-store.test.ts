import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/db.ts';

describe('auth store primitives', () => {
  test('createSession + touchSession slides expiresAt', () => {
    const store = new Store(':memory:');
    const user = store.createUser('a@example.com', 1_000);
    const s = store.createSession(user.id, 1_000, 60_000);
    expect(s.expiresAt).toBe(61_000);
    const touched = store.touchSession(s.id, 20_000, 60_000);
    expect(touched?.expiresAt).toBe(80_000);
  });

  test('setVerifiedOrigin refuses host owned by another user', () => {
    const store = new Store(':memory:');
    const a = store.createUser('a@example.com', 1);
    const b = store.createUser('b@example.com', 1);
    store.setVerifiedOrigin(a.id, 'https://shop.example', 'shop.example', 'tok', 1);
    expect(() => store.setVerifiedOrigin(b.id, 'https://shop.example', 'shop.example', 'tok2', 2)).toThrow(
      /contested|owned/i,
    );
  });

  test('linkIdentity and findUserByIdentity support google provider', () => {
    const store = new Store(':memory:');
    const user = store.createUser('g@example.com', 1_000);
    store.linkIdentity(user.id, 'google', 'google-sub-1');
    const found = store.findUserByIdentity('google', 'google-sub-1');
    expect(found?.id).toBe(user.id);
    expect(found?.primaryEmail).toBe('g@example.com');
  });

  test('migrates existing auth_identities table to allow google provider', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-auth-mig-'));
    const dbPath = join(dir, 'macro.db');
    try {
      const raw = new Database(dbPath);
      raw.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, primary_email TEXT NOT NULL UNIQUE, github_login TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE auth_identities (
          provider TEXT NOT NULL CHECK (provider IN ('email','github')),
          provider_subject TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (provider, provider_subject)
        );
        INSERT INTO users (id, primary_email, github_login, created_at) VALUES ('u1', 'u@example.com', NULL, 1);
        INSERT INTO auth_identities (provider, provider_subject, user_id) VALUES ('email', 'u@example.com', 'u1');
      `);
      raw.close();

      const store = new Store(dbPath);
      try {
        store.linkIdentity('u1', 'google', 'sub-999');
        expect(store.findUserByIdentity('google', 'sub-999')?.id).toBe('u1');
        expect(store.findUserByIdentity('email', 'u@example.com')?.id).toBe('u1');
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
});
