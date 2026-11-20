/**
 * The paid plans (Free, Pro, Team from data.ts), kept for when paid tiers launch. Not rendered while
 * Macro is free in early access: the page shows components/FreePlans.tsx instead. Swap <FreePlans />
 * for <Pricing /> in pages/Home.tsx to show these; both carry the `pricing` anchor the hero links to.
 *
 * Same system as FreePlans: filled plan tiles (the recommended one taller, in the accent), each
 * listing its limits and ending in a full-width action strip.
 */
import { PLAN_ROWS, PLANS } from '../data.ts';

const NOTE = 'Launch pricing for the hosted product. Hosted plans open when domain verification ships.';

const TILE = {
  plain: 'bg-surface split:min-h-[520px]',
  rec: 'bg-accent text-accent-ink split:min-h-[600px]',
} as const;

const STRIP = {
  plain: 'rounded-b bg-surface-2 pointer-fine:hover:bg-bar pointer-fine:hover:text-white',
  rec: 'rounded-b bg-[#00684a] text-white focus-visible:outline-white pointer-fine:hover:bg-[var(--accent-ink-soft)]',
} as const;

export function Pricing() {
  return (
    <section className="mx-3 mt-[clamp(96px,12vw,180px)] scroll-mt-3" id="pricing" aria-labelledby="pricing-title">
      <div className="mb-8 split:mb-10 split:px-7">
        <h2 id="pricing-title" className="text-[10vw] split:text-[clamp(36px,4.2vw,68px)]" data-reveal>
          Priced by site
        </h2>
        <p className="mt-4 max-w-[52ch] text-muted" data-reveal data-i="1">
          {NOTE}
        </p>
      </div>
      <div className="grid gap-2 split:grid-cols-3 split:items-end">
        {PLANS.map((p, i) => (
          <article
            key={p.name}
            aria-labelledby={`paid-plan-${i}`}
            className={`relative flex flex-col rounded px-6 pt-6 pb-24 split:px-7 split:pt-7 ${p.recommended ? TILE.rec : TILE.plain}`}
            data-reveal
            data-i={String(i + 2)}
          >
            <h3 id={`paid-plan-${i}`} className="font-text text-2xl font-medium tracking-normal">
              {p.name}
            </h3>
            <p className="mt-2 mb-7">
              <span className="font-display text-[44px] leading-none font-light tracking-[-0.03em] split:text-[64px]">{p.price}</span>{' '}
              <span className="text-[15px]">{p.period}</span>
            </p>
            <dl className="m-0 grid gap-3">
              {PLAN_ROWS.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-4">
                  <dt className={p.recommended ? '' : 'text-muted'}>{row.label}</dt>
                  <dd className="m-0 text-right font-medium">{p[row.key]}</dd>
                </div>
              ))}
            </dl>
            <a
              href={p.action.href}
              className={`absolute inset-x-0 bottom-0 flex h-16 items-center px-6 font-medium no-underline transition-colors duration-150 focus-visible:outline-offset-[-6px] split:px-7 ${p.recommended ? STRIP.rec : STRIP.plain}`}
            >
              {p.action.label}
            </a>
          </article>
        ))}
      </div>
      <p className="mt-6 max-w-[72ch] text-[15px] text-muted split:px-7">
        Why so low: one run costs us about 2 cents on Vultr, a few thousand tokens on Serverless Inference and five minutes of a
        $10-a-month VM. The paid plans pay for larger load generators and longer history.
      </p>
    </section>
  );
}
