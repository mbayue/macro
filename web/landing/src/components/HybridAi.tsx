/**
 * Hybrid AI: what Hybrid Inference means for a visitor, in the glossary's terms. Two lanes say which
 * model answers (the On-Device Model in Chrome with Gemini Nano, otherwise the Cloud Fallback), and two
 * product fragments show the helpers that use it, the Scenario Assistant and Report Q&A, with the
 * labels and badges the app really shows (app/components/ScenarioAssistant.tsx, run/ReportQa.tsx,
 * HybridBadge.tsx). No speed or quality claims: the copy states only what app/lib/hybrid-ai.ts does.
 */

/** The Scenario Assistant's preset refinements, as the app shows them. */
const PRESETS = [
  'Add ramp-up and peak spike stages',
  'Target the catalog routes with realistic user mix',
  'Tighten clarity and state exact user count and duration',
] as const;

/** Report Q&A's suggested questions, as the app shows them. */
const QUESTIONS = [
  'Why did this run pass or fail?',
  'Which route was slowest and by how much?',
  'What should I tune before re-running?',
] as const;

const LANES = [
  {
    when: 'Chrome with Gemini Nano',
    term: 'On-Device Model.',
    what: 'The model runs inside your browser, so the answer comes back without a network round trip.',
    fill: 'bg-surface-2 text-ink [&_strong]:text-accent-text',
  },
  {
    when: 'When Gemini Nano is not ready',
    term: 'Cloud Fallback.',
    what: 'Whenever the On-Device Model is not available, the same prompt goes to Gemini in the cloud instead. You do not have to switch anything.',
    fill: 'bg-bg text-ink',
  },
] as const;

function Chips({ items }: { items: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="rounded border border-ui-line px-3 py-2 text-[13px] leading-tight">
          {item}
        </span>
      ))}
    </span>
  );
}

function Fragment({ badge, items, onDevice }: { badge: string; items: readonly string[]; onDevice: boolean }) {
  return (
    <span data-ui className="mt-5 flex flex-col gap-4 rounded bg-ui-bg p-4 text-white split:p-5" aria-hidden="true">
        <span className={`self-start rounded px-2 py-1 text-[13px] leading-none ${onDevice ? 'bg-accent text-accent-ink' : 'bg-ui-line text-white'}`}>
          {badge}
        </span>
      <Chips items={items} />
    </span>
  );
}

export function HybridAi() {
  return (
    <section
      className="mx-3 mt-[clamp(120px,14vw,200px)] grid gap-10 rounded bg-surface px-4 py-10 split:grid-cols-12 split:gap-x-8 split:gap-y-14 split:p-12"
      id="hybrid-ai"
      aria-labelledby="hybrid-title"
    >
      <h2
        id="hybrid-title"
        data-reveal
        className="font-display text-[16vw] leading-none font-light tracking-[-0.04em] split:col-span-5 split:text-[clamp(56px,7vw,120px)]"
      >
        Hybrid AI
      </h2>
      <p className="max-w-[44ch] text-lg split:col-span-6 split:col-start-7 split:self-end" data-reveal data-i="1">
        Two helpers in the app call their AI from your browser, not from Macro&apos;s server, so they never use your planning quota.
        This is Hybrid Inference: your browser picks the model.
      </p>

      <dl className="m-0 grid gap-2 split:col-span-12">
        {LANES.map((lane, i) => (
          <div
            key={lane.term}
            className={`grid gap-2 rounded px-4 py-5 split:grid-cols-12 split:gap-8 split:px-6 split:py-7 ${lane.fill}`}
            data-reveal
            data-i={String(i + 2)}
          >
            <dt className="font-display text-[26px] leading-tight font-light split:col-span-5 split:text-[clamp(26px,2.4vw,36px)]">
              {lane.when}
            </dt>
            <dd className="m-0 text-lg split:col-span-7">
              <strong className="font-medium">{lane.term}</strong> {lane.what}
            </dd>
          </div>
        ))}
      </dl>

      <div className="split:col-span-7" data-reveal data-i="2">
        <h3 className="text-xl font-medium">Scenario Assistant</h3>
        <p className="mt-2 max-w-[48ch]">
          In the Test Studio, before you submit. It rewrites your traffic description into a clearer draft with user counts, a traffic
          shape and what the users do. Nothing changes until you apply it.
        </p>
        <Fragment badge="On-device · Gemini Nano" items={PRESETS} onDevice />
      </div>
      <div className="split:col-span-5 split:mt-12" data-reveal data-i="3">
        <h3 className="text-xl font-medium">Report Q&amp;A</h3>
        <p className="mt-2 max-w-[44ch]">
          On the AI tab of a finished Capacity Report. It answers your questions from that run&apos;s measured Stage and route metrics
          only.
        </p>
        <Fragment badge="Cloud · Gemini" items={QUESTIONS} onDevice={false} />
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-5 split:col-span-12" data-reveal>
        <a className="site-btn" href="/app/">
          Try it in the Test Studio
        </a>
        <p className="text-muted">Answers show where they ran when the browser reports it.</p>
      </div>
    </section>
  );
}
