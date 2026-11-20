/**
 * Test Studio (`#/`): pick a target (`Demo Target` or `Own Site`), describe the traffic,
 * draft a plan, review it against the Policy Gate, and approve or cancel.
 * Nothing reaches the target until "Approve and run".
 */
import { useEffect, useRef, useState } from 'react';
import type { AccountDraft, DemoTrendsResponse, PlanResponse, QuotaResponse } from '../../../../../src/api-types.ts';
import {
  clearReviewState,
  getDraft,
  loadReviewState,
  postVerifyClear,
  putDraft,
  stashLocalDraft,
  stashReviewState,
  takeLocalDraft,
} from '../lib/auth-api.ts';
import { type ApiError, type ApiResult, getDemoTrends, getQuota, postPlan, VERIFICATION_ERROR } from '../lib/api.ts';
import { NextUp } from '../components/NextUp.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { VerifyPanel } from '../components/VerifyPanel.tsx';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useApp } from '../context.tsx';
import { ApproveBar, GateSidebar } from '../components/studio/GateSidebar.tsx';
import { PlanBrief, PlanReview } from '../components/studio/PlanReview.tsx';
import { TargetPicker } from '../components/studio/TargetPicker.tsx';
import { TrafficComposer } from '../components/studio/TrafficComposer.tsx';
import {
  isApprovable,
  isVerifyPanelHash,
  resolveTargetState,
  type StudioBusy,
  type TargetMode,
  validateTrafficLength,
} from '../components/studio/studio-view.ts';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function NewTest() {
  const { config, me, refreshMe, navigate, announce } = useApp();
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;

  const initialReview = loadReviewState(me?.user.id ?? null);
  const [text, setText] = useState(() => initialReview?.lastSubmitted ?? '');
  const [busy, setBusy] = useState<StudioBusy>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(() => initialReview?.lastSubmitted ?? null);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const [review, setReview] = useState<PlanResponse | null>(() => initialReview?.review ?? null);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [editing, setEditing] = useState(() => initialReview?.editing ?? false);
  const [panelInView, setPanelInView] = useState(true);
  const [targetMode, setTargetMode] = useState<TargetMode>(() => initialReview?.targetMode ?? 'demo');
  const [lastEditedAt, setLastEditedAt] = useState(() => Date.now());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const startFromBar = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const draftHydrated = useRef(false);
  const draftTurnstile = useTurnstile();
  const [demoTrends, setDemoTrends] = useState<DemoTrendsResponse | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [checksDiffer, setChecksDiffer] = useState(false);

  useEffect(() => () => void (alive.current = false), []);

  useEffect(() => {
    const abort = new AbortController();
    void getDemoTrends(abort.signal).then((res) => {
      if (!abort.signal.aborted && res.ok) setDemoTrends(res.data);
    });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void getQuota(abort.signal).then((res) => {
      if (!abort.signal.aborted && res.ok) setQuota(res.data);
    });
    return () => abort.abort();
  }, [me?.user.id, review?.planHash]);

  useEffect(() => {
    const ownerUserId = me?.user.id ?? null;
    if (review === null) {
      clearReviewState();
      return;
    }
    stashReviewState({ ownerUserId, review, lastSubmitted, editing, targetMode });
  }, [me, review, lastSubmitted, editing, targetMode]);

  // The text box may only mount on this render (after "Edit description" or a discarded plan).
  useEffect(() => {
    if (focusComposer.current && textarea.current) {
      focusComposer.current = false;
      textarea.current.focus();
    }
  });

  const { count, inRange, problem } = validateTrafficLength(text, min, max);
  const idle = busy === null;
  const changedSinceDraft = lastSubmitted !== null && text.trim() !== lastSubmitted;
  const showRetry = planError?.code === 'planning_failed' && !changedSinceDraft;
  const approvable = review !== null && isApprovable(review);
  const showComposer = review === null || editing;
  const openedVerify = isVerifyPanelHash(window.location.hash);
  const { verifiedOrigin, ownNeedsVerify, activeOrigin, pendingHost, showVerify } = resolveTargetState({
    targetMode,
    me,
    webOrigin: config.webOrigin,
    openedVerify,
  });

  function currentDraft(): AccountDraft {
    return {
      trafficEvent: text,
      targetMode,
      targetOrigin: targetMode === 'own' && verifiedOrigin !== null ? verifiedOrigin.origin : null,
      lastEditedAt,
    };
  }

  function applyDraft(d: AccountDraft) {
    setText(d.trafficEvent);
    setTargetMode(d.targetMode);
    setLastEditedAt(d.lastEditedAt);
  }

  async function syncDraftToServer(draft: AccountDraft): Promise<AccountDraft | null> {
    if (me === null) return null;
    const res = await putDraft(draft);
    if (!res.ok) return null;
    if (res.conflict) {
      applyDraft(res.conflict);
      announce('Loaded a newer draft from your account.');
      return res.conflict;
    }
    setLastEditedAt(res.data.lastEditedAt);
    return res.data;
  }

  // After sign-in: merge stashed browser draft, then load the account draft.
  useEffect(() => {
    if (me === null) {
      draftHydrated.current = false;
      return;
    }
    if (draftHydrated.current) return;
    draftHydrated.current = true;
    void (async () => {
      const local = takeLocalDraft();
      if (local !== null) await syncDraftToServer(local);
      const remote = await getDraft();
      if (!alive.current || !remote.ok) return;
      if (loadReviewState(me.user.id) === null && remote.data.lastEditedAt > 0) applyDraft(remote.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (!openedVerify) return;
    setTargetMode('own');
    const panel = document.getElementById('verify-panel');
    panel?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [openedVerify, pendingHost, showVerify]);

  function chooseTarget(mode: TargetMode) {
    if (!idle) return;
    if (mode === 'own' && me === null) {
      const draft = { ...currentDraft(), targetMode: 'own' as const, lastEditedAt: Date.now() };
      stashLocalDraft(draft);
      navigate('/sign-in');
      return;
    }
    setTargetMode(mode);
    setLastEditedAt(Date.now());
    setPlanError(null);
  }

  async function clearVerifiedOrigin() {
    if (!idle || me === null) return;
    const res = await postVerifyClear();
    if (res.ok) {
      await refreshMe();
      announce('Cleared verified origin.');
    }
  }

  async function startPlanning(value: string, routeIds?: string[]) {
    if (!idle || validateTrafficLength(value, min, max).inRange === false) return;
    if (targetMode === 'own' && me === null) {
      stashLocalDraft({ ...currentDraft(), lastEditedAt: Date.now() });
      navigate('/sign-in');
      return;
    }
    if (targetMode === 'own' && verifiedOrigin === null) {
      setPlanError({
        code: 'verification_required',
        message: 'Verify your site before drafting an own-site plan.',
      });
      announce('Verify your site before drafting an own-site plan.');
      return;
    }
    const edited = Date.now();
    setLastEditedAt(edited);
    if (me !== null) {
      await syncDraftToServer({
        trafficEvent: value,
        targetMode,
        targetOrigin: targetMode === 'own' && verifiedOrigin !== null ? verifiedOrigin.origin : null,
        lastEditedAt: edited,
      });
    }
    setBusy('planning');
    setLastSubmitted(value);
    setPlanError(null);
    if (routeIds === undefined) {
      setReview(null);
      setChecksDiffer(false);
    }
    announce('Drafting a plan.');
    let result: ApiResult<PlanResponse>;
    try {
      const token = await draftTurnstile.token();
      result = await postPlan({
        trafficEvent: value,
        turnstileToken: token,
        targetMode,
        ...(targetMode === 'own' && verifiedOrigin !== null ? { targetOrigin: verifiedOrigin.origin } : {}),
        ...(routeIds !== undefined ? { routeIds } : {}),
      });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      draftTurnstile.reset();
    }
    if (!alive.current) return;
    setBusy(null);
    if (result.ok) {
      setReview(result.data);
      setReviewSeq((s) => s + 1);
      setEditing(false);
    } else {
      setPlanError(result.error);
      announce(result.error.message);
    }
  }

  function editDescription() {
    if (!idle) return;
    setEditing(true);
    focusComposer.current = true;
  }

  function keepPlan() {
    if (lastSubmitted !== null) setText(lastSubmitted);
    setEditing(false);
  }

  function cancelPlan() {
    if (!idle) return;
    clearReviewState();
    setReview(null);
    setEditing(false);
    focusComposer.current = true;
    announce('Plan discarded. Nothing was sent.');
  }

  const onStarted = (runId: string) => {
    clearReviewState();
    navigate(`/run/${encodeURIComponent(runId)}`);
  };

  return (
    <div className={cn('mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6', approvable && 'max-[1179px]:pb-24')}>
      <header className="grid gap-2">
        <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
          Test Studio
        </h1>
        <p className="max-w-[64ch] text-muted-foreground">
          Describe the traffic you expect. Macro drafts a staged plan, fixed rules check it, and nothing runs until you approve.
        </p>
      </header>

      {config.runtimeError ? (
        <div className="grid justify-items-start gap-1.5 rounded-md border border-bad px-4 py-3.5 text-sm" role="status">
          <Badge variant="destructive">Runtime problem</Badge>
          <p className="text-foreground">Runs cannot start until this is fixed: {config.runtimeError}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {showComposer ? (
            <>
              <TargetPicker
                targetMode={targetMode}
                webOrigin={config.webOrigin}
                me={me}
                verifiedOrigin={verifiedOrigin}
                showVerify={showVerify}
                disabled={!idle}
                onChooseTarget={chooseTarget}
                onClearVerifiedOrigin={() => void clearVerifiedOrigin()}
              />
              <TrafficComposer
                text={text}
                min={min}
                max={max}
                count={count}
                inRange={inRange}
                problem={problem}
                busy={busy}
                hasReview={review !== null}
                editing={editing}
                showRetry={showRetry}
                ownNeedsVerify={ownNeedsVerify}
                examples={config.examples}
                assistantRoutes={targetMode === 'demo' ? config.catalog.map((r) => `${r.method} ${r.path}`) : []}
                planError={planError}
                textareaRef={textarea}
                onTextChange={(next) => {
                  setText(next);
                  setLastEditedAt(Date.now());
                }}
                onBlurSync={() => {
                  if (me !== null && text.trim() !== '') void syncDraftToServer(currentDraft());
                }}
                onSubmitDraft={() => void startPlanning(text.trim())}
                onKeepPlan={keepPlan}
                onRetry={() => lastSubmitted !== null && void startPlanning(lastSubmitted)}
                onApplyAssistant={(nextDraft) => {
                  setText(nextDraft);
                  setLastEditedAt(Date.now());
                  textarea.current?.focus();
                }}
              />
            </>
          ) : (
            <>
              <PlanBrief text={lastSubmitted ?? text} origin={activeOrigin} disabled={!idle} onEdit={editDescription} />
              {/* Keep VerifyPanel reachable after drafting if the user opened #/verify-panel directly. */}
              {openedVerify ? (
                <div id="verify-panel" className="scroll-mt-20">
                  <VerifyPanel initialHost="" />
                </div>
              ) : null}
            </>
          )}

          {/* Outside the form: the form folds away after a draft, and the widget must not lose its container. */}
          <TurnstileBox boxRef={draftTurnstile.box} />

          {review ? (
            <PlanReview
              key={reviewSeq}
              res={review}
              stale={editing && changedSinceDraft}
              busy={busy}
              onEdit={editDescription}
              onRevise={(ids) => lastSubmitted !== null && void startPlanning(lastSubmitted, ids)}
              onChecksDiffer={setChecksDiffer}
            />
          ) : busy === null && !ownNeedsVerify ? (
            <NextUp />
          ) : null}
        </div>

        <GateSidebar
          review={review}
          activeOrigin={activeOrigin}
          targetMode={targetMode}
          verifiedOrigin={verifiedOrigin}
          showVerify={showVerify}
          quota={quota}
          demoTrends={demoTrends}
          sampleRunId={config.sampleRunId}
          busy={busy}
          reviewSeq={reviewSeq}
          checksDiffer={checksDiffer}
          alive={alive}
          startFromBar={startFromBar}
          onBusyChange={setBusy}
          onCancelPlan={cancelPlan}
          onStarted={onStarted}
          onInViewChange={setPanelInView}
        />
      </div>

      {approvable && review?.plan ? (
        <ApproveBar
          plan={review.plan}
          hidden={panelInView}
          disabled={!idle || checksDiffer}
          onApprove={() => startFromBar.current?.()}
        />
      ) : null}
    </div>
  );
}
