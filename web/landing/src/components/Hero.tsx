/**
 * The home page hero: a card (stage band strip, wordmark, headline, one action, the in-page links
 * and the theme toggle) beside a sticky photograph that crossfades through the Sanok load test.
 * The card is the page's navigation; there is no separate top nav on the home page.
 *
 * The entrance is CSS only (animate-rise), so the first screen never waits for the script. The
 * crossfade starts after hydration, pauses while the tab is hidden, and never runs under reduced
 * motion (the first photograph stays).
 */
import { useEffect, useState } from 'react';
import { sanokSrc, sanokSrcSet, SANOK_PHOTOS, SANOK_SIZE } from '../sanok.ts';
import { ThemeToggle } from './ThemeToggle.tsx';
import { StageBand } from './StageBand.tsx';

/** How long each photograph stays fully shown; the fade itself is 1.6 s (.crossfade in landing.css). */
const HOLD_MS = 5600;
const FADE_MS = 1600;

const LINKS = [
  { href: '#load', label: 'Watch a run' },
  { href: '#containment', label: 'Containment' },
  { href: '#pricing', label: 'Pricing' },
] as const;

function useCrossfade(count: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setShown((n) => (n + 1) % count);
        schedule();
      }, HOLD_MS + FADE_MS);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) schedule();
    };
    if (!document.hidden) schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [count]);
  return shown;
}

export function Hero() {
  const shown = useCrossfade(SANOK_PHOTOS.length);
  return (
    <section className="grid gap-3 p-3 split:min-h-svh split:grid-cols-2" aria-labelledby="hero-title">
      <div className="relative z-[1] -mt-6 flex flex-col rounded bg-surface p-3.5 split:mt-0 split:min-h-[calc(100svh-24px)] split:p-5">
        <StageBand size="strip" />
        <div className="flex flex-1 flex-col items-center justify-center px-1 py-8 text-center split:px-3 split:py-12">
          <p className="font-display text-[clamp(40px,4vw,64px)] leading-none font-light tracking-[-0.04em]">Macro</p>
          <h1
            id="hero-title"
            className="mt-10 max-w-[12ch] animate-rise text-[13vw] leading-none tracking-[-0.03em] motion-reduce:animate-fade split:text-[clamp(44px,5.2vw,88px)]"
          >
            Find your breaking point
          </h1>
          <p className="mt-6 max-w-[36ch] animate-rise text-lg [animation-delay:75ms] motion-reduce:animate-fade">
            Macro plans a load test from plain words, checks it against fixed rules, and runs it in a sandbox that can only reach your
            verified site.
          </p>
          <a className="site-btn mt-9 animate-rise [animation-delay:150ms] motion-reduce:animate-fade" href="/app/">
            Try the live demo
          </a>
        </div>
        <nav
          className="flex animate-rise flex-wrap items-center justify-center gap-x-5 text-[15px] [animation-delay:225ms] motion-reduce:animate-fade split:gap-x-7"
          aria-label="On this page"
        >
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="press inline-flex min-h-11 items-center no-underline pointer-fine:hover:underline">
              {l.label}
            </a>
          ))}
          <ThemeToggle />
        </nav>
      </div>
      <figure className="relative order-first m-0 h-[48svh] overflow-hidden rounded bg-ui-field split:sticky split:top-3 split:order-none split:h-[calc(100svh-24px)]">
        {SANOK_PHOTOS.map((p, i) => (
          <img
            key={p.name}
            src={sanokSrc(p.name)}
            srcSet={sanokSrcSet(p.name)}
            sizes="(min-width: 53.75rem) 50vw, 100vw"
            width={SANOK_SIZE.width}
            height={SANOK_SIZE.height}
            alt={i === shown ? p.alt : ''}
            aria-hidden={i === shown ? undefined : true}
            fetchPriority={i === 0 ? 'high' : undefined}
            loading={i === 0 ? undefined : 'lazy'}
            decoding="async"
            className={`crossfade absolute inset-0 h-full w-full object-cover ${i === shown ? 'is-shown' : ''}`}
          />
        ))}
        <figcaption className="absolute bottom-3 left-3 hidden max-w-[40ch] rounded bg-ui-bg px-3.5 py-2.5 text-[15px] text-white split:block">
          The new bridge in Sanok, load-tested with parked trucks before it opened.
        </figcaption>
      </figure>
    </section>
  );
}
