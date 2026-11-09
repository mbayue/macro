/**
 * Under the New test form, until a plan is drafted: what happens after "Draft a plan".
 * (Recent runs already sit in the side rail.)
 */
const STEPS = [
  { title: 'The planner drafts a plan', text: 'Stages of rising virtual users, the routes they visit, and stop limits for p95 latency and errors.' },
  { title: 'The policy gate checks it', text: 'Fixed code tests the target, routes, users and duration. A plan that breaks a rule cannot be approved.' },
  { title: 'You approve, then watch', text: 'Each stage runs in a fresh sandbox. The report shows the safe capacity and the first route to slow down.' },
] as const;

export function NextUp() {
  return (
    <section className="panel next" aria-labelledby="next-steps-heading">
      <h2 id="next-steps-heading">After you draft</h2>
      <ol className="next__list">
        {STEPS.map((s) => (
          <li key={s.title} className="next__card">
            <span className="next__name">{s.title}</span>
            <span className="muted">{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
