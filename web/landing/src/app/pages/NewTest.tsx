/**
 * Test Studio (`#/`): pick a target (`Demo Target` or `Own Site`), describe the traffic,
 * draft a plan, review it against the Policy Gate, and approve or cancel.
 * Nothing reaches the target until "Approve & Run".
 */
import { useEffect, useRef, useState } from 'react';
import type { AccountDraft, DemoTrendsResponse, PlanResponse } from '../../../../../src/api-types.ts';
import { getDraft, putDraft } from '../lib/auth-api.ts';
import {
  clearReviewState,
  clearSignedOutDraft,
  loadReviewState,
  loadSignedOutDraft,
  stashLocalDraft,
  stashReviewState,
  stashSignedOutDraft,
  takeLocalDraft,
} from '../lib/draft-storage.ts';
import { type ApiError, type ApiResult, getDemoTrends, postPlan, VERIFICATION_ERROR } from '../lib/api.ts';
import {
  fetchFeaturedRuns,
  fetchScenarioTemplates,
  subscribeActiveAnnouncement,
  type ActiveAnnouncement,
  type FeaturedRunItem,
  type ScenarioTemplate,
} from '../lib/scenario-templates.ts';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { NextUp } from '../components/NextUp.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '../components/shell/ShellContext.tsx';
import { useApp } from '../context.tsx';
import { ApproveBar, GateSidebar } from '../components/studio/GateSidebar.tsx';
import { PlanBrief, PlanReview } from '../components/studio/PlanReview.tsx';
import { TargetPicker } from '../components/studio/TargetPicker.tsx';
import { StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { TrafficComposer } from '../components/studio/TrafficComposer.tsx';
import {
  isApprovable,
  resolveTargetState,
  type StudioBusy,
  type TargetMode,
  validateTrafficLength,
} from '../components/studio/studio-view.ts';

function defaultFeaturedRuns(sampleRunId: string | null | undefined): readonly FeaturedRunItem[] {
  return sampleRunId
    ? [{ runId: sampleRunId, label: 'View sample report', summary: 'Inspect a completed public demo run with stages, charts, and capacity verdict.' }]
    : [];
}

export function NewTest() {
  const { config, me, navigate, announce } = useApp();
  const shell = useOptionalShell();
  const setTargetModeOverride = shell?.actions.setTargetModeOverride;
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;

  const initialReview = loadReviewState(me?.user.id ?? null);
  const [text, setText] = useState(() => initialReview?.lastSubmitted ?? loadSignedOutDraft() ?? '');
  const [busy, setBusy] = useState<StudioBusy>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(() => initialReview?.lastSubmitted ?? null);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const [review, setReview] = useState<PlanResponse | null>(() => initialReview?.review ?? null);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [editing, setEditing] = useState(() => initialReview?.editing ?? false);
  const [panelInView, setPanelInView] = useState(true);
  const [targetMode, setTargetMode] = useState<TargetMode>(() => initialReview?.targetMode ?? 'demo');
  const [examples, setExamples] = useState<readonly ScenarioTemplate[]>(() => config.examples);
  const [featuredRuns, setFeaturedRuns] = useState<readonly FeaturedRunItem[]>(() =>
    defaultFeaturedRuns(config.sampleRunId),
  );
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);
  const [lastEditedAt, setLastEditedAt] = useState(() => Date.now());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);

  useEffect(() => {
    const firebase = config.firebase;
    if (!firebase) return;
    let cancelled = false;
    void fetchScenarioTemplates(firebase, config.examples).then((templates) => {
      if (!cancelled) setExamples(templates);
    });
    void fetchFeaturedRuns(firebase, defaultFeaturedRuns(config.sampleRunId)).then((runs) => {
      if (!cancelled) setFeaturedRuns(runs);
    });
    const unsubAnnouncement = subscribeActiveAnnouncement(firebase, (next) => {
      if (!cancelled) setAnnouncement(next);
    });
    return () => {
      cancelled = true;
      unsubAnnouncement();
    };
  }, [config.firebase, config.examples, config.sampleRunId]);
  const startFromBar = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const draftHydrated = useRef(false);
  const draftTurnstile = useTurnstile();
  const [demoTrends, setDemoTrends] = useState<DemoTrendsResponse | null>(null);
  const [pendingRouteIds, setPendingRouteIds] = useState<string[] | null>(null);

  useEffect(() => () => void (alive.current = false), []);

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
    setBusy(null);
    if (result.ok) {
      clearSignedOutDraft();
      setReview(result.data);
      setPendingRouteIds(null);
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

      {announcement && dismissedAnnouncement !== announcement.message ? (
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
            onClick={() => setDismissedAnnouncement(announcement.message)}
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
              {targetMode === 'demo' && demoTrends?.available && demoTrends.routes.length > 0 ? (
                <TelemetryPanel ticks="bar" aria-labelledby="demo-baseline-heading">
                  <div className="flex flex-col gap-1">
                    <h2 id="demo-baseline-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
                      30-day demo baseline
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Observed across public demo runs over the last 30 days.
                    </p>
                  </div>
                  <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
                    {demoTrends.routes.slice(0, 6).map((r) => {
                      const errPct = typeof r.errorRatePct === 'number' ? r.errorRatePct.toFixed(1) : '0.0';
                      const health = r.status ?? 'steady';
                      return (
                        <div key={r.route} className="contents">
                          <dt className="font-mono text-muted-foreground">{r.route}</dt>
                          <dd className="m-0 flex flex-wrap items-center justify-end gap-2 font-mono text-foreground tabular-nums">
                            <span>
                              {r.avgMs !== null ? `${Math.round(r.avgMs)} ms` : 'n/a'} · {errPct}% err
                            </span>
                            <Badge variant={health === 'degraded' ? 'destructive' : health === 'spiky' ? 'warn' : 'ok'}>
                              {health}
                            </Badge>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </TelemetryPanel>
              ) : null}
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
