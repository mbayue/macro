import { describe, expect, test } from 'bun:test';
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
});
