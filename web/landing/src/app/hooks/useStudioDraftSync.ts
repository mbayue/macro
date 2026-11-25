/**
 * Test Studio draft and review persistence hook:
 * - Signed-out `sessionStorage` draft persistence via `draft-storage.ts`
 * - Review state stashing across navigation/reloads for the matching account
 * - Post-sign-in local-to-server draft merge and remote account draft hydration
 * - `PUT /api/draft` conflict resolution with polite live-region announcement
 */
import { type RefObject, useEffect, useRef, useState } from 'react';
import type { AccountDraft, MeResponse, PlanResponse } from '../../../../../src/api-types.ts';
import type { TargetMode } from '../components/studio/studio-view.ts';
import type { ApiResult } from '../lib/api.ts';
import { getDraft, putDraft } from '../lib/auth-api.ts';
import {
  clearReviewState,
  clearSignedOutDraft,
  type DraftStorage,
  loadReviewState,
  loadSignedOutDraft,
  stashLocalDraft,
  stashReviewState,
  stashSignedOutDraft,
  type StashedReview,
  takeLocalDraft,
} from '../lib/draft-storage.ts';

export interface InitialStudioDraft {
  text: string;
  lastSubmitted: string | null;
  review: PlanResponse | null;
  editing: boolean;
  targetMode: TargetMode;
}

/** Restores an in-progress Plan Review for the current owner or falls back to any signed-out draft. */
export function resolveInitialStudioDraft(
  ownerUserId: string | null,
  storage?: DraftStorage | null,
): InitialStudioDraft {
  const initialReview = loadReviewState(ownerUserId, storage);
  return {
    text: initialReview?.lastSubmitted ?? loadSignedOutDraft(storage) ?? '',
    lastSubmitted: initialReview?.lastSubmitted ?? null,
    review: initialReview?.review ?? null,
    editing: initialReview?.editing ?? false,
    targetMode: initialReview?.targetMode ?? 'demo',
  };
}

/** Builds an `AccountDraft` payload, attaching `targetOrigin` only for a verified Own Site target. */
export function buildAccountDraft({
  trafficEvent,
  targetMode,
  verifiedOrigin,
  lastEditedAt,
}: {
  trafficEvent: string;
  targetMode: TargetMode;
  verifiedOrigin: { origin: string; host: string } | null;
  lastEditedAt: number;
}): AccountDraft {
  return {
    trafficEvent,
    targetMode,
    targetOrigin: targetMode === 'own' && verifiedOrigin !== null ? verifiedOrigin.origin : null,
    lastEditedAt,
  };
}

export interface SyncDraftDeps {
  putDraft: (draft: AccountDraft) => Promise<ApiResult<AccountDraft> & { conflict?: AccountDraft }>;
  applyDraft: (draft: AccountDraft) => void;
  setLastEditedAt: (ts: number) => void;
  announce: (message: string) => void;
  isAlive?: () => boolean;
}

/** Sends a draft to `PUT /api/draft` and resolves 409 conflicts by loading the newer server draft. */
export async function syncDraftWithServer(
  draft: AccountDraft,
  deps: SyncDraftDeps,
): Promise<AccountDraft | null> {
  const res = await deps.putDraft(draft);
  if (deps.isAlive && !deps.isAlive()) return null;
  if (!res.ok) return null;
  if (res.conflict) {
    deps.applyDraft(res.conflict);
    deps.announce('Loaded a newer draft from your account.');
    return res.conflict;
  }
  deps.setLastEditedAt(res.data.lastEditedAt);
  return res.data;
}

export interface HydrateDraftDeps extends SyncDraftDeps {
  takeLocalDraft: () => AccountDraft | null;
  getDraft: () => Promise<ApiResult<AccountDraft>>;
  loadReviewState: (ownerUserId: string | null) => StashedReview | null;
}

/** Merges any pre-sign-in local draft to the account, then loads the server draft unless a review is active. */
export async function hydrateSignedInDraft(
  userId: string,
  deps: HydrateDraftDeps,
): Promise<AccountDraft | null> {
  const local = deps.takeLocalDraft();
  if (local !== null) await syncDraftWithServer(local, deps);
  if (deps.isAlive && !deps.isAlive()) return null;
  const remote = await deps.getDraft();
  if ((deps.isAlive && !deps.isAlive()) || !remote.ok) return null;
  if (deps.loadReviewState(userId) === null && remote.data.lastEditedAt > 0) {
    deps.applyDraft(remote.data);
    return remote.data;
  }
  return null;
}

export interface UseStudioDraftSyncOptions {
  me: MeResponse | null;
  announce: (message: string) => void;
  alive: RefObject<boolean>;
}

