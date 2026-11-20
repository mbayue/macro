/**
 * "Before you ask": the FAQ as overlapping filled cards in two alternating surface tones. Each card is
 * a native `details` sharing one `name`, so the browser keeps one answer open at a time (the first on
 * load) and keyboard and screen-reader support come for free. Each card tucks 12 px under the next.
 */
import { FAQ } from '../data.ts';

export function Faq() {
  return (
    <section className="mx-auto mt-[clamp(96px,12vw,180px)] max-w-[980px] px-3" aria-labelledby="faq-title">
      <h2 id="faq-title" className="mb-8 text-[10vw] split:mb-10 split:text-[clamp(36px,4.2vw,68px)]" data-reveal>
        Before you ask
      </h2>
      <div className="grid">
        {FAQ.map((item, i) => (
          <details
            key={item.q}
            name="faq"
            open={i === 0}
            className="-mt-3 rounded bg-surface first:mt-0 even:bg-surface-2"
            data-reveal
            data-i={String(Math.min(i + 1, 8))}
          >
            <summary className="flex min-h-[84px] cursor-pointer list-none items-center justify-between gap-6 px-5 pt-3 pb-6 text-lg leading-snug font-medium focus-visible:relative focus-visible:z-[1] focus-visible:outline-offset-[-4px] split:px-7 split:text-xl [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden="true"
                className="faq-plus"
              />
            </summary>
            <p className="max-w-[60ch] px-5 pb-10 split:px-7">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
