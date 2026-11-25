import { describe, expect, test } from 'bun:test';
import type { AccountDraft, PlanResponse } from '../src/api-types.ts';
import {
  clearReviewState,
  clearSignedOutDraft,
  loadReviewState,
  loadSignedOutDraft,
  SIGNED_OUT_DRAFT_KEY,
  stashLocalDraft,
  stashReviewState,
  stashSignedOutDraft,
  type StashedReview,
  takeLocalDraft,
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

function brokenStorage() {
  return {
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
}

const samplePlan: PlanResponse = {
  draftId: 'draft_1',
  plan: null,
  planText: null,
  planHash: null,
  rationale: null,
  gate: null,
  parseError: null,
  modelCalls: [],
  routes: [],
};

describe('draft-storage review state helpers', () => {
  test('round-trips StashedReview for matching ownerUserId and ignores mismatched owner', () => {
    const storage = memoryStorage();
    const state: StashedReview = {
      ownerUserId: 'user_1',
      review: samplePlan,
      lastSubmitted: '25 shoppers for 2m',
      editing: false,
      targetMode: 'demo',
    };

    stashReviewState(state, storage);
    expect(loadReviewState('user_1', storage)).toEqual(state);
    expect(loadReviewState('user_2', storage)).toBeNull();
    expect(loadReviewState(null, storage)).toBeNull();

    clearReviewState(storage);
    expect(loadReviewState('user_1', storage)).toBeNull();
  });

  test('ignores malformed review state and swallows storage errors', () => {
    const storage = memoryStorage({ 'macro.draftReview.v1': '{broken' });
    expect(loadReviewState(null, storage)).toBeNull();

    const broken = brokenStorage();
    expect(() =>
      stashReviewState(
        { ownerUserId: null, review: samplePlan, lastSubmitted: null, editing: false, targetMode: 'demo' },
        broken,
      ),
    ).not.toThrow();
    expect(loadReviewState(null, broken)).toBeNull();
    expect(() => clearReviewState(broken)).not.toThrow();
  });
});

describe('draft-storage local draft handoff helpers', () => {
  test('stashLocalDraft and takeLocalDraft round-trip once and clear storage', () => {
    const storage = memoryStorage();
    const draft: AccountDraft = {
      trafficEvent: 'Spike to 100 VUs',
      targetMode: 'own',
      targetOrigin: 'https://example.com',
      lastEditedAt: 1_700_000_000_000,
    };

    stashLocalDraft(draft, storage);
    expect(takeLocalDraft(storage)).toEqual(draft);
    expect(takeLocalDraft(storage)).toBeNull();
  });

  test('takeLocalDraft rejects invalid shapes and swallows storage errors', () => {
    expect(takeLocalDraft(memoryStorage({ 'macro.accountDraft.v1': 'null' }))).toBeNull();
    expect(takeLocalDraft(memoryStorage({ 'macro.accountDraft.v1': '{"trafficEvent":123}' }))).toBeNull();

    const broken = brokenStorage();
    expect(() =>
      stashLocalDraft({ trafficEvent: 'x', targetMode: 'demo', targetOrigin: null, lastEditedAt: 1 }, broken),
    ).not.toThrow();
    expect(takeLocalDraft(broken)).toBeNull();
  });
});

describe('draft-storage signed-out draft re-export', () => {
  test('signed-out draft helpers live in draft-storage.ts', () => {
    const storage = memoryStorage();
    stashSignedOutDraft('Checkout burst', storage);
    expect(storage.store.has(SIGNED_OUT_DRAFT_KEY)).toBe(true);
    expect(loadSignedOutDraft(storage)).toBe('Checkout burst');
    clearSignedOutDraft(storage);
    expect(loadSignedOutDraft(storage)).toBeNull();
  });
});
