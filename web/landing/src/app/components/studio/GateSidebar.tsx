import { useEffect, useRef, useState } from 'react';
import type { PlanResponse } from '../../../../../../src/api-types.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn, reducedMotion } from '@/lib/utils';
import { useApp } from '../../context.tsx';
import { type ApiError, postApprove, VERIFICATION_ERROR } from '../../lib/api.ts';
import { GateRules } from '../GateRules.tsx';
import { fmtGrouped } from '../../lib/format.ts';
import { TurnstileBox, useTurnstile } from '../Turnstile.tsx';
import { AlertRegion, Busy, ConfirmButton } from '../ui.tsx';
import {
  isApprovable,
  planSize,
  resolveGateStatus,
  type StudioBusy,
  type TargetMode,
} from './studio-view.ts';
import { DitherBanner, TelemetryPanel } from './TelemetryFrame.tsx';

const fmt = fmtGrouped;
const TAG_CLASS = 'px-2 py-[3px] font-mono text-xs leading-[1.2]';

export interface GateSidebarProps {
  review: PlanResponse | null;
  activeOrigin: string;
  targetMode: TargetMode;
  verifiedOrigin: { origin: string; host: string } | null;
  sampleRunId: string | null | undefined;
  busy: StudioBusy;
  reviewSeq: number;
  pendingRouteIds: string[] | null;
  alive: React.RefObject<boolean>;
  startFromBar: React.RefObject<(() => void) | null>;
  onBusyChange: (b: StudioBusy) => void;
  onCancelPlan: () => void;
  onRevisePlan: (routeIds: string[]) => void;
  onStarted: (runId: string) => void;
  onInViewChange: (inView: boolean) => void;
}

/**
 * Sticky right column (>= 1180px) stacking last below 1180px:
 * the spring-green Approve & Run gate with Turnstile, the Policy Gate verdict, then the rules. The plan's stages live in the Draft plan, not here.
 */
