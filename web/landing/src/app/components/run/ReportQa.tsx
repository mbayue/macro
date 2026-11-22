import { memo, useEffect, useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CapacityReport } from '../../../../../../src/report/build.ts';
import { useApp } from '../../context.tsx';
import { useHybridPrompt } from '../../hooks/useHybridPrompt.ts';
import { buildReportQaPrompt, verifyReportQaReply } from '../../lib/hybrid-ai.ts';
import { fetchQaPrompts } from '../../lib/scenario-templates.ts';
import { HybridStatusBadge, HybridStopButton } from '../HybridBadge.tsx';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';
import { AlertRegion, Busy } from '../ui.tsx';

const QUICK_QUESTIONS = [
  'Why did this run pass or fail?',
  'Which route was slowest and by how much?',
  'What should I tune before re-running?',
] as const;

/** AI-labelled Report Q&A panel grounded strictly in measured CapacityReport metrics. */
export const ReportQa = memo(function ReportQa({ report }: { report: CapacityReport }) {
  const { config } = useApp();
  const { available, canRun, availability, remoteConfig, busy, completed, error, reply, run, stop } = useHybridPrompt();
  const [question, setQuestion] = useState('');
  const [quickQuestions, setQuickQuestions] = useState<readonly string[]>(QUICK_QUESTIONS);
  const headingId = useId();
  const inputId = useId();
  const numberCheck = useMemo(
    () => (completed && reply ? verifyReportQaReply(reply.text, report) : null),
    [completed, reply, report],
  );

  useEffect(() => {
    const firebase = config.firebase;
    if (!firebase) return;
    let cancelled = false;
    void fetchQaPrompts(firebase, QUICK_QUESTIONS).then((prompts) => {
      if (!cancelled) setQuickQuestions(prompts);
    });
    return () => {
      cancelled = true;
    };
  }, [config.firebase]);

  if (!available) return null;

  async function ask(q: string) {
    if (busy || !canRun) return;
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    await run(
      buildReportQaPrompt(report, trimmed, remoteConfig.reportQaSystemInstruction),
      'Answering question from measured report metrics.',
      'Answer ready',
    );
  }

  return (
    <TelemetryPanel ticks="bar" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="m-0 flex items-center gap-2 font-sans text-[1.0625rem] font-medium text-foreground">
          <span>Report Q&amp;A</span>
          <Badge variant="secondary">AI</Badge>
        </h2>
        <HybridStatusBadge reply={reply} availability={availability} cloudModel={remoteConfig.cloudModel} />
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Ask follow-up questions about these measured stage and route metrics. Prefers on-device Gemini Nano with cloud Gemini fallback.
      </p>

      <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Suggested report questions">
        {quickQuestions.map((q) => (
          <Button
            key={q}
            type="button"
            variant="outline"
            size="sm"
            className="border-bar bg-background text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={busy || !canRun || undefined}
            onClick={() => void ask(q)}
          >
            {q}
          </Button>
        ))}
      </div>

      <form
        className="flex flex-wrap gap-2 print:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask a question about this capacity report
        </label>
        <input
          id={inputId}
          name="question"
          type="text"
          autoComplete="off"
          value={question}
          readOnly={busy || !canRun}
          aria-busy={busy || undefined}
          placeholder="Ask about latency, breaking point, or route errors…"
          onChange={(e) => setQuestion(e.target.value)}
          className="min-h-10 min-w-[240px] flex-1 rounded-md border border-bar bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-accent-text focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring read-only:opacity-60"
        />
        <Button
          type="submit"
          variant="secondary"
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          aria-disabled={busy || !canRun || question.trim() === '' || undefined}
        >
          Ask
        </Button>
        <HybridStopButton busy={busy} onStop={stop} />
      </form>

      {busy && !reply ? <Busy>Thinking…</Busy> : null}
      <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

      {/* The live region is always in the page, so screen readers hear the answer when it arrives. */}
      <div aria-live="polite">
        {reply ? (
          <div className="flex flex-col gap-2 rounded-md border border-bar bg-background p-3.5">
            {busy ? (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">Streaming answer…</span>
              </div>
            ) : null}
            <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{reply.text}</p>
            {numberCheck && !numberCheck.ok ? (
              <p className="m-0 text-xs text-warn">
                Contains numbers not in the measured report — verify against the tables above
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </TelemetryPanel>
  );
});