/** Manages Test Studio draft text, target mode, browser/account sync, and Plan Review stashing. */
export function useStudioDraftSync({ me, announce, alive }: UseStudioDraftSyncOptions) {
  const [initial] = useState(() => resolveInitialStudioDraft(me?.user.id ?? null));
  const [text, setText] = useState(initial.text);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(initial.lastSubmitted);
  const [review, setReview] = useState<PlanResponse | null>(initial.review);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [editing, setEditing] = useState(initial.editing);
  const [targetMode, setTargetMode] = useState<TargetMode>(initial.targetMode);
  const [lastEditedAt, setLastEditedAt] = useState(() => Date.now());
  const draftHydrated = useRef(false);
  const announceRef = useRef(announce);
  const verifiedOrigin = me?.verifiedOrigin ?? null;

  useEffect(() => {
    announceRef.current = announce;
  }, [announce]);

  useEffect(() => {
    const ownerUserId = me?.user.id ?? null;
    if (review === null) {
      clearReviewState();
      return;
    }
    stashReviewState({ ownerUserId, review, lastSubmitted, editing, targetMode });
  }, [me, review, lastSubmitted, editing, targetMode]);

  // Signed-out users have no server draft: keep their text in this tab across navigation and reload.
  // Once signed in, the account draft takes over and the browser copy is dropped.
  useEffect(() => {
    if (me === null) stashSignedOutDraft(text);
    else clearSignedOutDraft();
  }, [me, text]);

  function applyDraft(d: AccountDraft) {
    setText(d.trafficEvent);
    setTargetMode(d.targetMode);
    setLastEditedAt(d.lastEditedAt);
  }

  async function syncDraftToServer(draft: AccountDraft): Promise<AccountDraft | null> {
    if (me === null) return null;
    return syncDraftWithServer(draft, {
      putDraft,
      applyDraft,
      setLastEditedAt,
      announce: (msg) => announceRef.current(msg),
      isAlive: () => alive.current,
    });
  }

  // After sign-in: merge stashed browser draft, then load the account draft.
  useEffect(() => {
    if (me === null) {
      draftHydrated.current = false;
      return;
    }
    if (draftHydrated.current) return;
    draftHydrated.current = true;
    void hydrateSignedInDraft(me.user.id, {
      takeLocalDraft,
      putDraft,
      getDraft,
      loadReviewState,
      applyDraft,
      setLastEditedAt,
      announce: (msg) => announceRef.current(msg),
      isAlive: () => alive.current,
    });
  }, [me, alive]);

  function updateText(next: string) {
    setText(next);
    setLastEditedAt(Date.now());
  }

  function selectTargetMode(mode: TargetMode) {
    setTargetMode(mode);
    setLastEditedAt(Date.now());
  }

  function stashPendingOwnDraft(modeOverride?: TargetMode) {
    stashLocalDraft(
      buildAccountDraft({
        trafficEvent: text,
        targetMode: modeOverride ?? targetMode,
        verifiedOrigin: null,
        lastEditedAt: Date.now(),
      }),
    );
  }

  function syncCurrentDraftOnBlur() {
    if (me === null || text.trim() === '') return;
    void syncDraftToServer(
      buildAccountDraft({
        trafficEvent: text,
        targetMode,
        verifiedOrigin,
        lastEditedAt,
      }),
    );
  }

  async function syncBeforePlan(value: string) {
    const edited = Date.now();
    setLastEditedAt(edited);
    if (me === null) return;
    await syncDraftToServer(
      buildAccountDraft({
        trafficEvent: value,
        targetMode,
        verifiedOrigin,
        lastEditedAt: edited,
      }),
    );
  }

  function beginPlan(value: string, preserveReview: boolean) {
    setLastSubmitted(value);
    if (!preserveReview) setReview(null);
  }

  function applyPlannedReview(nextReview: PlanResponse) {
    clearSignedOutDraft();
    setReview(nextReview);
    setReviewSeq((s) => s + 1);
    setEditing(false);
  }

  function startEditDescription() {
    setEditing(true);
  }

  function keepPlan() {
    if (lastSubmitted !== null) setText(lastSubmitted);
    setEditing(false);
  }

  function discardPlan() {
    clearReviewState();
    setReview(null);
    setEditing(false);
  }

  return {
    text,
    lastSubmitted,
    review,
    reviewSeq,
    editing,
    targetMode,
    updateText,
    selectTargetMode,
    stashPendingOwnDraft,
    syncCurrentDraftOnBlur,
    syncBeforePlan,
    beginPlan,
    applyPlannedReview,
    startEditDescription,
    keepPlan,
    discardPlan,
    clearReview: clearReviewState,
  };
}
