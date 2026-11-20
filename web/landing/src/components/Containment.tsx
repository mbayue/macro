/**
 * "Five escapes, five blocked": the Containment Probe result as filled tiles. An accent heading tile two
 * columns wide, one tile per escape attempt, and one tile with the probe result screenshot from /app/.
 * Four columns with 8 px gaps on desktop, two on phones.
 *
 * The screenshot exists in a light and a dark capture. Both are lazy and the one for the other theme is
 * display:none, so the browser only downloads the visible one (lazy images that are not rendered are
 * never fetched).
 *
 * Entrance: the existing scroll reveal (data-reveal, staggered by data-i; reveal.ts).
 */
const ESCAPES = [
  { name: 'example.com', note: 'HTTPS to a site outside the allowlist' },
  { name: '169.254.169.254', note: 'The cloud metadata address' },
  { name: 'macro-api:3000', note: "Macro's own API, from inside" },
  { name: 'KEY, SECRET, TOKEN', note: 'Secret names in the environment' },
  { name: 'Over 1 GiB', note: 'Memory past the sandbox cap' },
] as const;

const SHOT_ALT = "Macro's probe result: 5 of 5 actions contained, probe passed.";
const SHOT_IMG = 'h-full w-full object-cover object-left-top';

export function Containment() {
  return (
    <section
      id="containment"
      className="section mx-3 grid grid-cols-2 gap-1.5 split:grid-cols-4 split:gap-2"
      aria-labelledby="proof-title"
    >
      <div
        className="col-span-2 flex flex-col justify-between gap-8 rounded bg-accent p-5 text-accent-ink split:min-h-[280px] split:p-7"
        data-reveal
      >
        <h2 id="proof-title" className="section-title max-w-[10ch]">
          Five escapes, five blocked
        </h2>
        <p className="max-w-[44ch] text-lg">
          The Containment Probe runs a hostile script inside a real sandbox whenever you ask. This is the live result from the demo.
        </p>
      </div>
      <div
        className="col-span-2 h-[280px] overflow-hidden rounded bg-ui-bg split:order-last split:col-span-1 split:h-auto split:min-h-[280px]"
        data-reveal
        data-i="1"
      >
        <img
          src="/landing/img/ui-probe-dark.png"
          width={816}
          height={624}
          loading="lazy"
          decoding="async"
          alt={SHOT_ALT}
          className={`hidden dark:block ${SHOT_IMG}`}
        />
        <img
          src="/landing/img/ui-probe-light.png"
          width={816}
          height={624}
          loading="lazy"
          decoding="async"
          alt={SHOT_ALT}
          className={`dark:hidden ${SHOT_IMG}`}
        />
      </div>
      {ESCAPES.map((e, i) => (
        <div
          key={e.name}
          className="flex min-h-[180px] flex-col gap-2.5 rounded bg-surface p-4 last-of-type:col-span-2 split:min-h-[280px] split:p-7 split:last-of-type:col-span-1"
          data-reveal
          data-i={String(i + 2)}
        >
          <span className="text-lg leading-[1.15] font-medium [overflow-wrap:anywhere] split:text-[clamp(22px,1.9vw,30px)]">{e.name}</span>
          <span className="text-base text-muted">{e.note}</span>
          <span className="mt-auto font-medium text-accent-text">Contained</span>
        </div>
      ))}
    </section>
  );
}
