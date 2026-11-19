import { useId, useState } from 'react';
import type { CapacityReport } from '../../../../../../src/report/build.ts';
import { useHybridPrompt } from '../../hooks/useHybridPrompt.ts';
import { buildReportQaPrompt } from '../../lib/hybrid-ai.ts';
import { HybridBadge } from '../HybridBadge.tsx';
import { AlertRegion, Badge, Busy } from '../ui.tsx';

const QUICK_QUESTIONS = [
  'Why did this run pass or fail?',
  'Which route was slowest and by how much?',
  'What should I tune before re-running?',
] as const;

/** AI-labelled Report Q&A panel grounded strictly in measured CapacityReport metrics. */
export function ReportQa({ report }: { report: CapacityReport }) {
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
    <section className="panel ai report-qa" aria-labelledby={headingId}>
      <div className="panel__head">
        <h2 id={headingId}>
          Report Q&amp;A <Badge>AI</Badge>
        </h2>
        {reply ? <HybridBadge origin={reply.origin} /> : null}
      </div>
      <p className="muted">
        Ask follow-up questions about these measured stage and route metrics. Prefers on-device Gemini Nano with cloud Gemini fallback.
      </p>

      <div className="examples" role="group" aria-label="Suggested report questions">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="chip-btn"
            disabled={busy}
            onClick={() => void ask(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="field hybrid-assist__row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Ask a question about this capacity report
        </label>
        <input
          id={inputId}
          type="text"
          value={question}
          disabled={busy}
          placeholder="Ask about latency, breaking point, or route errors…"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn btn--quiet" disabled={busy || question.trim() === ''}>
          Ask
        </button>
      </form>

      {busy ? <Busy>Thinking…</Busy> : null}
      <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

      {reply ? (
        <div className="report-qa__answer stack-tight" aria-live="polite">
          <p className="prose">{reply.text}</p>
        </div>
      ) : null}
    </section>
  );
}
