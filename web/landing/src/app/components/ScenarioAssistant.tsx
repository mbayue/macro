import { useId, useState } from 'react';
import { SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useHybridPrompt } from '../hooks/useHybridPrompt.ts';
import { buildScenarioPrompt } from '../lib/hybrid-ai.ts';
import { HybridBadge } from './HybridBadge.tsx';
import { AlertRegion, Busy } from './ui.tsx';
import { CornerTicks } from './studio/TelemetryFrame.tsx';

const PRESETS = [
  'Add ramp-up and peak spike stages',
  'Target the catalog routes with realistic user mix',
  'Tighten clarity and state exact user count and duration',
] as const;

interface Props {
  draft: string;
  routes: readonly string[];
  disabled: boolean;
  onApply: (nextDraft: string) => void;
}

/** Pre-submission Scenario Assistant that refines Traffic Descriptions via Hybrid Inference. */
export function ScenarioAssistant({ draft, routes, disabled, onApply }: Props) {
  const { available, busy, error, reply, clearReply, run } = useHybridPrompt();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState<string>(PRESETS[0]);
  const panelId = useId();
  const inputId = useId();

  if (!available) return null;

  async function refine(goal: string) {
    if (disabled) return;
    const trimmed = goal.trim() || PRESETS[0];
    await run(
      buildScenarioPrompt({ draft, instruction: trimmed, routes }),
      'Refining traffic description with Hybrid AI.',
      'Suggestion ready',
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          type="button"
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={disabled}
          className="border-bar bg-background hover:border-bar-hover"
          onClick={() => setOpen((v) => !v)}
        >
          <SparklesIcon data-icon="inline-start" />
          {open ? 'Hide Scenario Assistant' : 'Scenario Assistant'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Runs on-device when supported; does not use server planning quota.
        </span>
      </div>

      {open ? (
        <div
          id={panelId}
          className="relative flex flex-col gap-3 rounded-md border border-bar bg-background p-3.5"
        >
          <CornerTicks tone="bar" />

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Refinement presets">
            {PRESETS.map((preset) => {
              const active = instruction === preset;
              return (
                <Button
                  key={preset}
                  type="button"
                  variant={active ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={active}
                  disabled={busy || disabled}
                  className={cn(
                    active ? 'border-accent-text bg-secondary text-foreground' : 'border-bar bg-background hover:border-bar-hover',
                  )}
                  onClick={() => {
                    setInstruction(preset);
                    void refine(preset);
                  }}
                >
                  {preset}
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={inputId} className="sr-only">
              Refinement instruction
            </label>
            <input
              id={inputId}
              type="text"
              value={instruction}
              disabled={busy || disabled}
              placeholder="e.g. Ramp from 25 to 200 users over 4 minutes"
              className="h-10 min-w-[220px] flex-1 rounded-md border border-bar bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void refine(instruction);
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy || disabled}
              className="border border-bar-hover"
              onClick={() => void refine(instruction)}
            >
              Draft suggestion
            </Button>
          </div>

          {busy ? <Busy>Refining description…</Busy> : null}
          <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

          {reply ? (
            <div className="flex flex-col gap-2.5 rounded-md border border-bar bg-surface p-3.5" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <HybridBadge origin={reply.origin} />
              </div>
              <p className="text-sm whitespace-pre-wrap text-foreground">{reply.text}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onApply(reply.text);
                    clearReply();
                    setOpen(false);
                  }}
                >
                  Apply to description
                </Button>
                <Button type="button" variant="outline" className="border-bar" onClick={clearReply}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
