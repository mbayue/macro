import { memo, useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CapacityReport } from '../../../../../../src/report/build.ts';
import { useHybridPrompt } from '../../hooks/useHybridPrompt.ts';
import { buildReportQaPrompt } from '../../lib/hybrid-ai.ts';
import { HybridBadge } from '../HybridBadge.tsx';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';
import { AlertRegion, Busy } from '../ui.tsx';

const QUICK_QUESTIONS = [
  'Why did this run pass or fail?',
  'Which route was slowest and by how much?',
  'What should I tune before re-running?',
] as const;

/** AI-labelled Report Q&A panel grounded strictly in measured CapacityReport metrics. */
export const ReportQa = memo(function ReportQa({ report }: { report: CapacityReport }) {
  const { available, busy, error, reply, run } = useHybridPrompt();
  const [question, setQuestion] = useState('');
  const headingId = useId();
  const inputId = useId();

  if (!available) return null;

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    await run(
      buildReportQaPrompt(report, trimmed),
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
        {reply ? <HybridBadge origin={reply.origin} /> : null}
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Ask follow-up questions about these measured stage and route metrics. Prefers on-device Gemini Nano with cloud Gemini fallback.
      </p>

      <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Suggested report questions">
        {QUICK_QUESTIONS.map((q) => (
          <Button
            key={q}
            type="button"
            variant="outline"
            size="sm"
            className="border-bar bg-background text-foreground"
            disabled={busy}
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
          type="text"
          value={question}
          disabled={busy}
          placeholder="Ask about latency, breaking point, or route errors…"
          onChange={(e) => setQuestion(e.target.value)}
          className="min-h-10 min-w-[240px] flex-1 rounded-md border border-bar bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-accent-text focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button type="submit" variant="secondary" disabled={busy || question.trim() === ''}>
          Ask
        </Button>
      </form>

      {busy ? <Busy>Thinking…</Busy> : null}
      <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

      {reply ? (
        <div className="rounded-md border border-bar bg-background p-3.5" aria-live="polite">
          <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{reply.text}</p>
        </div>
      ) : null}
    </TelemetryPanel>
  );
});
