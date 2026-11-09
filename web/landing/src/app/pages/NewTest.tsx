/**
 * New test (`#/`): describe the traffic, draft a plan, review it against the policy gate,
 * approve or cancel. Nothing reaches the target until "Approve and run".
 * Behaviour follows the old describe view (web/describe.ts) one to one.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { PlanResponse } from '../../../../../src/api-types.ts';
import type { TestPlan } from '../../../../../src/types.ts';
import { type ApiError, type ApiResult, postApprove, postPlan, VERIFICATION_ERROR } from '../../../../api.ts';
import { countCodePoints } from '../../../../describe.ts';
import { parseErrorText } from '../../../../dom.ts';
import { GateRules } from '../components/GateRules.tsx';
import { ModelCalls } from '../components/ModelCalls.tsx';
import { NextUp } from '../components/NextUp.tsx';
import { StageProfile } from '../components/StageProfile.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { AlertRegion, Badge, Busy, KeyValues, Panel, TableWrap, ViolationsTable } from '../components/ui.tsx';
import { useApp } from '../context.tsx';

type Busy = 'planning' | 'approving' | null;

const fmt = (n: number): string => n.toLocaleString('en-US');

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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const draftTurnstile = useTurnstile();

  useEffect(() => () => void (alive.current = false), []);

  const n = countCodePoints(text);
  const inRange = n >= min && n <= max;
  const problem = n === 0 ? '' : n < min ? `Needs at least ${min} characters.` : n > max ? `${fmt(n - max)} over the limit.` : '';
  const idle = busy === null;
  const changedSinceDraft = lastSubmitted !== null && text.trim() !== lastSubmitted;
  const showRetry = planError?.code === 'planning_failed' && !changedSinceDraft;

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
    } else {
      setPlanError(result.error);
      announce(result.error.message);
    }
  }

  function cancelPlan() {
    if (!idle) return;
    setReview(null);
    textarea.current?.focus();
    announce('Plan discarded. Nothing was sent.');
  }

  return (
    <div className="page">
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
              Say who arrives, when, and what they do. {min} to {fmt(max)} characters.
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

            <TurnstileBox boxRef={draftTurnstile.box} />
            <div className="row">
              <button type="submit" className="btn" disabled={!inRange || !idle}>
                Draft a plan
              </button>
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
              {busy === 'planning' ? <Busy>Drafting a plan. This can take up to a minute.</Busy> : null}
            </div>
            <AlertRegion error={planError} />
          </form>

          {review ? (
            <Review
              key={reviewSeq}
              res={review}
              stale={changedSinceDraft}
              busy={busy}
              setBusy={setBusy}
              onCancel={cancelPlan}
              onStarted={(runId) => navigate(`/run/${encodeURIComponent(runId)}`)}
              alive={alive}
            />
          ) : busy === null ? (
            <NextUp />
          ) : null}
        </div>
        <aside className="split__side" aria-label="Policy gate rules">
          <GateRules />
        </aside>
      </div>
    </div>
  );
}

function Review({
  res,
  stale,
  busy,
  setBusy,
  onCancel,
  onStarted,
  alive,
}: {
  res: PlanResponse;
  stale: boolean;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onCancel: () => void;
  onStarted: (runId: string) => void;
  alive: React.RefObject<boolean>;
}) {
  const { announce } = useApp();
  const heading = useRef<HTMLHeadingElement>(null);
  const plan = res.plan;
  const gate = res.gate;
  const rejected = gate !== null && gate.status === 'rejected';
  const approvable = !res.parseError && plan !== null && gate !== null && gate.status === 'accepted' && res.planText !== null;

  // Announce the outcome and move focus to the review once, when it appears.
  useEffect(() => {
    if (res.parseError) announce('The drafted plan could not be read. It cannot be approved.');
    else if (plan !== null && rejected) announce('The plan was rejected by the policy gate.');
    else if (approvable) announce('Plan ready for review.');
    heading.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="panel">
          <p>The plan could not be read, so it cannot be approved.</p>
          <p className="code">{parseErrorText(res.parseError)}</p>
        </div>
      ) : plan === null ? (
        <div className="panel">
          <p>No plan was returned.</p>
        </div>
      ) : (
        <>
          {rejected ? (
            <div className="panel panel--bad">
              <p>This plan breaks the rules below, so it cannot be approved.</p>
              <ViolationsTable violations={gate.violations} />
            </div>
          ) : null}
          <PlanDetails plan={plan} rationale={res.rationale} />
          {approvable && res.planText !== null ? (
            <ApprovePanel
              plan={plan}
              planText={res.planText}
              busy={busy}
              setBusy={setBusy}
              onCancel={onCancel}
              onStarted={onStarted}
              alive={alive}
            />
          ) : !rejected ? (
            <div className="panel">
              <p>This plan has no policy result, so it cannot be approved.</p>
            </div>
          ) : null}
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

      <div className="plan__grid">
        <div>
          <h3 className="h-small" id={captionId}>
            Stages
          </h3>
          <StageProfile stages={plan.stages.map((s) => ({ vus: s.vus, durationSec: s.durationSec, state: 'planned' as const }))} />
          <TableWrap label="Stages">
            <table className="table" aria-labelledby={captionId}>
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
        </div>
        <div>
          <h3 className="h-small">Stop thresholds</h3>
          <KeyValues
            items={[
              ['p95 latency limit', <span className="num">{fmt(plan.stopThresholds.p95Ms)} ms</span>],
              ['Error rate limit', <span className="num">{plan.stopThresholds.errorRatePct}%</span>],
            ]}
          />
        </div>
      </div>

      <h3 className="h-small">Journey</h3>
      <TableWrap label="Journey">
        <table className="table">
          <caption className="visually-hidden">Journey</caption>
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Method</th>
              <th scope="col">Path</th>
              <th scope="col" className="num">
                Probability (%)
              </th>
              <th scope="col" className="num">
                Think time (ms)
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.journey.map((step, i) => {
              const route = catalog.get(step.route);
              return (
                <tr key={`${step.route}-${i}`}>
                  <th scope="row" className="code">
                    {step.route}
                  </th>
                  {route ? (
                    <>
                      <td className="code">{route.method}</td>
                      <td className="code">{route.path}</td>
                    </>
                  ) : (
                    <td className="muted" colSpan={2}>
                      Not in the route catalog
                    </td>
                  )}
                  <td className="num">{step.probability}</td>
                  <td className="num">{fmt(step.thinkMs)}</td>
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
  alive,
}: {
  plan: TestPlan;
  planText: string;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onCancel: () => void;
  onStarted: (runId: string) => void;
  alive: React.RefObject<boolean>;
}) {
  const { announce } = useApp();
  const turnstile = useTurnstile();
  const [error, setError] = useState<ApiError | null>(null);
  const maxVus = plan.stages.reduce((m, s) => Math.max(m, s.vus), 0);
  const totalSec = plan.stages.reduce((sum, s) => sum + s.durationSec, 0);
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

  return (
    <section className="approve" aria-labelledby="approve-title">
      <div>
        <h2 id="approve-title">Approve this plan</h2>
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
