/**
 * "Load the deck", the page's one live thing. The slider's track is the stage band: drag it, use the
 * arrow keys or pick a Stage label, and the run fragment shows the measured p95 per route at that
 * Stage from run d28cacd6 (BARS in data.ts), slowest route in the accent.
 *
 * The range runs 0 to 15 so each Stage stop (1, 3, 7, 15) lands on the end of its band segment,
 * whose widths are 1 : 2 : 4 : 8. The band is inset by half a thumb on each side so the thumb's
 * centre meets each segment end. Dragging snaps to the nearest stop; the keys move one Stage at a time
 * (a plain arrow step of 1 would snap straight back to the same stop).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BARS } from '../data.ts';
import { StageBand } from './StageBand.tsx';

const STAGES = [
  {
    users: 25,
    clause: '25 users on the deck',
    line: 'Stage 1 runs in a fresh gVisor sandbox. The Supervisor reads the numbers before anything heavier starts.',
  },
  { users: 50, clause: '50 users on the deck', line: 'Stage 2 doubles the load in a new sandbox. The last one is already gone.' },
  {
    users: 100,
    clause: '100 users on the deck',
    line: 'Stage 3. store_home is now the first route to slow down, and the report will say so.',
  },
  {
    users: 200,
    clause: '200 users, still standing',
    line: 'Stage 4. Safe Capacity is 200 users and the Breaking Point was not reached on this run.',
  },
] as const;
const LAST = STAGES.length - 1;
const ROUTES = ['store_home', 'catalog_list', 'product_detail'] as const;
/** Bars are drawn against the run's highest p95 (store_home at 200 users). */
const BAR_MAX = Math.max(...BARS.map((b) => b.p95));
/** Slider value at the end of each Stage's band segment (cumulative 1, 2, 4, 8). */
const STOP = [1, 3, 7, 15] as const;
const RANGE_MAX = STOP[LAST];

/** The Stage whose stop is nearest `value`; on a tie, the lower Stage. */
function nearestStage(value: number): number {
  const distance = STOP.map((end) => Math.abs(end - value));
  return distance.indexOf(Math.min(...distance));
}

const KEY_STEP: Partial<Record<string, (s: number) => number>> = {
  ArrowRight: (s) => s + 1,
  ArrowUp: (s) => s + 1,
  PageUp: (s) => s + 1,
  ArrowLeft: (s) => s - 1,
  ArrowDown: (s) => s - 1,
  PageDown: (s) => s - 1,
  Home: () => 0,
  End: () => LAST,
};

function rowsAt(stage: number) {
  return ROUTES.map((route) => {
    const bar = BARS.find((b) => b.route === route && b.stage === stage + 1);
    if (!bar) throw new Error(`run d28cacd6 has no p95 for ${route} at stage ${stage + 1}`);
    return bar;
  });
}