export function GateSidebar({
  review,
  activeOrigin,
  targetMode,
  verifiedOrigin,
  sampleRunId,
  busy,
  reviewSeq,
  pendingRouteIds,
  alive,
  startFromBar,
  onBusyChange,
  onCancelPlan,
  onRevisePlan,
  onStarted,
  onInViewChange,
}: GateSidebarProps) {
  const approvable = review !== null && isApprovable(review);
  const gateStatus = resolveGateStatus(review);
  const verdictTone = gateStatus.tone === 'ok' ? 'ok' : gateStatus.tone === 'bad' ? 'destructive' : 'outline';

  return (
    <aside
      className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20"
      aria-label={approvable && review?.plan ? 'Policy Gate Verdict and Approve & Run' : 'Policy Gate rules'}
    >
      {review !== null ? (
        <VerdictAndApprovePanel
          key={reviewSeq}
          review={review}
          approvable={approvable}
          gateStatus={gateStatus}
          verdictTone={verdictTone}
          targetMode={targetMode}
          {...(targetMode === 'own' && verifiedOrigin !== null ? { targetOrigin: verifiedOrigin.origin } : {})}
          busy={busy}
          setBusy={onBusyChange}
          onCancel={onCancelPlan}
          onRevise={onRevisePlan}
          onStarted={onStarted}
          onInView={onInViewChange}
          startFromBar={startFromBar}
          alive={alive}
          pendingRouteIds={pendingRouteIds}
        />
      ) : (
        <GateRules
          folded={false}
          targetOrigin={activeOrigin}
          banner={
            <DitherBanner
              src="/landing/img/dither/sanok-span.webp"
              label="Policy Gate & Stage Preview"
              meta="Ready"
            />
          }
        />
      )}

      {review === null && targetMode === 'demo' && sampleRunId ? (
        <TelemetryPanel ticks="bar" aria-labelledby="sample-report-heading">
          <h2 id="sample-report-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
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
    </aside>
  );
}


function VerdictAndApprovePanel({
  review,
  approvable,
  gateStatus,
  verdictTone,
  targetMode,
  targetOrigin,
  busy,
  setBusy,
  onCancel,
  onRevise,
  onStarted,
  onInView,
  startFromBar,
  alive,
  pendingRouteIds,
}: {
  review: PlanResponse;
  approvable: boolean;
  gateStatus: ReturnType<typeof resolveGateStatus>;
  verdictTone: 'ok' | 'destructive' | 'outline';
  targetMode: TargetMode;
  targetOrigin?: string;
  busy: StudioBusy;
  setBusy: (b: StudioBusy) => void;
  onCancel: () => void;
  onRevise: (routeIds: string[]) => void;
  onStarted: (runId: string) => void;
  onInView: (inView: boolean) => void;
  startFromBar: React.RefObject<(() => void) | null>;
  alive: React.RefObject<boolean>;
  pendingRouteIds: string[] | null;
}) {
  const { announce } = useApp();
  const turnstile = useTurnstile();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const plan = review.plan;
  const planText = review.planText;
  const idle = busy === null;
  const canApprove = approvable && plan !== null && planText !== null;
  const needsRevise = pendingRouteIds !== null;

  const rejectedCount = review.gate?.status === 'rejected' ? review.gate.violations.length : 0;
  const bannerMeta = canApprove
    ? '3/3 rules PASS'
    : rejectedCount > 0
      ? `${rejectedCount} ${rejectedCount === 1 ? 'rule' : 'rules'} BLOCKED`
      : gateStatus.label;

  async function approve() {
    if (!canApprove || !idle || needsRevise) return;
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
        ...(targetMode === 'own' ? { draftId: review.draftId } : {}),
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
    if (!canApprove) {
      startFromBar.current = null;
      return;
    }
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
    if (!el || !canApprove || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => onInView(entry?.isIntersecting ?? true), { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      onInView(true);
    };
  }, [canApprove, onInView]);

  return (
    <TelemetryPanel
      ref={section}
      ticks={gateStatus.tone === 'bad' ? 'bad' : 'bar'}
      tone={gateStatus.tone === 'bad' ? 'bad' : 'default'}
      aria-labelledby="sidebar-gate-verdict"
      className="gap-4"
    >
      <DitherBanner
        src="/landing/img/dither/sanok-span.webp"
        label="Policy Gate"
        meta={bannerMeta}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="sidebar-gate-verdict"
          ref={heading}
          tabIndex={-1}
          className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground"
        >
          Policy Gate Verdict
        </h2>
        <Badge variant={verdictTone} className={TAG_CLASS}>
          {canApprove ? 'Approved Plan' : gateStatus.label}
        </Badge>
      </div>

      <p className="m-0 text-sm text-muted-foreground">
        {canApprove
          ? 'Fixed code verified the allowlist, VU/duration bounds, and stop thresholds. Nothing reaches the target until you approve.'
          : gateStatus.summary}
      </p>

      {rejectedCount > 0 ? (
        <p className="m-0 font-mono text-xs text-bad tabular-nums">
          {rejectedCount} rule {rejectedCount === 1 ? 'violation' : 'violations'} — revise the plan before running.
        </p>
      ) : null}

      {canApprove ? (
        <>
          <TurnstileBox boxRef={turnstile.box} />

          <div className="flex flex-col gap-2">
            {needsRevise ? (
              <Button
                type="button"
                variant="ink"
                disabled={!idle}
                onClick={() => onRevise(pendingRouteIds)}
                className="w-full"
              >
                {busy === 'planning' ? 'Revising plan…' : 'Revise the plan'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                disabled={!idle}
                onClick={() => void approve()}
                className="w-full"
              >
                Approve &amp; Run
              </Button>
            )}

            <ConfirmButton
              label="Cancel"
              confirmLabel="Discard plan"
              cancelLabel="Keep"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-[34px] w-full border-[var(--ap-line-strong)] bg-surface text-[0.8125rem] text-foreground hover:bg-secondary')}
              confirmClassName={cn(buttonVariants({ variant: 'destructive', size: 'sm' }), 'h-[34px] flex-1 text-[0.8125rem]')}
              cancelClassName={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-[34px] flex-1 border-[var(--ap-line-strong)] bg-surface text-[0.8125rem]')}
              groupClassName="flex w-full gap-2"
              disabled={!idle}
              onConfirm={onCancel}
            />

            {busy === 'approving' ? <Busy>Starting the run…</Busy> : null}
            {busy === 'planning' ? <Busy>Revising the plan…</Busy> : null}
          </div>

          <AlertRegion error={error} />
        </>
      ) : null}

      <div className="border-t border-border pt-3.5">
        <h3 className="m-0 text-xs font-medium text-muted-foreground">What the policy gate allows</h3>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 font-mono text-xs">
          <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <span className="font-sans text-muted-foreground">Stages</span>
            <span className="rounded-sm border border-[var(--ap-line-strong)] bg-background px-2 py-0.5 text-foreground">
              1 to 6, ascending VUs
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <span className="font-sans text-muted-foreground">Users per stage</span>
            <span className="rounded-sm border border-[var(--ap-line-strong)] bg-background px-2 py-0.5 text-foreground tabular-nums">
              1 to 500
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-sans text-muted-foreground">Stage length</span>
            <span className="rounded-sm border border-[var(--ap-line-strong)] bg-background px-2 py-0.5 text-foreground tabular-nums">
              30 to 180 s (max 600 s)
            </span>
          </li>
        </ul>
      </div>
    </TelemetryPanel>
  );
}

/** Narrow screens (< 1180px): the approve action stays in reach while the plan scrolls by. */
export function ApproveBar({
  plan,
  hidden,
  disabled,
  needsRevise,
  onApprove,
  onRevise,
}: {
  plan: TestPlan;
  hidden: boolean;
  disabled: boolean;
  needsRevise: boolean;
  onApprove: () => void;
  onRevise: () => void;
}) {
  if (hidden) return null;
  const { maxVus, totalSec } = planSize(plan);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-primary-foreground/20 bg-primary px-4 py-3 text-primary-foreground min-[861px]:left-[var(--rail)] min-[861px]:px-10 min-[1180px]:hidden"
      role="region"
      aria-label={needsRevise ? 'Revise the plan' : 'Approve & Run'}
    >
      <p className="m-0 text-sm text-primary-foreground">
        <span className="font-mono font-medium tabular-nums">{fmt(maxVus)}</span> VUs at most,{' '}
        <span className="font-mono font-medium tabular-nums">{fmt(totalSec)}</span> s in total
      </p>
      <Button
        type="button"
        variant="ink"
        disabled={disabled}
        onClick={needsRevise ? onRevise : onApprove}
        className="flex-1 sm:flex-none"
      >
        {needsRevise ? 'Revise the plan' : 'Approve & Run'}
      </Button>
    </div>
  );
}
