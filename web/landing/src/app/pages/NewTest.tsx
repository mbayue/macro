/**
 * New test (`#/`): describe the traffic, draft a plan, review it against the policy gate,
 * approve or cancel. Nothing reaches the target until "Approve and run".
 * Behaviour follows the old describe view (web/describe.ts) one to one.
 *
 * Once a draft exists the description folds into a short read-only block, and the approve
 * panel takes the side column (sticky beside the plan). On narrow screens, where the side
 * column drops below the plan, a bar at the bottom of the screen carries the approve button.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { TestPlan } from '../../../../../src/types.ts';
import type { AccountDraft, PlanResponse, PlanRouteView } from '../../../../../src/api-types.ts';
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
import { type ApiError, type ApiResult, postApprove, postDiscover, postPlan, VERIFICATION_ERROR } from '../lib/api.ts';
import { isActionPath } from '../../../../../src/plan/discover.ts';
import { journeyGroups, journeyLabel, type JourneyRow } from '../../../../../src/plan/journey-edit.ts';
import { countCodePoints } from '../lib/describe.ts';
import { parseErrorText } from '../lib/format.ts';
import { GateRules } from '../components/GateRules.tsx';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { NextUp } from '../components/NextUp.tsx';
import { StageProfile } from '../components/StageProfile.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { AlertRegion, Badge, Busy, KeyValues, Panel, TableWrap, ViolationsTable } from '../components/ui.tsx';
import { VerifyPanel } from '../components/VerifyPanel.tsx';
import { useApp } from '../context.tsx';

type Busy = 'planning' | 'approving' | null;
type TargetMode = 'demo' | 'own';

const fmt = (n: number): string => n.toLocaleString('en-US');

const isApprovable = (res: PlanResponse): boolean =>
  !res.parseError && res.plan !== null && res.gate !== null && res.gate.status === 'accepted' && res.planText !== null;

function planSize(plan: TestPlan): { maxVus: number; totalSec: number } {
  return {
    maxVus: plan.stages.reduce((m, s) => Math.max(m, s.vus), 0),
    totalSec: plan.stages.reduce((sum, s) => sum + s.durationSec, 0),
  };
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function NewTest() {
  const { config, me, refreshMe, navigate, announce } = useApp();
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;

  const initialReview = loadReviewState(me?.user.id ?? null);
  const [text, setText] = useState(() => initialReview?.lastSubmitted ?? '');
  const [busy, setBusy] = useState<Busy>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(() => initialReview?.lastSubmitted ?? null);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const [review, setReview] = useState<PlanResponse | null>(() => initialReview?.review ?? null);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [editing, setEditing] = useState(() => initialReview?.editing ?? false);
  const [panelInView, setPanelInView] = useState(true);
  const [targetMode, setTargetMode] = useState<TargetMode>(() => initialReview?.targetMode ?? 'demo');
  const [lastEditedAt, setLastEditedAt] = useState(() => Date.now());
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<ApiError | null>(null);
  const [scanned, setScanned] = useState<{ origin: string; routes: PlanRouteView[] } | null>(null);
  const [scannedChecked, setScannedChecked] = useState<Set<string>>(() => new Set());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const startFromBar = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const draftHydrated = useRef(false);
  const draftTurnstile = useTurnstile();

  useEffect(() => () => void (alive.current = false), []);

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

  const n = countCodePoints(text);
  const inRange = n >= min && n <= max;
  const problem = n === 0 ? '' : n < min ? `Needs at least ${min} characters.` : n > max ? `${fmt(n - max)} over the limit.` : '';
  const idle = busy === null;
  const changedSinceDraft = lastSubmitted !== null && text.trim() !== lastSubmitted;
  const showRetry = planError?.code === 'planning_failed' && !changedSinceDraft;
  const approvable = review !== null && isApprovable(review);
  const [checksDiffer, setChecksDiffer] = useState(false);
  const showComposer = review === null || editing;
  const verifiedOrigin = me?.verifiedOrigin ?? null;
  const ownNeedsVerify = targetMode === 'own' && (me === null || verifiedOrigin === null);
  const activeOrigin = targetMode === 'own' && verifiedOrigin !== null ? verifiedOrigin.origin : config.webOrigin;
  const pendingHost = me?.pendingVerification?.host ?? null;
  const openedVerify =
    window.location.hash.replace(/^#\/?/, '').split('?')[0]?.replace(/\/$/, '') === 'verify-panel';
  const showVerify = me !== null && (openedVerify || ownNeedsVerify || pendingHost !== null);

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
  }, [openedVerify, pendingHost]);
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
      setScanned(null);
      setScannedChecked(new Set());
      setScanError(null);
      await refreshMe();
      announce('Cleared verified origin.');
    }
  }

  async function scanRoutes() {
    if (!idle || scanning || verifiedOrigin === null) return;
    setScanning(true);
    setScanError(null);
    const res = await postDiscover({ targetOrigin: verifiedOrigin.origin });
    if (!alive.current) return;
    setScanning(false);
    if (!res.ok) {
      setScanError(res.error);
      announce(res.error.message);
      return;
    }
    setScanned(res.data);
    setScannedChecked(new Set(res.data.routes.filter((r) => r.defaultOn === true).map((r) => r.id)));
    announce(`Scanned ${res.data.routes.length} routes from ${res.data.origin}.`);
  }

  async function startPlanning(value: string, routeIds?: string[]) {
    if (!idle || countCodePoints(value) < min || countCodePoints(value) > max) return;
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
    <div className={approvable ? 'page page--bar' : 'page'}>
      <header className="page__head">
        <h1 className="page__title">New load test</h1>
        <p className="page__lead">
          Describe the traffic you expect. Macro drafts a staged plan, fixed rules check it, and nothing runs until you approve.
        </p>
      </header>

      {config.runtimeError ? (
        <div className="notice notice--bad" role="status">
          <Badge tone="bad">Runtime problem</Badge>
          <p>Runs cannot start until this is fixed: {config.runtimeError}</p>
        </div>
      ) : null}

      <div className="split">
        <div className="split__main">
          {showComposer ? (
            <form
              className="panel compose"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void startPlanning(text.trim());
              }}
            >
              <label id="traffic-event-label" htmlFor="traffic-event" className="compose__label">
                Describe the traffic you expect
              </label>
              <p id="traffic-event-hint" className="muted">
                Say who arrives, when, and what they do. {min} to {fmt(max)} characters. Press Ctrl+Enter to draft.
              </p>
              <textarea
                id="traffic-event"
                ref={textarea}
                className="textarea"
                rows={6}
                autoComplete="off"
                value={text}
                readOnly={!idle}
                aria-label="Describe the traffic you expect"
                aria-labelledby="traffic-event-label"
                aria-describedby="traffic-event-hint traffic-event-count traffic-event-problem"
                aria-invalid={n > 0 && !inRange}
                onChange={(e) => {
                  setText(e.target.value);
                  setLastEditedAt(Date.now());
                }}
                onBlur={() => {
                  if (me !== null && text.trim() !== '') void syncDraftToServer(currentDraft());
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void startPlanning(text.trim());
                  }
                }}
              />
              <div className="compose__meta">
                <span id="traffic-event-count" className={n > 0 && !inRange ? 'counter counter--bad' : 'counter'}>
                  {fmt(n)} / {fmt(max)}
                </span>
                <span id="traffic-event-problem" className="compose__problem">
                  {problem}
                </span>
              </div>

              {config.examples.length > 0 ? (
                <div className="examples" role="group" aria-label="Examples">
                  <span className="muted">Examples fill the text box only:</span>
                  {config.examples.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      className="chip-btn"
                      disabled={!idle}
                      onClick={() => {
                        setText(ex.text);
                        textarea.current?.focus();
                      }}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="compose__target" role="group" aria-labelledby="target-heading">
                <div className="compose__target-header">
                  <span id="target-heading" className="field__label">Target environment</span>
                </div>
                <div className="target-segmented" role="radiogroup" aria-labelledby="target-heading">
                  <label className={`target-segmented__btn ${targetMode === 'demo' ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="target-mode"
                      value="demo"
                      checked={targetMode === 'demo'}
                      onChange={() => chooseTarget('demo')}
                      disabled={!idle}
                      className="visually-hidden"
                    />
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <span>Demo shop</span>
                  </label>
                  <label className={`target-segmented__btn ${targetMode === 'own' ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="target-mode"
                      value="own"
                      checked={targetMode === 'own'}
                      onChange={() => chooseTarget('own')}
                      disabled={!idle}
                      className="visually-hidden"
                    />
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span>My site</span>
                    {verifiedOrigin !== null ? <span className="target-segmented__dot" title="Verified origin" /> : null}
                  </label>
                </div>

                <div className="target-meta">
                  {targetMode === 'demo' ? (
                    <>
                      <span className="code">{config.webOrigin}</span>
                      <span className="muted">Public demo shop. Reports stay public.</span>
                    </>
                  ) : verifiedOrigin !== null ? (
                    <>
                      <span className="code">{verifiedOrigin.origin}</span>
                      <span className="badge badge--ok">Verified</span>
                      <button
                        type="button"
                        className="btn btn--quiet btn--inline-clear"
                        disabled={!idle || scanning}
                        onClick={() => void scanRoutes()}
                      >
                        {scanning ? 'Scanning\u2026' : scanned?.origin === verifiedOrigin.origin ? 'Re-scan routes' : 'Scan routes'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--inline-clear"
                        disabled={!idle}
                        onClick={() => void clearVerifiedOrigin()}
                      >
                        Change
                      </button>
                    </>
                  ) : me === null ? (
                    <>
                      <span className="muted">
                        <a href="#/sign-in">Sign in</a> to verify your site and run private own-site tests.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="target-meta__notice">Domain verification required before drafting.</span>
                      <button
                        type="button"
                        className="target-meta__link"
                        onClick={() => {
                          const panel = document.getElementById('verify-panel');
                          panel?.scrollIntoView({ behavior: 'smooth' });
                          panel?.querySelector<HTMLInputElement>('input[name="host"]')?.focus();
                        }}
                      >
                        See verification panel →
                      </button>
                    </>
                  )}
                </div>
                {targetMode === 'own' ? (
                  <p className="muted">
                    Macro reads / on your site, then the scripts that page links, and uses those files as the journey. It does not run the page.
                  </p>
                ) : null}
                {targetMode === 'own' && scanError ? <AlertRegion error={scanError} /> : null}
                {targetMode === 'own' && verifiedOrigin !== null && scanned !== null && scanned.origin === verifiedOrigin.origin ? (
                  <div className="journey-edit">
                    <div className="journey-edit__head">
                      <span className="muted">
                        Scanned {scanned.routes.length} routes ({scannedChecked.size} selected for planner)
                      </span>
                      <span className="row">
                        <button
                          type="button"
                          className="btn btn--quiet btn--inline-clear"
                          disabled={!idle}
                          onClick={() => setScannedChecked(new Set(scanned.routes.map((r) => r.id)))}
                        >
                          All on
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet btn--inline-clear"
                          disabled={!idle}
                          onClick={() =>
                            setScannedChecked(new Set(scanned.routes.filter((r) => r.path === '/').map((r) => r.id)))
                          }
                        >
                          All off
                        </button>
                      </span>
                    </div>
                    <ul className="journey-edit__list">
                      {scanned.routes.map((r) => {
                        const locked = r.path === '/';
                        const checked = locked || scannedChecked.has(r.id);
                        return (
                          <li key={r.id}>
                            {locked ? (
                              <div className="pick pick--locked">
                                <span className="pick__box" aria-hidden="true" />
                                <span className="pick__body">
                                  <span className="pick__name code">{r.path}</span>
                                </span>
                                <span className="pick__aside">Required</span>
                              </div>
                            ) : (
                              <label className={checked ? 'pick is-on' : 'pick'}>
                                <input
                                  className="visually-hidden"
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!idle}
                                  onChange={(e) => {
                                    const next = new Set(scannedChecked);
                                    if (e.target.checked) next.add(r.id);
                                    else next.delete(r.id);
                                    setScannedChecked(next);
                                  }}
                                />
                                <span className="pick__box" aria-hidden="true" />
                                <span className="pick__body">
                                  <span className="pick__name code">{r.path}</span>
                                </span>
                                <span className="pick__aside">{r.kind}</span>
                              </label>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="row">
                <button
                  type="submit"
                  className="btn"
                  disabled={!inRange || !idle || ownNeedsVerify}
                  onClick={(e) => {
                    if (
                      targetMode === 'own' &&
                      verifiedOrigin !== null &&
                      scanned !== null &&
                      scanned.origin === verifiedOrigin.origin &&
                      scannedChecked.size > 0
                    ) {
                      e.preventDefault();
                      void startPlanning(text, [...scannedChecked]);
                    }
                  }}
                >
                  {review !== null ? 'Draft a new plan' : 'Draft a plan'}
                </button>
                {review !== null && editing ? (
                  <button type="button" className="btn btn--line" disabled={!idle} onClick={keepPlan}>
                    Keep the current plan
                  </button>
                ) : null}
                {showRetry ? (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={!idle}
                    onClick={() => lastSubmitted !== null && void startPlanning(lastSubmitted)}
                  >
                    Retry planning
                  </button>
                ) : null}
                {busy === 'planning' ? (
                  <Busy>Drafting a plan. This can take up to a minute.</Busy>
                ) : ownNeedsVerify ? (
                  <span className="muted compose__reason">Verify your site in the side panel before drafting.</span>
                ) : idle && n === 0 ? (
                  <span className="muted compose__reason">Write at least {min} characters to draft.</span>
                ) : null}
              </div>
              <AlertRegion error={planError} />
            </form>
          ) : (
            <Brief text={lastSubmitted ?? text} origin={activeOrigin} disabled={!idle} onEdit={editDescription} />
          )}
          {/* Outside the form: the form folds away after a draft, and the widget must not lose its container. */}
          <TurnstileBox boxRef={draftTurnstile.box} />

          {review ? (
            <Review
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
        <aside
          className="split__side"
          aria-label={approvable && review?.plan ? 'Approve the plan' : showVerify ? 'Verify your site' : 'Policy gate rules'}
        >
          {approvable && review?.plan && review.planText !== null ? (
            <>
              <ApprovePanel
                key={reviewSeq}
                plan={review.plan}
                planText={review.planText}
                targetMode={targetMode}
                {...(targetMode === 'own' && verifiedOrigin !== null
                  ? { targetOrigin: verifiedOrigin.origin }
                  : {})}
                draftId={review.draftId}
                busy={busy}
                setBusy={setBusy}
                onCancel={cancelPlan}
                onStarted={onStarted}
                onInView={setPanelInView}
                startFromBar={startFromBar}
                alive={alive}
                checksDiffer={checksDiffer}
              />
              {/* The verify panel stays reachable after drafting: the user may
                  have opened it from the rail and then drafted on this page. */}
              {openedVerify ? (
                <div id="verify-panel">
                  <VerifyPanel initialHost="" />
                </div>
              ) : null}
              <GateRules folded />
            </>
          ) : showVerify ? (
            <>
              <div id="verify-panel">
                <VerifyPanel initialHost="" />
              </div>
              <GateRules folded />
            </>
          ) : (
            <GateRules />
          )}
        </aside>
      </div>

      {approvable && review?.plan ? (
        <ApproveBar plan={review.plan} hidden={panelInView} disabled={!idle || checksDiffer} onApprove={() => startFromBar.current?.()} />
      ) : null}
    </div>
  );
}

