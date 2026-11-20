/**
 * The close of the home page: one row of three tiles (a Sanok photograph, the wide accent tile with
 * the last action, and a flat surface tile), the outer two running off the page edges, then the
 * waitlist tile under the accent tile. On phones the accent tile is full width with the two side
 * tiles beneath it as a pair.
 */
import { sanokSrc, sanokSrcSet, SANOK_SIZE } from '../sanok.ts';

export function Close() {
  return (
    <section
      className="mx-3 mt-[clamp(120px,14vw,200px)] grid grid-cols-2 gap-2 split:mx-0 split:grid-cols-[2fr_8fr_2fr]"
      aria-labelledby="close-title"
    >
      <img
        className="h-[120px] w-full rounded object-cover split:h-[380px] split:rounded-l-[0]"
        src={sanokSrc('span', 800)}
        srcSet={sanokSrcSet('span')}
        sizes="(min-width: 53.75rem) 17vw, 50vw"
        width={SANOK_SIZE.width}
        height={SANOK_SIZE.height}
        loading="lazy"
        decoding="async"
        alt=""
      />
      <div
        className="col-span-2 row-start-1 flex flex-col items-start justify-center gap-5 rounded bg-accent p-7 text-accent-ink split:col-span-1 split:col-start-2 split:h-[380px] split:p-10"
        data-reveal
      >
        <h2 id="close-title" className="text-[clamp(36px,3.4vw,56px)] leading-none tracking-[-0.03em]">
          Load your own deck
        </h2>
        <p className="max-w-[44ch] text-lg">Verify your site with a DNS TXT record and run the same four stages against it, privately.</p>
        <a className="site-btn site-btn--ink focus-visible:outline-accent-ink" href="/app/">
          Try the live demo
        </a>
      </div>
      <div className="h-[120px] rounded bg-surface-2 split:h-[380px] split:rounded-r-[0]" aria-hidden="true" />
    </section>
  );
}
