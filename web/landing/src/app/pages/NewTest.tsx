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
import type { PlanResponse } from '../../../../../src/api-types.ts';
import type { TestPlan } from '../../../../../src/types.ts';
import { type ApiError, type ApiResult, postApprove, postPlan, VERIFICATION_ERROR } from '../lib/api.ts';
import { countCodePoints } from '../lib/describe.ts';
import { parseErrorText } from '../lib/format.ts';
import { GateRules } from '../components/GateRules.tsx';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { NextUp } from '../components/NextUp.tsx';
import { StageProfile } from '../components/StageProfile.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { AlertRegion, Badge, Busy, KeyValues, Panel, TableWrap, ViolationsTable } from '../components/ui.tsx';
import { useApp } from '../context.tsx';

type Busy = 'planning' | 'approving' | null;

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
  const { config, navigate, announce } = useApp();
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;

  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const [review, setReview] = useState<PlanResponse | null>(null);
  const [reviewSeq, setReviewSeq] = useState(0);
  const [editing, setEditing] = useState(false);
  const [panelInView, setPanelInView] = useState(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const startFromBar = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const draftTurnstile = useTurnstile();

  useEffect(() => () => void (alive.current = false), []);

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
  const showComposer = review === null || editing;

  async function startPlanning(value: string) {
    if (!idle || countCodePoints(value) < min || countCodePoints(value) > max) return;
    setBusy('planning');
    setLastSubmitted(value);
    setPlanError(null);
    setReview(null);
    announce('Drafting a plan.');
    let result: ApiResult<PlanResponse>;
    try {
      const token = await draftTurnstile.token();
      result = await postPlan({ trafficEvent: value, turnstileToken: token });
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
    setReview(null);
    setEditing(false);
    focusComposer.current = true;
    announce('Plan discarded. Nothing was sent.');
  }

  const onStarted = (runId: string) => navigate(`/run/${encodeURIComponent(runId)}`);

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
              <label htmlFor="traffic-event" className="compose__label">
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
                aria-describedby="traffic-event-hint traffic-event-count traffic-event-problem"
                aria-invalid={n > 0 && !inRange}
                onChange={(e) => setText(e.target.value)}
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

              <div className="compose__target">
                <span className="muted">Target</span>
                <span className="code">{config.webOrigin}</span>
                <span className="muted">Demo target. Testing your own site will need domain verification (coming soon).</span>
              </div>

              <div className="row">
                <button type="submit" className="btn" disabled={!inRange || !idle}>
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
                ) : idle && n === 0 ? (
                  <span className="muted compose__reason">Write at least {min} characters to draft.</span>
                ) : null}
              </div>
              <AlertRegion error={planError} />
            </form>
          ) : (
            <Brief text={lastSubmitted ?? text} origin={config.webOrigin} disabled={!idle} onEdit={editDescription} />
          )}
          {/* Outside the form: the form folds away after a draft, and the widget must not lose its container. */}
          <TurnstileBox boxRef={draftTurnstile.box} />

          {review ? (
            <Review key={reviewSeq} res={review} stale={editing && changedSinceDraft} busy={busy} onEdit={editDescription} />
          ) : busy === null ? (
            <NextUp />
          ) : null}
        </div>
        <aside className="split__side" aria-label={approvable ? 'Approve the plan' : 'Policy gate rules'}>
          {approvable && review?.plan && review.planText !== null ? (
            <>
              <ApprovePanel
                key={reviewSeq}
                plan={review.plan}
                planText={review.planText}
                busy={busy}
                setBusy={setBusy}
                onCancel={cancelPlan}
                onStarted={onStarted}
                onInView={setPanelInView}
                startFromBar={startFromBar}
                alive={alive}
              />
              <GateRules folded />
            </>
          ) : (
            <GateRules />
          )}
        </aside>
      </div>

      {approvable && review?.plan ? (
        <ApproveBar plan={review.plan} hidden={panelInView} disabled={!idle} onApprove={() => startFromBar.current?.()} />
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

function Review({ res, stale, busy, onEdit }: { res: PlanResponse; stale: boolean; busy: Busy; onEdit: () => void }) {
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
          <PlanDetails plan={plan} rationale={res.rationale} />
        </>
      )}
      <ModelCalls calls={res.modelCalls} />
    </section>
  );
}

function PlanDetails({ plan, rationale }: { plan: TestPlan; rationale: string | null }) {
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
              const route = catalog.get(step.route);
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

function ApprovePanel({
  plan,
  planText,
  busy,
  setBusy,
  onCancel,
  onStarted,
  onInView,
  startFromBar,
  alive,
}: {
  plan: TestPlan;
  planText: string;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onCancel: () => void;
  onStarted: (runId: string) => void;
  onInView: (inView: boolean) => void;
  startFromBar: React.RefObject<(() => void) | null>;
  alive: React.RefObject<boolean>;
}) {
  const { announce } = useApp();
  const turnstile = useTurnstile();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const { maxVus, totalSec } = planSize(plan);
  const idle = busy === null;

  async function approve() {
    if (!idle) return;
    setBusy('approving');
    setError(null);
    announce('Starting the run.');
    let result: Awaited<ReturnType<typeof postApprove>>;
    try {
      const token = await turnstile.token();
      result = await postApprove({ planText, turnstileToken: token });
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
        <button type="button" className="btn btn--ink" disabled={!idle} onClick={() => void approve()}>
          Approve and run
        </button>
        <button type="button" className="btn btn--line" disabled={!idle} onClick={onCancel}>
          Cancel
        </button>
        {busy === 'approving' ? <Busy>Starting the run.</Busy> : null}
      </div>
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
