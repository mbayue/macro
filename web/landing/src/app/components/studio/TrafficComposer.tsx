import { type RefObject, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useHybridPrompt } from '../../hooks/useHybridPrompt.ts';
import type { ApiError } from '../../lib/api.ts';
import { buildScenarioPrompt } from '../../lib/hybrid-ai.ts';
import { HybridAvailabilityBadge } from '../HybridBadge.tsx';
import { ScenarioAssistant } from '../ScenarioAssistant.tsx';
import { AlertRegion, Busy } from '../ui.tsx';
import { type StudioBusy, trafficSubmitProblem } from './studio-view.ts';
import { TelemetryPanel } from './TelemetryFrame.tsx';
import { fmtGrouped as fmt } from '../../lib/format.ts';

export interface TrafficComposerProps {
  text: string;
  min: number;
  max: number;
  count: number;
  inRange: boolean;
  problem: string;
  busy: StudioBusy;
  hasReview: boolean;
  editing: boolean;
  showRetry: boolean;
  ownNeedsVerify: boolean;
  examples: readonly { label: string; text: string }[];
  assistantRoutes: readonly string[];
  planError: ApiError | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (next: string) => void;
  onBlurSync: () => void;
  onSubmitDraft: () => void;
  onKeepPlan: () => void;
  onRetry: () => void;
  onApplyAssistant: (nextDraft: string) => void;
}

/** Traffic Description composer with tabular character readout, example chips, and Scenario Assistant. */
export function TrafficComposer({
  text,
  min,
  max,
  count,
  inRange,
  problem,
  busy,
  hasReview,
  editing,
  showRetry,
  ownNeedsVerify,
  examples,
  assistantRoutes,
  planError,
  textareaRef,
  onTextChange,
  onBlurSync,
  onSubmitDraft,
  onKeepPlan,
  onRetry,
  onApplyAssistant,
}: TrafficComposerProps) {
  const idle = busy === null;
  // Set when the user submits text that cannot be drafted; the error then shows even for an empty box.
  const [attempted, setAttempted] = useState(false);
  const assistant = useHybridPrompt();
  const shownProblem = problem !== '' ? problem : attempted ? trafficSubmitProblem(text, min, max) : '';
  const invalid = shownProblem !== '';

  function refineDirectly() {
    if (!idle || assistant.busy || !assistant.canRun) return;
    void assistant.run(
      buildScenarioPrompt({
        draft: text,
        instruction: assistant.remoteConfig.scenarioAssistantInstruction,
        routes: assistantRoutes,
      }),
      'Refining traffic description with Hybrid AI.',
      'Suggestion ready',
    );
  }

  function submit() {
    if (!idle) return;
    if (!inRange) {
      setAttempted(true);
      textareaRef.current?.focus();
      return;
    }
    setAttempted(false);
    onSubmitDraft();
  }

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="traffic-event-label">
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label id="traffic-event-label" htmlFor="traffic-event" className="font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
              Traffic Description
            </label>
            {assistant.available ? (
              <HybridAvailabilityBadge
                availability={assistant.availability}
                cloudModel={assistant.remoteConfig.cloudModel}
              />
            ) : null}
          </div>
          <p id="traffic-event-hint" className="text-sm text-muted-foreground">
            Describe the routes, virtual-user ramp, and stop thresholds in plain English. Nothing reaches the target until you approve.{' '}
            <kbd className="rounded-sm border border-bar bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              Ctrl+Enter
            </kbd>{' '}
            to draft.
          </p>
        </div>

        {examples.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Example traffic descriptions">
            {examples.map((ex) => {
              const active = text.trim() === ex.text.trim();
              return (
                <Button
                  key={ex.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!idle}
                  aria-pressed={active}
                  className={cn(
                    'min-h-8 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors max-[860px]:min-h-10',
                    active
                      ? 'border-[var(--ap-line-strong)] bg-secondary text-foreground hover:bg-secondary'
                      : 'border-transparent bg-transparent text-muted-foreground hover:border-[var(--ap-line-strong)] hover:bg-secondary/60 hover:text-foreground',
                  )}
                  onClick={() => {
                    setAttempted(false);
                    onTextChange(ex.text);
                    textareaRef.current?.focus();
                  }}
                >
                  {ex.label}
                </Button>
              );
            })}
          </div>
        ) : null}

        <textarea
          id="traffic-event"
          ref={textareaRef}
          rows={5}
          autoComplete="off"
          value={text}
          readOnly={!idle}
          aria-labelledby="traffic-event-label"
          aria-describedby="traffic-event-hint traffic-event-count traffic-event-problem"
          aria-invalid={invalid}
          placeholder="e.g. Ramp from 20 to 150 shoppers over 3 minutes browsing the catalog and opening product pages."
          className={cn(
            'min-h-32 w-full resize-y rounded-md border bg-background px-3.5 py-3 text-[0.9375rem] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring read-only:opacity-70',
            invalid ? 'border-bad' : 'border-bar',
          )}
          onChange={(e) => {
            setAttempted(false);
            onTextChange(e.target.value);
          }}
          onBlur={onBlurSync}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              id="traffic-event-count"
              className={cn('font-mono tabular-nums', invalid ? 'font-medium text-bad' : 'text-muted-foreground')}
            >
              {fmt(count)} / {fmt(max)} chars{assistant.canRun ? ' · Scenario Assistant ready' : ''}
            </span>
            <span id="traffic-event-problem" className="font-medium text-bad" role="status">
              {shownProblem}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasReview && editing ? (
              <Button type="button" variant="outline" size="sm" className="h-[34px] rounded-md border-[var(--ap-line-strong)] bg-surface px-3 text-[0.8125rem]" disabled={!idle} onClick={onKeepPlan}>
                Keep the current plan
              </Button>
            ) : null}
            {showRetry ? (
              <Button type="button" variant="secondary" size="sm" className="h-[34px] rounded-md px-3 text-[0.8125rem]" disabled={!idle} onClick={onRetry}>
                Retry planning
              </Button>
            ) : null}
            {assistant.available ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!idle || assistant.busy || !assistant.canRun}
                aria-busy={assistant.busy || undefined}
                className="h-[34px] rounded-md border-[var(--ap-line-strong)] bg-surface px-3 text-[0.8125rem] font-medium text-foreground hover:bg-secondary"
                onClick={refineDirectly}
              >
                {assistant.busy ? 'Refining…' : 'Refine with Scenario Assistant'}
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={!idle}
              className="h-[34px] rounded-md bg-foreground px-3.5 text-[0.8125rem] font-medium text-background hover:bg-foreground/90"
            >
              {hasReview ? 'Re-draft Test Plan' : 'Draft a plan'}
            </Button>
          </div>
        </div>

        {busy === 'planning' ? (
          <Busy>Drafting a plan. This can take up to a minute.</Busy>
        ) : ownNeedsVerify ? (
          <span className="text-xs text-muted-foreground">Verify your site above before drafting.</span>
        ) : idle && count === 0 && !attempted ? (
          <span className="text-xs text-muted-foreground">Write at least {min} characters to draft.</span>
        ) : null}

        {assistant.available ? (
          <ScenarioAssistant
            disabled={!idle}
            prompt={assistant}
            onApply={onApplyAssistant}
          />
        ) : null}

        <AlertRegion error={planError} />
      </form>
    </TelemetryPanel>
  );
}
