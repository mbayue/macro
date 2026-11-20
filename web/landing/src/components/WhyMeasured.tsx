/**
 * "Measured, then opened": a Sanok photograph beside the bridge analogy and who decides what in a run.
 * The photograph is the analogy (credited in the footer), never Macro's product. List bullets are the
 * miniature stage band.
 */
import { sanokSrc, sanokSrcSet, SANOK_PHOTOS, SANOK_SIZE } from '../sanok.ts';
import { StageBand } from './StageBand.tsx';

const PHOTO = SANOK_PHOTOS.find((p) => p.name === 'static')!;

const POINTS = [
  'The AI drafts the plan and writes the explanation.',
  'Fixed code decides the target, the limits, the script and the stop rule.',
  'Every number in the AI text is checked against the measurements, or the text is withheld.',
] as const;

export function WhyMeasured() {
  return (
    <section
      className="mx-3 mt-[clamp(120px,14vw,200px)] grid items-center gap-7 split:grid-cols-[7fr_5fr] split:gap-12"
      aria-labelledby="why-title"
    >
      <img
        src={sanokSrc(PHOTO.name)}
        srcSet={sanokSrcSet(PHOTO.name)}
        sizes="(min-width: 53.75rem) 58vw, 100vw"
        width={SANOK_SIZE.width}
        height={SANOK_SIZE.height}
        loading="lazy"
        decoding="async"
        alt={PHOTO.alt}
        className="aspect-[4/3] w-full rounded bg-ui-field object-cover"
      />
      <div className="split:pr-6">
        <h2
          id="why-title"
          className="font-display text-[10vw] leading-none font-light tracking-[-0.03em] split:text-[clamp(36px,4.2vw,68px)]"
        >
          Measured, then opened
        </h2>
        <p className="mt-6 mb-7 max-w-[42ch] text-lg">
          Before a bridge opens, engineers park loaded trucks on it and read their instruments. Macro does that to your site: one stage,
          one fresh sandbox, then the numbers decide whether the next stage starts.
        </p>
        <ul className="m-0 grid list-none gap-2.5 p-0 text-lg">
          {POINTS.map((point) => (
            <li key={point} className="flex items-baseline gap-3">
              <StageBand size="bullet" className="shrink-0 translate-y-[-0.15em]" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
