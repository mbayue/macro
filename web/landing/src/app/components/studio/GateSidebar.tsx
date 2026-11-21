import { useEffect, useRef, useState } from 'react';
import type { DemoTrendsResponse, PlanResponse, QuotaResponse } from '../../../../../../src/api-types.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn, reducedMotion } from '@/lib/utils';
import { useApp } from '../../context.tsx';
import { type ApiError, postApprove, VERIFICATION_ERROR } from '../../lib/api.ts';
import { GateRules } from '../GateRules.tsx';
import { fmtGrouped } from '../../lib/format.ts';
import { formatQuotaReadout } from '../shell/shell-view.ts';
import { StageProfile } from '../StageProfile.tsx';
import { TurnstileBox, useTurnstile } from '../Turnstile.tsx';
import { AlertRegion, Busy, ConfirmButton } from '../ui.tsx';
import {
  isApprovable,
  planSize,
  resolveGateStatus,
  type StudioBusy,
  type TargetMode,
} from './studio-view.ts';
import { CornerTicks, TelemetryPanel } from './TelemetryFrame.tsx';

const fmt = fmtGrouped;

export interface GateSidebarProps {
  review: PlanResponse | null;
  activeOrigin: string;
  targetMode: TargetMode;
  verifiedOrigin: { origin: string; host: string } | null;
  showVerify: boolean;
  quota: QuotaResponse | null;
  demoTrends: DemoTrendsResponse | null;
  sampleRunId: string | null | undefined;
  busy: StudioBusy;
  reviewSeq: number;
  checksDiffer: boolean;
  alive: React.RefObject<boolean>;
  startFromBar: React.RefObject<(() => void) | null>;
  onBusyChange: (b: StudioBusy) => void;
  onCancelPlan: () => void;
  onStarted: (runId: string) => void;
  onInViewChange: (inView: boolean) => void;
}

/**
 * Sticky right column (>= 1180px) stacking last below 1180px:
 * Policy Gate verdict & rules, Stage/VU preview, and spring-green Approve & Run gate with Turnstile.
 */
