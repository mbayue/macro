import { Button } from '@/components/ui/button';
import type { useHybridPrompt } from '../hooks/useHybridPrompt.ts';
import { HybridStopButton } from './HybridBadge.tsx';
import { AlertRegion, Busy } from './ui.tsx';

interface Props {
  disabled: boolean;
  prompt: Pick<ReturnType<typeof useHybridPrompt>, 'busy' | 'error' | 'reply' | 'clearReply' | 'stop'>;
  onApply: (nextDraft: string) => void;
}

/** Inline Scenario Assistant suggestion card shown directly after clicking Refine. */
export function ScenarioAssistant({ disabled, prompt, onApply }: Props) {
  const { busy, error, reply, clearReply, stop } = prompt;

  if (!busy && !error && !reply) return null;

  return (
    <div aria-live="polite" className="flex flex-col gap-2.5">
      {busy && !reply ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-bar bg-background px-3.5 py-2.5">
          <Busy>Refining description…</Busy>
          <HybridStopButton busy={busy} onStop={stop} />
        </div>
      ) : null}

      <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

      {reply ? (
        <div className="flex flex-col gap-2.5 rounded-md border border-bar bg-background p-3.5">
          {busy ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">Streaming…</span>
              <HybridStopButton busy={busy} onStop={stop} />
            </div>
          ) : null}
          <p className="text-sm whitespace-pre-wrap text-foreground">{reply.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-[34px] rounded-md bg-foreground px-3.5 text-[0.8125rem] font-medium text-background hover:bg-foreground/90"
              disabled={disabled || busy}
              onClick={() => {
                onApply(reply.text);
                clearReply();
              }}
            >
              Apply to description
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[34px] rounded-md border-bar px-3 text-[0.8125rem]"
              disabled={busy}
              onClick={clearReply}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
