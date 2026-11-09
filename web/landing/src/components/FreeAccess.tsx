/**
 * Shown where the pricing table was, while Macro is in early access and free. The paid plans
 * are kept in data.ts and components/Pricing.tsx; swap this back for <Pricing /> to show them.
 */
const OPTIONS = [
  {
    name: 'Live demo',
    lead: 'Plan, check and run load tests against our demo shop in the browser.',
    facts: ['No account, no card', 'Up to 500 virtual users per stage', 'Containment probe included'],
    action: { label: 'Try the live demo', href: '/app/' },
    accent: true,
  },
  {
    name: 'Self-host',
    lead: 'Run your own copy on your own server, with your own Vultr key.',
    facts: ['MIT License, all of the code', 'The same policy gate and sandbox', 'You pay only your own server and inference'],
    action: { label: 'View on GitHub', href: 'https://github.com/mbayue/macro' },
    accent: false,
  },
] as const;

export function FreeAccess() {
  return (
    <section className="free wrap" id="pricing" aria-labelledby="free-title">
      <div className="free__head">
        <h2 id="free-title" data-reveal>
          Free while Macro is in early access
        </h2>
        <p data-reveal data-i="1">
          There are no paid plans yet. If hosted plans for testing your own sites come later, people on the waitlist hear first.
        </p>
      </div>
      <div className="free__grid">
        {OPTIONS.map((o, i) => (
          <div key={o.name} className={o.accent ? 'free__card free__card--accent' : 'free__card'} data-reveal data-i={String(i + 2)}>
            <div>
              <span className="free__name">{o.name}</span>
              <span className="free__price">$0</span>
              <p className="free__lead">{o.lead}</p>
            </div>
            <ul>
              {o.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <a className={o.accent ? 'btn btn--ink' : 'btn'} href={o.action.href}>
              {o.action.label}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
