/**
 * Browser sessionStorage helpers for Test Studio draft and review persistence.
 * Storage errors (private mode, quota, SSR) are swallowed cleanly.
 */
import type { AccountDraft, PlanResponse } from '../../../../../src/api-types.ts';

const LOCAL_DRAFT_KEY = 'macro.accountDraft.v1';
const LOCAL_REVIEW_KEY = 'macro.draftReview.v1';

/** sessionStorage key for the Traffic Description a signed-out user is typing (signed-in users get a server draft). */
export const SIGNED_OUT_DRAFT_KEY = 'macro.signedOutDraft.v1';
const SIGNED_OUT_DRAFT_MAX_CHARS = 20_000;

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): DraftStorage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export interface StashedReview {
  ownerUserId: string | null;
  review: PlanResponse;
  lastSubmitted: string | null;
  editing: boolean;
  targetMode: 'demo' | 'own';
}

export function stashReviewState(state: StashedReview, storage: DraftStorage | null = sessionStore()): void {
  if (storage === null) return;
  try {
    storage.setItem(LOCAL_REVIEW_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadReviewState(
  ownerUserId: string | null,
  storage: DraftStorage | null = sessionStore(),
): StashedReview | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(LOCAL_REVIEW_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as StashedReview;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.ownerUserId !== ownerUserId ||
      typeof parsed.review !== 'object' ||
      parsed.review === null ||
      typeof parsed.review.draftId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearReviewState(storage: DraftStorage | null = sessionStore()): void {
  if (storage === null) return;
  try {
    storage.removeItem(LOCAL_REVIEW_KEY);
  } catch {
    /* ignore */
  }
}

export function stashLocalDraft(draft: AccountDraft, storage: DraftStorage | null = sessionStore()): void {
  if (storage === null) return;
  try {
    storage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota / private mode */
  }
}

export function takeLocalDraft(storage: DraftStorage | null = sessionStore()): AccountDraft | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(LOCAL_DRAFT_KEY);
    if (raw === null) return null;
    storage.removeItem(LOCAL_DRAFT_KEY);
    const parsed = JSON.parse(raw) as AccountDraft;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.trafficEvent !== 'string' ||
      typeof parsed.lastEditedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Keeps a signed-out user's Traffic Description across navigation and reload; empty text removes it. */
export function stashSignedOutDraft(text: string, storage: DraftStorage | null = sessionStore()): void {
  if (storage === null) return;
  try {
    if (text.trim() === '') storage.removeItem(SIGNED_OUT_DRAFT_KEY);
    else storage.setItem(SIGNED_OUT_DRAFT_KEY, JSON.stringify({ text }));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Reads the stashed signed-out Traffic Description, or null when missing or not a valid draft. */
export function loadSignedOutDraft(storage: DraftStorage | null = sessionStore()): string | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(SIGNED_OUT_DRAFT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const text = (parsed as { text?: unknown }).text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > SIGNED_OUT_DRAFT_MAX_CHARS) return null;
    return text;
  } catch {
    return null;
  }
}

export function clearSignedOutDraft(storage: DraftStorage | null = sessionStore()): void {
  if (storage === null) return;
  try {
    storage.removeItem(SIGNED_OUT_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
