import { useEffect, useRef, useState } from 'react';
import { BAR_ACCENT, BAR_LABELLED, BAR_MAX, BAR_PHONE_ORDER, BARS } from '../data.ts';

const fmt = (n: number): string => n.toLocaleString('en-US');
const DEFAULT_NOTE =
  'store_home at 200 virtual users, p95 latency. The limit was 1,500 ms. The run as a whole stayed under it, so the report names store_home as the first route to slow down, not as the breaking point. Three routes over four stages, from a real run on the demo shop.';
const ALL = BARS.map((_, i) => i);

function label(i: number): string {
  const b = BARS[i];
  return b ? `${b.route}, stage ${b.stage} at ${b.vus} users: p95 ${fmt(b.p95)} ms` : '';
}

/** The product's own chart: p95 per route and stage, standing on the section's bottom edge. */
export function LatencyBars() {
  const [order, setOrder] = useState<readonly number[]>(ALL);
  const [note, setNote] = useState(DEFAULT_NOTE);
  const bars = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 48rem)');
    const apply = () => setOrder(mq.matches ? BAR_PHONE_ORDER : ALL);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Heights and stagger go through the CSSOM; the CSP forbids style attributes in the HTML.
  useEffect(() => {
    const nodes = bars.current?.querySelectorAll<HTMLElement>('[data-bar]') ?? [];
    nodes.forEach((el, pos) => {
      const b = BARS[Number(el.dataset['bar'])];
      if (!b) return;
      el.style.setProperty('--v', String(b.p95 / BAR_MAX));
      el.style.setProperty('--i', String(pos));
    });
  }, [order]);

  return (
    <section className="stats" aria-labelledby="stats-title">
      <div className="wrap stats__copy">
        <p className="stats__figure" data-reveal>
          1,611 ms
        </p>
        <h2 className="stats__claim" id="stats-title" data-reveal data-i="1">
          The first route past the limit
        </h2>
        <p className="stats__note" aria-live="polite" data-reveal data-i="2">
          {note}
        </p>
      </div>
      <div className="bars" id="bars" ref={bars} data-ui aria-label="p95 latency per route and stage">
        {order.map((i) => (
          <button
            key={i}
            type="button"
            data-bar={i}
            className={i === BAR_ACCENT ? 'bar bar--accent' : 'bar'}
            aria-label={label(i)}
            onMouseEnter={() => setNote(label(i))}
            onFocus={() => setNote(label(i))}
            onMouseLeave={() => setNote(DEFAULT_NOTE)}
            onBlur={() => setNote(DEFAULT_NOTE)}
          >
            {BAR_LABELLED.includes(i) ? <span className="bar__val">{fmt(BARS[i]?.p95 ?? 0)}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
