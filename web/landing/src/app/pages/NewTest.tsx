/**
 * Test Studio (`#/`): pick a target (`Demo Target` or `Own Site`), describe the traffic,
 * draft a plan, review it against the Policy Gate, and approve or cancel.
 * Nothing reaches the target until "Approve & Run".
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { DemoTrendsResponse, PlanResponse } from '../../../../../src/api-types.ts';
import { type ApiError, type ApiResult, getDemoTrends, postPlan, VERIFICATION_ERROR } from '../lib/api.ts';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { NextUp } from '../components/NextUp.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '../components/shell/ShellContext.tsx';
import { useApp } from '../context.tsx';
import { DemoBaselinePanel } from '../components/studio/DemoBaselinePanel.tsx';
import { ApproveBar, GateSidebar } from '../components/studio/GateSidebar.tsx';
import { PlanBrief, PlanReview } from '../components/studio/PlanReview.tsx';
import { TargetPicker } from '../components/studio/TargetPicker.tsx';
import { StageBand } from '../components/studio/TelemetryFrame.tsx';
import { TrafficComposer } from '../components/studio/TrafficComposer.tsx';
import {
  isApprovable,
  resolveTargetState,
  type StudioBusy,
  type TargetMode,
  validateTrafficLength,
} from '../components/studio/studio-view.ts';
import { useFirebaseStudioFeed } from '../hooks/useFirebaseStudioFeed.ts';
import { useStudioDraftSync } from '../hooks/useStudioDraftSync.ts';

export type StudioRequestState =
  | { kind: 'idle'; error: ApiError | null }
  | { kind: 'planning' }
  | { kind: 'approving' };

export type StudioRequestEvent =
  | { type: 'set_busy'; busy: StudioBusy }
  | { type: 'clear_error' }
  | { type: 'fail'; error: ApiError };

export function studioRequestReducer(state: StudioRequestState, event: StudioRequestEvent): StudioRequestState {
  switch (event.type) {
    case 'set_busy':
      if (event.busy === 'planning') return state.kind === 'idle' ? { kind: 'planning' } : state;
      if (event.busy === 'approving') return state.kind === 'idle' ? { kind: 'approving' } : state;
      return { kind: 'idle', error: null };
    case 'clear_error':
      return state.kind === 'idle' && state.error !== null ? { kind: 'idle', error: null } : state;
    case 'fail':
      return { kind: 'idle', error: event.error };
  }
}

export function NewTest() {
  const { config, me, navigate, announce } = useApp();
  const shell = useOptionalShell();
  const setTargetModeOverride = shell?.actions.setTargetModeOverride;
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;

  const alive = useRef(true);
  const draft = useStudioDraftSync({ me, announce, alive });
  const { text, lastSubmitted, review, reviewSeq, editing, targetMode } = draft;
  const { examples, featuredRuns, announcement, dismissAnnouncement } = useFirebaseStudioFeed({
    firebase: config.firebase,
    examples: config.examples,
    sampleRunId: config.sampleRunId,
  });

  const [requestState, dispatchRequest] = useReducer(studioRequestReducer, { kind: 'idle', error: null });
  const busy: StudioBusy =
    requestState.kind === 'planning'
      ? 'planning'
      : requestState.kind === 'approving'
        ? 'approving'
        : null;
  const planError = requestState.kind === 'idle' ? requestState.error : null;
  const setBusy = (next: StudioBusy) => dispatchRequest({ type: 'set_busy', busy: next });
  const [panelInView, setPanelInView] = useState(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const startFromBar = useRef<(() => void) | null>(null);
  const draftTurnstile = useTurnstile();
  const [demoTrends, setDemoTrends] = useState<DemoTrendsResponse | null>(null);
  const [pendingRouteIds, setPendingRouteIds] = useState<string[] | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setTargetModeOverride?.(targetMode);
    return () => setTargetModeOverride?.(null);
  }, [setTargetModeOverride, targetMode]);

  useEffect(() => {
    const abort = new AbortController();
    void getDemoTrends(abort.signal).then((res) => {
      if (!abort.signal.aborted && res.ok) setDemoTrends(res.data);
    });
    return () => abort.abort();
  }, []);

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
  const { verifiedOrigin, ownNeedsVerify, activeOrigin } = resolveTargetState({
    targetMode,
    me,
    webOrigin: config.webOrigin,
  });

  function chooseTarget(mode: TargetMode) {
    if (!idle) return;
    if (mode === 'own' && me === null) {
      draft.stashPendingOwnDraft('own');
      navigate('/sign-in');
      return;
    }
    draft.selectTargetMode(mode);
    dispatchRequest({ type: 'clear_error' });
  }

  async function startPlanning(value: string, routeIds?: string[]) {
    if (!idle || validateTrafficLength(value, min, max).inRange === false) return;
    if (targetMode === 'own' && me === null) {
      draft.stashPendingOwnDraft();
      navigate('/sign-in');
      return;
    }
    if (targetMode === 'own' && verifiedOrigin === null) {
      dispatchRequest({
        type: 'fail',
        error: {
          code: 'verification_required',
          message: 'Verify your site before drafting an own-site plan.',
        },
      });
      announce('Verify your site before drafting an own-site plan.');
      return;
    }
    await draft.syncBeforePlan(value);
    if (!alive.current) return;
    setBusy('planning');
    draft.beginPlan(value, routeIds !== undefined);
    if (routeIds === undefined) {
      setPendingRouteIds(null);
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
    if (result.ok) {
      setBusy(null);
      draft.applyPlannedReview(result.data);
      setPendingRouteIds(null);
    } else {
      dispatchRequest({ type: 'fail', error: result.error });
      announce(result.error.message);
    }
  }

  function editDescription() {
    if (!idle) return;
    draft.startEditDescription();
    focusComposer.current = true;
  }

  function cancelPlan() {
    if (!idle) return;
    draft.discardPlan();
    focusComposer.current = true;
    announce('Plan discarded. Nothing was sent.');
  }

  const onStarted = (runId: string) => {
    draft.clearReview();
    navigate(`/run/${encodeURIComponent(runId)}`);
  };

  return (
    <div className={cn('mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-5', approvable && 'max-[1179px]:pb-24')}>
      <header className="flex flex-col justify-between gap-4 min-[861px]:flex-row min-[861px]:items-end">
        <div className="grid gap-1.5">
          <StageBand />
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Test Studio
          </h1>
        </div>

        {showComposer ? (
          <TargetPicker
            targetMode={targetMode}
            webOrigin={config.webOrigin}
            me={me}
            verifiedOrigin={verifiedOrigin}
            disabled={!idle}
            onChooseTarget={chooseTarget}
          />
        ) : null}
      </header>

      {announcement ? (
        <div
          role="status"
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm',
            announcement.tone === 'warn'
              ? 'border-warn/50 bg-warn/10 text-foreground'
              : 'border-bar bg-surface text-foreground',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={announcement.tone === 'warn' ? 'warn' : 'secondary'}>
              {announcement.tone === 'warn' ? 'Notice' : 'Update'}
            </Badge>
            <span>{announcement.message}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={dismissAnnouncement}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {config.runtimeError ? (
        <div className="grid justify-items-start gap-1.5 rounded-md border border-bad px-4 py-3.5 text-sm" role="status">
          <Badge variant="destructive">Runtime problem</Badge>
          <p className="text-foreground">Runs cannot start until this is fixed: {config.runtimeError}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {showComposer ? (
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
              examples={examples}
              assistantRoutes={targetMode === 'demo' ? config.catalog.map((r) => `${r.method} ${r.path}`) : []}
              planError={planError}
              textareaRef={textarea}
              onTextChange={draft.updateText}
              onBlurSync={draft.syncCurrentDraftOnBlur}
              onSubmitDraft={() => void startPlanning(text.trim())}
              onKeepPlan={draft.keepPlan}
              onRetry={() => lastSubmitted !== null && void startPlanning(lastSubmitted)}
              onApplyAssistant={(nextDraft) => {
                draft.updateText(nextDraft);
                textarea.current?.focus();
              }}
            />
          ) : (
            <PlanBrief text={lastSubmitted ?? text} origin={activeOrigin} disabled={!idle} onEdit={editDescription} />
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
              onPendingRoutesChange={setPendingRouteIds}
            />
          ) : busy === null && !ownNeedsVerify ? (
            <>
              <NextUp />
              {targetMode === 'demo' ? <DemoBaselinePanel demoTrends={demoTrends} /> : null}
            </>
          ) : null}
        </div>

        <GateSidebar
          review={review}
          activeOrigin={activeOrigin}
          targetMode={targetMode}
          verifiedOrigin={verifiedOrigin}
          sampleRunId={config.sampleRunId}
          featuredRuns={featuredRuns}
          busy={busy}
          reviewSeq={reviewSeq}
          pendingRouteIds={pendingRouteIds}
          alive={alive}
          startFromBar={startFromBar}
          onBusyChange={setBusy}
          onCancelPlan={cancelPlan}
          onRevisePlan={(ids) => lastSubmitted !== null && void startPlanning(lastSubmitted, ids)}
          onStarted={onStarted}
          onInViewChange={setPanelInView}
        />
      </div>

      {review !== null ? <ModelCalls calls={review.modelCalls} /> : null}

      {approvable && review?.plan ? (
        <ApproveBar
          plan={review.plan}
          hidden={panelInView}
          disabled={!idle}
          needsRevise={pendingRouteIds !== null}
          onApprove={() => startFromBar.current?.()}
          onRevise={() => {
            if (lastSubmitted !== null && pendingRouteIds !== null) void startPlanning(lastSubmitted, pendingRouteIds);
          }}
        />
      ) : null}
    </div>
  );
}