/** The description a plan was drafted from, folded once the draft exists. */
function Brief({ text, origin, disabled, onEdit }: { text: string; origin: string; disabled: boolean; onEdit: () => void }) {
  return (
    <section className="panel brief" aria-labelledby="brief-title">
      <div className="panel__head">
        <h2 id="brief-title" className="h-small">
          Your description
        </h2>
        <button type="button" className="btn btn--quiet" disabled={disabled} onClick={onEdit}>
          Edit description
        </button>
      </div>
      <p className="brief__text prose">{text}</p>
      <p className="brief__target">
        <span className="muted">Target</span> <span className="code">{origin}</span>
      </p>
    </section>
  );
}

function Review({
  res,
  stale,
  busy,
  onEdit,
  onRevise,
  onChecksDiffer,
}: {
  res: PlanResponse;
  stale: boolean;
  busy: Busy;
  onEdit: () => void;
  onRevise: (routeIds: string[]) => void;
  onChecksDiffer: (differ: boolean) => void;
}) {
  const { announce } = useApp();
  const heading = useRef<HTMLHeadingElement>(null);
  const plan = res.plan;
  const gate = res.gate;
  const rejected = gate !== null && gate.status === 'rejected';
  const approvable = isApprovable(res);

  // Announce the outcome and move focus to the review once, when it appears.
  useEffect(() => {
    if (res.parseError) announce('The drafted plan could not be read. It cannot be approved.');
    else if (plan !== null && rejected) announce('The plan was rejected by the policy gate.');
    else if (approvable) announce('Plan ready for review.');
    heading.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editButton = (
    <div className="row">
      <button type="button" className="btn btn--quiet" disabled={busy !== null} onClick={onEdit}>
        Edit description
      </button>
    </div>
  );

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="review__head">
        <h2 id="review-title" ref={heading} tabIndex={-1}>
          Draft plan
        </h2>
        {res.parseError ? (
          <Badge tone="bad">Not approvable</Badge>
        ) : plan === null ? null : rejected ? (
          <Badge tone="bad">Rejected by the policy gate</Badge>
        ) : gate?.status === 'accepted' ? (
          <Badge tone="ok">Passed the policy gate</Badge>
        ) : null}
      </div>
      {stale ? <p className="muted">The text above changed after this plan was drafted. The plan below is for the earlier text.</p> : null}

      {res.parseError ? (
        <div className="panel panel--bad">
          <p>The plan could not be read, so it cannot be approved.</p>
          <p className="code">{parseErrorText(res.parseError)}</p>
          {editButton}
        </div>
      ) : plan === null ? (
        <div className="panel">
          <p>No plan was returned.</p>
          {editButton}
        </div>
      ) : (
        <>
          {rejected ? (
            <div className="panel panel--bad">
              <p>This plan breaks the rules below, so it cannot be approved. Change the description and draft again.</p>
              <ViolationsTable violations={gate.violations} />
              {editButton}
            </div>
          ) : !approvable ? (
            <div className="panel">
              <p>This plan has no policy result, so it cannot be approved.</p>
            </div>
          ) : null}
          <PlanDetails plan={plan} rationale={res.rationale} routes={res.routes} />
          {res.routes.some((row) => row.kind !== 'catalog') ? (
            <JourneyChecks routes={res.routes} disabled={busy !== null} onRevise={onRevise} onChecksDiffer={onChecksDiffer} />
          ) : null}
        </>
      )}
      <ModelCalls calls={res.modelCalls} />
    </section>
  );
}

function PlanDetails({
  plan,
  rationale,
  routes,
}: {
  plan: TestPlan;
  rationale: string | null;
  routes: PlanResponse['routes'];
}) {
  const { config } = useApp();
  const catalog = new Map<string, (typeof config.catalog)[number]>(config.catalog.map((r) => [r.id, r]));
  const captionId = useId();
  const { totalSec } = planSize(plan);
  return (
    <Panel className="plan">
      <p className="plan__name">{plan.name}</p>
      {rationale ? (
        <div className="ai-note">
          <h3 className="h-small">
            Why this plan <Badge>AI</Badge>
          </h3>
          <p className="prose">{rationale}</p>
        </div>
      ) : null}

      <div className="plan__note">
        <h3 className="h-small">Stop thresholds</h3>
        <p className="prose">
          The run stops early if p95 latency goes over <b className="num">{fmt(plan.stopThresholds.p95Ms)} ms</b> or the error rate goes over{' '}
          <b className="num">{plan.stopThresholds.errorRatePct}%</b>.
        </p>
      </div>

      <div className="plan__stages">
        <div className="plan__stages-head">
          <h3 className="h-small" id={captionId}>
            Stages
          </h3>
          <span className="muted num">
            {plan.stages.length} {plan.stages.length === 1 ? 'stage' : 'stages'}, {fmt(totalSec)} s in total
          </span>
        </div>
        {/* The chart is decorative; this list is what assistive technology reads. */}
        <ol className="visually-hidden" aria-labelledby={captionId}>
          {plan.stages.map((s, i) => (
            <li key={i}>
              Stage {i + 1}: {fmt(s.vus)} VUs for {s.durationSec} s
            </li>
          ))}
        </ol>
        <StageProfile stages={plan.stages.map((s) => ({ vus: s.vus, durationSec: s.durationSec, state: 'planned' as const }))} />
        <details className="disclosure disclosure--inline plan__table">
          <summary>
            <span className="disclosure__title">Show the stages as a table</span>
          </summary>
          <TableWrap label="Stages">
            <table className="table">
              <caption className="visually-hidden">Stages</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col" className="num">
                    VUs
                  </th>
                  <th scope="col" className="num">
                    Duration (s)
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.stages.map((s, i) => (
                  <tr key={i}>
                    <th scope="row" className="idx">
                      {i + 1}
                    </th>
                    <td className="num">{fmt(s.vus)}</td>
                    <td className="num">{s.durationSec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </details>
      </div>

      <h3 className="h-small">Journey</h3>
      <TableWrap label="Journey">
        {/* Explicit roles: on phones the rows are laid out as cards, which can drop table semantics. */}
        <table className="table table--journey" role="table">
          <caption className="visually-hidden">Journey</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                Route
              </th>
              <th scope="col" role="columnheader">
                Method
              </th>
              <th scope="col" role="columnheader">
                Path
              </th>
              <th scope="col" role="columnheader" className="num">
                Probability (%)
              </th>
              <th scope="col" role="columnheader" className="num">
                Think time (ms)
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {plan.journey.map((step, i) => {
              const route =
                routes.length > 0 ? routes.find((r) => r.id === step.route) : catalog.get(step.route);
              return (
                <tr key={`${step.route}-${i}`} role="row">
                  <th scope="row" role="rowheader" className="code">
                    {step.route}
                  </th>
                  {route ? (
                    <>
                      <td className="code" role="cell" data-label="Method">
                        {route.method}
                      </td>
                      <td className="code" role="cell" data-label="Path">
                        {route.path}
                      </td>
                    </>
                  ) : (
                    <td className="muted" role="cell" colSpan={2}>
                      Not in the route catalog
                    </td>
                  )}
                  <td className="num" role="cell" data-label="Probability (%)">
                    {step.probability}
                  </td>
                  <td className="num" role="cell" data-label="Think time (ms)">
                    {fmt(step.thinkMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}

function pathFace(path: string): { name: string; dir: string | null } {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return { name: path, dir: null };
  const name = path.slice(slash + 1);
  if (name.length === 0) return { name: path, dir: null };
  return { name, dir: path.slice(0, slash + 1) };
}

const KIND_RANK = ['Page', 'Script', 'Stylesheet', 'Font', 'Image'];

function kindHeading(label: string, count: number): string {
  if (count === 1) return label;
  if (label === 'Page') return 'Pages';
  if (label === 'Stylesheet') return 'Stylesheets';
  return `${label}s`;
}

function kindGroups(rows: readonly JourneyRow[]): { label: string; rows: JourneyRow[] }[] {
  const buckets = new Map<string, JourneyRow[]>();
  for (const row of rows) {
    const label = journeyLabel(row);
    const list = buckets.get(label);
    if (list) list.push(row);
    else buckets.set(label, [row]);
  }
  return [...buckets.keys()]
    .sort((a, b) => {
      const ia = KIND_RANK.indexOf(a);
      const ib = KIND_RANK.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((label) => ({ label, rows: buckets.get(label) ?? [] }));
}

function sharedDir(rows: readonly JourneyRow[]): string | null {
  const dirs = rows.map((row) => pathFace(row.path).dir);
  const first = dirs[0];
  if (first == null || dirs.some((dir) => dir !== first)) return null;
  return first;
}

function JourneyPick({
  row,
  on,
  locked,
  disabled,
  showKind,
  showDir,
  onToggle,
}: {
  row: JourneyRow;
  on: boolean;
  locked: boolean;
  disabled: boolean;
  showKind: boolean;
  showDir: boolean;
  onToggle: () => void;
}) {
  const face = pathFace(row.path);
  const action = row.kind === 'page' && isActionPath(row.path);
  const aside = locked ? 'Required' : showKind ? journeyLabel(row) : null;
  const body = (
    <>
      <span className="pick__box" aria-hidden="true" />
      <span className="pick__body">
        <span className="pick__name code">{face.name}</span>
        {showDir && face.dir !== null ? <span className="pick__dir code">{face.dir}</span> : null}
        {!showDir && face.dir !== null ? <span className="visually-hidden">{face.dir}</span> : null}
        {action ? <span className="pick__note">A repeated visit would hit this link.</span> : null}
      </span>
      {aside !== null ? <span className="pick__aside">{aside}</span> : null}
    </>
  );
  if (locked) return <div className="pick pick--locked">{body}</div>;
  return (
    <label className={on ? 'pick is-on' : 'pick'}>
      <input className="visually-hidden" type="checkbox" checked={on} disabled={disabled} onChange={onToggle} />
      {body}
    </label>
  );
}

function JourneyChecks({
  routes,
  disabled,
  onRevise,
  onChecksDiffer,
}: {
  routes: PlanResponse['routes'];
  disabled: boolean;
  onRevise: (routeIds: string[]) => void;
  onChecksDiffer: (differ: boolean) => void;
}) {
  const groups = journeyGroups(routes.map((row) => ({ ...row, defaultOn: row.defaultOn === true })));
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(routes.filter((row) => row.defaultOn === true).map((row) => row.id)),
  );
  // A revised plan returns a new routes list; re-sync the checkboxes to its
  // defaultOn flags, or the stale selection keeps checksDiffer true forever
  // and "Approve and run" stays disabled.
  useEffect(() => {
    setChecked(new Set(routes.filter((row) => row.defaultOn === true).map((row) => row.id)));
  }, [routes]);
  const baseline = routes
    .filter((row) => row.defaultOn === true)
    .map((row) => row.id)
    .sort()
    .join('\n');
  const current = [...checked].sort().join('\n');
  const differ = current !== baseline;
  useEffect(() => {
    onChecksDiffer(differ);
  }, [differ, onChecksDiffer]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setGroup(rows: readonly { id: string }[], on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  const sections = [
    ['Always in the test', groups.locked, true],
    ['On, and you can turn them off', groups.on, false],
    ['Found, and left off until you turn one on', groups.off, false],
  ] as const;

  return (
    <section className="panel journey-picks" aria-label="Journey">
      {sections.map(([title, rows, locked]) => {
        if (rows.length === 0) return null;
        const kinds = kindGroups(rows);
        const grouped = kinds.length > 1 || rows.length > 1;
        return (
          <div className="journey-picks__group" key={title}>
            <div className="journey-picks__head">
              <h3>{title}</h3>
              <span className="journey-picks__count num">
                {rows.length}
                <span className="visually-hidden"> routes</span>
              </span>
              {locked || rows.length < 2 ? null : (
                <button
                  type="button"
                  className="btn btn--ghost journey-picks__all"
                  disabled={disabled}
                  onClick={() => setGroup(rows, !rows.every((row) => checked.has(row.id)))}
                >
                  {rows.every((row) => checked.has(row.id)) ? 'All off' : 'All on'}
                </button>
              )}
            </div>
            <div className="journey-picks__kinds">
              {kinds.map((group) => {
                const dir = grouped ? sharedDir(group.rows) : null;
                const list = (
                  <ul className="journey-picks__list">
                    {group.rows.map((row) => (
                      <li key={row.id}>
                        <JourneyPick
                          row={row}
                          on={locked || checked.has(row.id)}
                          locked={locked}
                          disabled={disabled}
                          showKind={!grouped}
                          showDir={dir === null}
                          onToggle={() => toggle(row.id)}
                        />
                      </li>
                    ))}
                  </ul>
                );
                if (!grouped) return <div key={group.label}>{list}</div>;
                return (
                  <div className="journey-picks__kind" key={group.label}>
                    <div className="journey-picks__kind-head">
                      <h4>{kindHeading(group.label, group.rows.length)}</h4>
                      {dir !== null ? <p className="code journey-picks__dir">{dir}</p> : null}
                    </div>
                    {list}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {groups.overflow ? <p>Some pages were left off because a plan holds 32 routes.</p> : null}
      {differ ? (
        <div className="journey-picks__revise">
          <p aria-live="polite">Revise the plan to use these checks.</p>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={disabled}
            onClick={() => onRevise(['r1', ...routes.filter((row) => row.path !== '/' && checked.has(row.id)).map((row) => row.id)])}
          >
            Revise the plan
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ApprovePanel({
  plan,
  planText,
  targetMode,
  targetOrigin,
  draftId,
  busy,
  setBusy,
  onCancel,
  onStarted,
  onInView,
  startFromBar,
  alive,
  checksDiffer,
}: {
  plan: TestPlan;
  planText: string;
  targetMode: TargetMode;
  targetOrigin?: string;
  draftId: string;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onCancel: () => void;
  onStarted: (runId: string) => void;
  onInView: (inView: boolean) => void;
  startFromBar: React.RefObject<(() => void) | null>;
  alive: React.RefObject<boolean>;
  checksDiffer: boolean;
}) {
  const { announce } = useApp();
  const turnstile = useTurnstile();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const { maxVus, totalSec } = planSize(plan);
  const idle = busy === null;

  async function approve() {
    if (!idle || checksDiffer) return;
    setBusy('approving');
    setError(null);
    announce('Starting the run.');
    let result: Awaited<ReturnType<typeof postApprove>>;
    try {
      const token = await turnstile.token();
      result = await postApprove({
        planText,
        turnstileToken: token,
        targetMode,
        ...(targetOrigin !== undefined ? { targetOrigin } : {}),
        ...(targetMode === 'own' ? { draftId } : {}),
      });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      turnstile.reset();
    }
    if (!alive.current) return;
    if (result.ok) {
      // Stay busy: no second submission while the page changes.
      onStarted(result.data.runId);
      return;
    }
    setBusy(null);
    setError(result.error);
    announce(result.error.message);
  }

  // The bottom bar starts the same approval here, after bringing this panel into view, so a
  // verification challenge, the busy line and any error are on screen.
  useEffect(() => {
    startFromBar.current = () => {
      section.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      heading.current?.focus({ preventScroll: true });
      void approve();
    };
    return () => {
      startFromBar.current = null;
    };
  });

  // The bottom bar only shows while this panel is off screen.
  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => onInView(entry?.isIntersecting ?? true), { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      onInView(true);
    };
  }, [onInView]);

  return (
    <section className="approve" aria-labelledby="approve-title" ref={section}>
      <div>
        <h2 id="approve-title" ref={heading} tabIndex={-1}>
          Approve this plan
        </h2>
        <p>Nothing is sent until you approve. Approving starts the run right away.</p>
      </div>
      <KeyValues
        items={[
          ['Target', <span className="code">{plan.target}</span>],
          ['Maximum VUs', <span className="num">{fmt(maxVus)}</span>],
          ['Total stage duration', <span className="num">{fmt(totalSec)} s</span>],
        ]}
      />
      <TurnstileBox boxRef={turnstile.box} />
      <div className="row">
        <button type="button" className="btn btn--ink" disabled={!idle || checksDiffer} onClick={() => void approve()}>
          Approve and run
        </button>
        <button type="button" className="btn btn--line" disabled={!idle} onClick={onCancel}>
          Cancel
        </button>
        {busy === 'approving' ? <Busy>Starting the run.</Busy> : null}
      </div>
      {checksDiffer ? <p>Revise the plan to use these checks.</p> : null}
      <AlertRegion error={error} />
    </section>
  );
}

/** Narrow screens: the approve action stays in reach while the plan scrolls by. */
function ApproveBar({ plan, hidden, disabled, onApprove }: { plan: TestPlan; hidden: boolean; disabled: boolean; onApprove: () => void }) {
  const { maxVus, totalSec } = planSize(plan);
  return (
    <div className="approve-bar" hidden={hidden}>
      <p className="approve-bar__text">
        <span className="num">{fmt(maxVus)}</span> VUs at most, <span className="num">{fmt(totalSec)}</span> s in total
      </p>
      <button type="button" className="btn btn--ink" disabled={disabled} onClick={onApprove}>
        Approve and run
      </button>
    </div>
  );
}
