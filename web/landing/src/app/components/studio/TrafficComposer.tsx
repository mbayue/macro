import { type RefObject, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ApiError } from '../../lib/api.ts';
import { ScenarioAssistant } from '../ScenarioAssistant.tsx';
import { AlertRegion, Busy } from '../ui.tsx';
import { type StudioBusy, trafficSubmitProblem } from './studio-view.ts';
import { TelemetryPanel } from './TelemetryFrame.tsx';

const fmt = (n: number): string => n.toLocaleString('en-US');

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
  const shownProblem = problem !== '' ? problem : attempted ? trafficSubmitProblem(text, min, max) : '';
  const invalid = shownProblem !== '';

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
        <div className="flex flex-col gap-1">
          <label id="traffic-event-label" htmlFor="traffic-event" className="text-[1.0625rem] font-medium text-foreground">
            Traffic description
          </label>
          <p id="traffic-event-hint" className="text-sm text-muted-foreground">
            Describe the traffic you expect: say who arrives, when, and what they do.{' '}
            <span className="font-mono text-xs tabular-nums">{min}</span> to{' '}
            <span className="font-mono text-xs tabular-nums">{fmt(max)}</span> characters. Press{' '}
            <kbd className="rounded-sm border border-bar bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              Ctrl+Enter
            </kbd>{' '}
            to draft.
          </p>
        </div>

        <textarea
          id="traffic-event"
          ref={textareaRef}
          rows={6}
          autoComplete="off"
          value={text}
          readOnly={!idle}
          aria-labelledby="traffic-event-label"
          aria-describedby="traffic-event-hint traffic-event-count traffic-event-problem"
          aria-invalid={invalid}
          placeholder="e.g. Ramp from 20 to 150 shoppers over 3 minutes browsing the catalog and opening product pages."
          className={cn(
            'min-h-36 w-full resize-y rounded-md border bg-background px-3.5 py-3 text-[1.0625rem] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring read-only:opacity-70',
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

        <div className="flex min-h-[1.5em] flex-wrap items-center justify-between gap-3 text-xs">
          <span
            id="traffic-event-count"
            className={cn('font-mono tabular-nums', invalid ? 'font-medium text-bad' : 'text-muted-foreground')}
          >
            {fmt(count)} / {fmt(max)}
          </span>
          <span id="traffic-event-problem" className="font-medium text-bad" role="status">
            {shownProblem}
          </span>
        </div>

        {examples.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Examples">
            <span className="text-xs text-muted-foreground max-[860px]:basis-full">
              Examples fill the text box only:
            </span>
            {examples.map((ex) => (
              <Button
                key={ex.label}
                type="button"
                variant="outline"
                size="sm"
                disabled={!idle}
                className="border-bar bg-background hover:border-bar-hover max-[860px]:min-h-10"
                onClick={() => {
                  setAttempted(false);
                  onTextChange(ex.text);
                  textareaRef.current?.focus();
                }}
              >
                {ex.label}
              </Button>
            ))}
          </div>
        ) : null}

        <ScenarioAssistant
          draft={text}
          routes={assistantRoutes}
          disabled={!idle}
          onApply={onApplyAssistant}
        />

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" disabled={!idle}>
            {hasReview ? 'Draft a new plan' : 'Draft a plan'}
          </Button>
          {hasReview && editing ? (
            <Button type="button" variant="outline" className="border-bar" disabled={!idle} onClick={onKeepPlan}>
              Keep the current plan
            </Button>
          ) : null}
          {showRetry ? (
            <Button type="button" variant="secondary" disabled={!idle} onClick={onRetry}>
              Retry planning
            </Button>
          ) : null}
          {busy === 'planning' ? (
            <Busy>Drafting a plan. This can take up to a minute.</Busy>
          ) : ownNeedsVerify ? (
            <span className="text-sm text-muted-foreground">Verify your site above before drafting.</span>
          ) : idle && count === 0 && !attempted ? (
            <span className="text-sm text-muted-foreground">Write at least {min} characters to draft.</span>
          ) : null}
        </div>

        <AlertRegion error={planError} />
      </form>
    </TelemetryPanel>
  );
}