export function GateSidebar({
  review,
  activeOrigin,
  targetMode,
  verifiedOrigin,
  showVerify,
  quota,
  demoTrends,
  sampleRunId,
  busy,
  reviewSeq,
  checksDiffer,
  alive,
  startFromBar,
  onBusyChange,
  onCancelPlan,
  onStarted,
  onInViewChange,
}: GateSidebarProps) {
  const approvable = review !== null && isApprovable(review);
  const gateStatus = resolveGateStatus(review);
  const verdictTone = gateStatus.tone === 'ok' ? 'ok' : gateStatus.tone === 'bad' ? 'destructive' : 'outline';

  return (
    <aside
      className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20"
      aria-label={approvable && review?.plan ? 'Approve & Run' : 'Policy Gate rules'}
    >
      {review !== null ? (
        <TelemetryPanel
          ticks={gateStatus.tone === 'bad' ? 'bad' : gateStatus.tone === 'ok' ? 'accent' : 'bar'}
          tone={gateStatus.tone === 'bad' ? 'bad' : 'default'}
          aria-labelledby="sidebar-gate-verdict"
          className="gap-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sidebar-gate-verdict" className="m-0 font-sans text-sm font-medium text-muted-foreground">
              Policy Gate
            </h2>
            <Badge variant={verdictTone}>{gateStatus.label}</Badge>
          </div>
          <p className="text-sm text-foreground">{gateStatus.summary}</p>
          {review.gate?.status === 'rejected' ? (
            <p className="font-mono text-xs text-bad tabular-nums">
              {review.gate.violations.length} rule {review.gate.violations.length === 1 ? 'violation' : 'violations'}
            </p>
          ) : null}
        </TelemetryPanel>
      ) : null}

      <GateRules folded={review !== null || showVerify} targetOrigin={activeOrigin} />

      {review?.plan && review.plan.stages.length > 0 ? (
        <StagePreviewCard plan={review.plan} />
      ) : null}

      {approvable && review?.plan && review.planText !== null ? (
        <ApprovePanel
          key={reviewSeq}
          plan={review.plan}
          planText={review.planText}
          targetMode={targetMode}
          {...(targetMode === 'own' && verifiedOrigin !== null ? { targetOrigin: verifiedOrigin.origin } : {})}
          draftId={review.draftId}
          busy={busy}
          setBusy={onBusyChange}
          onCancel={onCancelPlan}
          onStarted={onStarted}
          onInView={onInViewChange}
          startFromBar={startFromBar}
          alive={alive}
          checksDiffer={checksDiffer}
        />
      ) : review === null && !showVerify ? (
        <>
          {targetMode === 'demo' && sampleRunId ? (
            <TelemetryPanel ticks="bar" aria-labelledby="sample-report-heading">
              <h2 id="sample-report-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                Sample report
              </h2>
              <p className="text-sm text-muted-foreground">
                Inspect a completed public demo run with stages, charts, and capacity verdict.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  render={<a href={`#/run/${sampleRunId}`} />}
                  nativeButton={false}
                  variant="secondary"
                >
                  View sample report
                </Button>
              </div>
            </TelemetryPanel>
          ) : null}

          {quota ? (
            <TelemetryPanel ticks="bar" aria-labelledby="quota-panel-heading">
              <h2 id="quota-panel-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                Usage quota
              </h2>
              <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Plans left (1h)</dt>
                <dd className="m-0 font-mono text-foreground tabular-nums">
                  {formatQuotaReadout(quota)?.planning}
                </dd>
                <dt className="text-muted-foreground">Runs left (today)</dt>
                <dd className="m-0 font-mono text-foreground tabular-nums">
                  {formatQuotaReadout(quota)?.dailyRuns}
                </dd>
                <dt className="text-muted-foreground">Scope</dt>
                <dd className="m-0 text-foreground">{quota.scope === 'account' ? 'Your account' : 'This IP'}</dd>
              </dl>
            </TelemetryPanel>
          ) : null}

          {targetMode === 'demo' && demoTrends?.available && demoTrends.routes.length > 0 ? (
            <TelemetryPanel ticks="bar" aria-labelledby="demo-baseline-heading">
              <div className="flex flex-col gap-1">
                <h2 id="demo-baseline-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
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
    </aside>
  );
}

function StagePreviewCard({ plan }: { plan: TestPlan }) {
  const { maxVus, totalSec } = planSize(plan);
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="sidebar-stage-preview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sidebar-stage-preview" className="m-0 font-sans text-sm font-medium text-foreground">
          Stage &amp; VU preview
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {plan.stages.length} {plan.stages.length === 1 ? 'stage' : 'stages'} · max {fmt(maxVus)} VUs · {fmt(totalSec)} s
        </span>
      </div>

      <ol className="sr-only" aria-labelledby="sidebar-stage-preview">
        {plan.stages.map((s, i) => (
          <li key={i}>
            Stage {i + 1}: {fmt(s.vus)} VUs for {s.durationSec} s
          </li>
        ))}
      </ol>

      <StageProfile
        compact
        mode="preview"
        stages={plan.stages.map((s) => ({ vus: s.vus, durationSec: s.durationSec, state: 'planned' as const }))}
      />

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
        <span>p95 limit {fmt(plan.stopThresholds.p95Ms)} ms</span>
        <span>err limit {plan.stopThresholds.errorRatePct}%</span>
      </div>
    </TelemetryPanel>
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
  busy: StudioBusy;
  setBusy: (b: StudioBusy) => void;
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

  const onSpringOutline = cn(
    buttonVariants({ variant: 'outline' }),
    'border-primary-foreground bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground hover:border-primary-foreground focus-visible:outline-primary-foreground',
  );

  const onSpringDanger = cn(
    buttonVariants({ variant: 'destructive' }),
    'bg-background text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-primary-foreground',
  );

  return (
    <section
      ref={section}
      aria-labelledby="approve-title"
      className="relative flex w-full flex-col gap-4 rounded-md bg-primary p-6 text-primary-foreground [&_:focus-visible]:outline-primary-foreground"
    >
      <CornerTicks tone="ink" />

      <div className="flex flex-col gap-1.5">
        <h2
          id="approve-title"
          ref={heading}
          tabIndex={-1}
          className="m-0 font-display text-[1.75rem] leading-[1.1] font-light tracking-[-0.02em] text-primary-foreground"
        >
          Approve &amp; Run
        </h2>
        <p className="text-sm text-accent-ink-soft">
          Nothing is sent until you approve. Approving locks the Approved Plan and starts the run right away.
        </p>
      </div>

      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-sm">
        <dt className="text-accent-ink-soft">Target</dt>
        <dd className="m-0 min-w-0 font-mono text-xs break-all text-primary-foreground">{plan.target}</dd>
        <dt className="text-accent-ink-soft">Maximum VUs</dt>
        <dd className="m-0 font-mono text-primary-foreground tabular-nums">{fmt(maxVus)}</dd>
        <dt className="text-accent-ink-soft">Total stage duration</dt>
        <dd className="m-0 font-mono text-primary-foreground tabular-nums">{fmt(totalSec)} s</dd>
      </dl>

      <TurnstileBox boxRef={turnstile.box} />

      <div className="flex flex-col gap-2.5">
        <Button
          type="button"
          variant="ink"
          disabled={!idle || checksDiffer}
          onClick={() => void approve()}
          className="w-full"
        >
          Approve & Run
        </Button>

        <div className="flex flex-wrap items-center gap-2.5">
          <ConfirmButton
            label="Cancel"
            confirmLabel="Discard plan"
            cancelLabel="Keep"
            className={onSpringOutline}
            confirmClassName={onSpringDanger}
            cancelClassName={onSpringOutline}
            disabled={!idle}
            onConfirm={onCancel}
          />
          {busy === 'approving' ? <Busy className="text-accent-ink-soft">Starting the run…</Busy> : null}
        </div>
      </div>

      {checksDiffer ? (
        <p className="text-sm font-medium text-primary-foreground">Revise the plan to use these checks.</p>
      ) : null}

      <AlertRegion
        error={error}
        className={cn(error && 'border-destructive bg-background text-foreground')}
      />
    </section>
  );
}

/** Narrow screens (< 1180px): the approve action stays in reach while the plan scrolls by. */
export function ApproveBar({
  plan,
  hidden,
  disabled,
  onApprove,
}: {
  plan: TestPlan;
  hidden: boolean;
  disabled: boolean;
  onApprove: () => void;
}) {
  if (hidden) return null;
  const { maxVus, totalSec } = planSize(plan);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-primary-foreground/20 bg-primary px-4 py-3 text-primary-foreground min-[861px]:left-[var(--rail)] min-[861px]:px-10 min-[1180px]:hidden"
      role="region"
      aria-label="Approve & Run"
    >
      <p className="m-0 text-sm text-primary-foreground">
        <span className="font-mono font-medium tabular-nums">{fmt(maxVus)}</span> VUs at most,{' '}
        <span className="font-mono font-medium tabular-nums">{fmt(totalSec)}</span> s in total
      </p>
      <Button
        type="button"
        variant="ink"
        disabled={disabled}
        onClick={onApprove}
        className="flex-1 sm:flex-none"
      >
        Approve & Run
      </Button>
    </div>
  );
}