function RunFragment({ stage }: { stage: number }) {
  const rows = rowsAt(stage);
  const worst = Math.max(...rows.map((r) => r.p95));
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // Bar lengths go through the CSSOM, never a style attribute (the CSP is style-src 'self').
  useEffect(() => {
    rows.forEach((r, i) => bars.current[i]?.style.setProperty('--v', String(r.p95 / BAR_MAX)));
  });
  return (
    <div className="w-full max-w-[460px] rounded bg-ui-bg p-[22px] text-[15px] text-white" data-ui>
      <p className="mb-4 flex justify-between gap-3 font-medium">
        Demo shop, run d28cacd6
        <span className="font-normal text-muted tabular-nums">
          Stage {stage + 1} of {STAGES.length}
        </span>
      </p>
      <StageBand upTo={stage} tone="ui" />
      <table className="mt-[18px] w-full border-collapse">
        <caption className="sr-only">p95 latency per route at {STAGES[stage]?.users} users</caption>
        <thead>
          <tr>
            <th scope="col" className="py-2.5 text-left text-[13px] font-normal text-muted">
              Route
            </th>
            <th scope="col" className="py-2.5 text-left text-[13px] font-normal text-muted">
              p95
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const slowest = r.p95 === worst;
            return (
              <tr key={r.route} className="border-t border-ui-line" /* taste-skill-ignore: rows of a real table in a data-ui fragment */>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal whitespace-nowrap">
                  {r.route}
                </th>
                <td className="w-full py-2.5">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-2 split:flex-nowrap">
                    <span
                      ref={(el) => {
                        bars.current[i] = el;
                      }}
                      className={`order-last h-2 basis-full origin-left split:order-none split:flex-1 split:basis-auto scale-x-[var(--v,0)] transition-[scale] duration-[400ms] ease-(--ease) motion-reduce:transition-none ${slowest ? 'bg-accent' : 'bg-bar'}`}
                    />
                    <b className="font-medium tabular-nums split:min-w-[72px] split:text-right">{r.p95.toLocaleString('en')} ms</b>
                    <span className={`text-[13px] split:w-14 ${slowest ? 'text-accent' : ''}`}>{slowest ? 'Slowest' : ''}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LoadTheDeck() {
  const [stage, setStage] = useState(0);
  const current = STAGES[stage] ?? STAGES[0];
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = KEY_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    setStage(Math.min(LAST, Math.max(0, step(stage))));
  };
  return (
    <section
      id="load"
      aria-labelledby="load-title"
      className="mx-3 mt-[clamp(120px,14vw,200px)] grid overflow-hidden rounded bg-surface split:min-h-[88svh] split:grid-cols-2 split:grid-rows-[1fr_auto]"
    >
      <div className="order-2 flex flex-col gap-6 px-4 pt-8 pb-10 split:order-none split:col-start-1 split:row-start-1 split:px-10 split:py-12" data-reveal>
        <h2
          id="load-title"
          aria-live="polite"
          className="max-w-[11ch] text-[11vw] leading-none tracking-[-0.03em] split:text-[clamp(36px,4.2vw,68px)]"
        >
          {current.clause}
        </h2>
        <p className="max-w-[38ch] text-lg">{current.line}</p>
      </div>
      <div className="order-first grid place-items-center bg-surface-2 px-3 py-6 split:order-none split:col-start-2 split:row-start-1 split:px-6 split:py-12" data-reveal data-i="1">
        <RunFragment stage={stage} />
      </div>
      <div className="order-1 px-4 pt-[22px] pb-6 split:order-none split:col-span-2 split:row-start-2 split:px-10 split:pt-7 split:pb-8" data-reveal data-i="2">
        <div className="relative">
          <label htmlFor="deck-range" className="sr-only">
            Users on the deck
          </label>
          <input
            id="deck-range"
            type="range"
            min={0}
            max={RANGE_MAX}
            step={1}
            value={STOP[stage]}
            aria-valuetext={`${current.users} users, Stage ${stage + 1} of ${STAGES.length}`}
            onChange={(e) => setStage(nearestStage(Number(e.target.value)))}
            onKeyDown={onKeyDown}
            className="deck-range relative z-[1] m-0 block h-10 w-full split:h-8"
          />
          <StageBand upTo={stage} className="pointer-events-none absolute inset-x-5 top-[13px] w-auto! split:inset-x-4 split:top-[9px]" />
        </div>
        <ol className="m-0 mt-3.5 flex list-none gap-1 p-0 px-5 split:px-4">
          {STAGES.map((s, i) => (
            <li key={s.users} className={`flex min-w-0 justify-end ${['flex-[1_1_0]', 'flex-[2_1_0]', 'flex-[4_1_0]', 'flex-[8_1_0]'][i]}`}>
              <button
                type="button"
                aria-pressed={i === stage}
                onClick={() => setStage(i)}
                className={`-mr-2 min-h-11 cursor-pointer rounded bg-transparent px-2 text-[15px] whitespace-nowrap press split:text-base pointer-fine:hover:text-ink ${i === stage ? 'font-medium text-ink' : 'text-muted'}`}
              >
                {i === LAST ? `${s.users} users` : s.users}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
