import { runHref } from '../router.ts';

/** Placeholder screen for Run Compare (`#/compare/:a/:b`), implemented in Ticket #9. */
export function ComparePage({ a, b }: { a: string; b: string }) {
  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">Run Compare</h1>
        <p className="page__lead">
          Side-by-side comparison for runs <span className="code">{a}</span> and <span className="code">{b}</span> is not available yet.
        </p>
      </header>
      <div className="row">
        <a className="btn btn--quiet" href={runHref(a)}>
          Open run {a}
        </a>
        <a className="btn btn--quiet" href={runHref(b)}>
          Open run {b}
        </a>
        <a className="btn btn--quiet" href="#/runs">
          Recent runs
        </a>
      </div>
    </section>
  );
}
