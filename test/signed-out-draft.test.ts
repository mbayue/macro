import { describe, expect, test } from 'bun:test';
import {
  clearSignedOutDraft,
  loadSignedOutDraft,
  SIGNED_OUT_DRAFT_KEY,
  stashSignedOutDraft,
} from '../web/landing/src/app/lib/draft-storage.ts';

function memoryStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('signed-out Traffic Description draft (sessionStorage)', () => {
  test('round-trips the text a signed-out user typed', () => {
    const storage = memoryStorage();
    stashSignedOutDraft('Ramp from 20 to 150 shoppers over 3 minutes.', storage);
    expect(loadSignedOutDraft(storage)).toBe('Ramp from 20 to 150 shoppers over 3 minutes.');
  });

  test('an empty or whitespace-only description removes the stored draft', () => {
    const storage = memoryStorage();
    stashSignedOutDraft('Some traffic', storage);
    stashSignedOutDraft('   ', storage);
    expect(storage.store.has(SIGNED_OUT_DRAFT_KEY)).toBe(false);
    expect(loadSignedOutDraft(storage)).toBeNull();
  });

  test('clearSignedOutDraft forgets the draft after a successful plan', () => {
    const storage = memoryStorage();
    stashSignedOutDraft('Some traffic', storage);
    clearSignedOutDraft(storage);
    expect(loadSignedOutDraft(storage)).toBeNull();
  });

  test('ignores malformed, wrong-shape or oversized stored values', () => {
    expect(loadSignedOutDraft(memoryStorage({ [SIGNED_OUT_DRAFT_KEY]: '{not json' }))).toBeNull();
    expect(loadSignedOutDraft(memoryStorage({ [SIGNED_OUT_DRAFT_KEY]: '"just a string"' }))).toBeNull();
    expect(loadSignedOutDraft(memoryStorage({ [SIGNED_OUT_DRAFT_KEY]: '{"text":42}' }))).toBeNull();
    expect(loadSignedOutDraft(memoryStorage({ [SIGNED_OUT_DRAFT_KEY]: JSON.stringify({ text: 'a'.repeat(20_001) }) }))).toBeNull();
    expect(loadSignedOutDraft(memoryStorage())).toBeNull();
  });

  test('storage failures are swallowed', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => stashSignedOutDraft('Some traffic', broken)).not.toThrow();
    expect(() => clearSignedOutDraft(broken)).not.toThrow();
    expect(loadSignedOutDraft(broken)).toBeNull();
  });
});
