/**
 * Pricing while Macro is in early access: two $0 plan tiles of stepped height (Self-host lower,
 * Hosted early access taller, its action strip in the accent), each ending in a full-width action strip.
 * The paid plans stay in data.ts and components/Pricing.tsx; render <Pricing /> instead of this to
 * show them when paid tiers launch.
 */
import { StageBand } from './StageBand.tsx';

const PLANS = [
  {
    name: 'Self-host',
    facts: ['MIT License, all of the code', 'The same Policy Gate and sandbox', 'You pay only your server and inference, about 2 cents a run on Vultr'],
    action: { label: 'View on GitHub', href: 'https://github.com/mbayue/macro' },
    high: false,
  },
  {
    name: 'Hosted early access',
    facts: [
      'Sign in to test your own verified site',
      'Or try the demo shop signed out',
      'Up to 500 virtual users per Stage',
      'Containment Probe and a FIFO run queue',
    ],
    action: { label: 'Try the live demo', href: '/app/' },
    high: true,
  },
] as const;

const TILE = {
  low: 'bg-surface split:col-start-1 split:row-start-2 split:min-h-[420px]',
  high: 'bg-surface-2 text-ink split:col-start-2 split:row-span-2 split:row-start-1 split:min-h-[600px]',
} as const;

const STRIP = {
  low: 'rounded-b bg-surface-2 pointer-fine:hover:bg-bar pointer-fine:hover:text-white',
  high: 'rounded-b bg-accent text-accent-ink focus-visible:outline-accent-ink pointer-fine:hover:bg-accent-hover',
} as const;

export function FreePlans() {
  return (
    <section
      className="mx-3 mt-[clamp(96px,12vw,180px)] grid scroll-mt-3 gap-2 split:grid-cols-2 split:items-end"
      id="pricing"
      aria-labelledby="pricing-title"
    >
      <h2
        id="pricing-title"
        className="section-title max-w-[10ch] pb-5 split:col-start-1 split:row-start-1 split:self-start split:px-7 split:pb-8"
        data-reveal
      >
        Free while in early access
      </h2>
      {PLANS.map((p, i) => (
        <article
          key={p.name}
          aria-labelledby={`plan-${i}`}
          className={`relative flex flex-col rounded px-6 pt-6 pb-24 split:px-7 split:pt-7 ${p.high ? TILE.high : TILE.low}`}
          data-reveal
          data-i={String(i + 1)}
        >
          <h3 id={`plan-${i}`} className="font-text text-2xl font-medium tracking-normal">
            {p.name}
          </h3>
          <p className="mt-2 mb-7 font-display text-[44px] leading-none font-light tracking-[-0.03em] split:text-[64px]">$0</p>
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {p.facts.map((f) => (
              <li key={f} className="flex items-baseline gap-3">
                <StageBand size="bullet" tone="page" className="shrink-0 translate-y-[-0.1em]" />
                {f}
              </li>
            ))}
          </ul>
          <a
            href={p.action.href}
            className={`absolute inset-x-0 bottom-0 flex h-16 items-center px-6 font-medium no-underline press focus-visible:outline-offset-[-6px] split:px-7 ${p.high ? STRIP.high : STRIP.low}`}
          >
            {p.action.label}
          </a>
        </article>
      ))}
    </section>
  );
}
