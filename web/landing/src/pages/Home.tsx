import { useEffect } from 'react';
import { ApproveSwitch } from '../components/ApproveSwitch.tsx';
import { Footer, Nav } from '../components/Chrome.tsx';
import { HowItWorks } from '../components/HowItWorks.tsx';
import { LatencyBars } from '../components/LatencyBars.tsx';
import { PolicyGate } from '../components/PolicyGate.tsx';
import { FreeAccess } from '../components/FreeAccess.tsx';
import { Waitlist } from '../components/Waitlist.tsx';
import { FAQ } from '../data.ts';

const TILES: readonly { name: string; note: string; result: string }[] = [
  { name: 'example.com', note: 'HTTPS to a site outside the allowlist', result: 'Contained' },
  { name: '169.254.169.254', note: 'The cloud metadata address', result: 'Contained' },
  { name: 'macro-api:3000', note: "Macro's own API, from inside", result: 'Contained' },
  { name: 'KEY, SECRET, TOKEN', note: 'Secret names in the environment', result: 'Contained' },
  { name: 'Over 1 GiB', note: 'Memory past the sandbox cap', result: 'Contained' },
  { name: 'gVisor runsc', note: 'Every stage gets a fresh sandbox, removed after', result: 'Confirmed gone' },
];

/**
 * Scroll reveals and the bridge photo drift. The hero is not part of this: it has a CSS-only entrance
 * (.hero__rise, .stage in styles.css) so the first screen never waits for this script.
 * Below the fold, .js [data-reveal] hides content until this runs; landing-early.js removes the
 * js class after 3 s unless this hook has marked the page with motion-ready, so content can never
 * stay hidden if the bundle fails to load.
 */
function useMotion(): void {
  useEffect(() => {
    document.documentElement.classList.add('motion-ready');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = document.getElementById('bridge-frame');
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal], #bridge-figure, #bars');
    if (reduce || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      frame?.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          // The shutter frame starts fully clipped, so the observer watches its figure.
          if (en.target.id === 'bridge-figure') frame?.classList.add('in');
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((el) => io.observe(el));

    let ticking = false;
    const onScroll = () => {
      if (ticking || !frame) return;
      ticking = true;
      requestAnimationFrame(() => {
        const r = frame.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, 1 - r.bottom / (window.innerHeight + r.height)));
        frame.style.setProperty('--drift', (1 + p * 0.06).toFixed(4));
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
}

export function Home() {
  useMotion();
  return (
    <>
      <Nav home />
      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero__copy">
            <h1 id="hero-title" className="hero__rise" data-i="0">
              Find your breaking point
            </h1>
            <p className="hero__lead hero__rise" data-i="1">
              Macro plans a load test from plain words, checks it against fixed rules, and runs it in a sandbox that can only reach
              your verified site.
            </p>
            <div className="hero__rise" data-i="2">
              <a className="btn" href="/app/">
                Try the live demo
              </a>
            </div>
          </div>
          <div className="stage" id="stage">
            <PolicyGate />
          </div>
        </section>

        <section className="bridge" id="bridge" aria-label="Why staged load tests">
          <figure id="bridge-figure">
            <div className="bridge__frame" id="bridge-frame">
              <img
                src="/landing/img/bridge-load-test-sanok.jpg"
                width={1920}
                height={1280}
                alt="Two heavy trucks parked on a new cable-stayed bridge in Sanok, Poland, while engineers in hard hats measure it during a load test."
              />
            </div>
            <figcaption>
              Test trucks on the new bridge in Sanok before it opened. Photo:{' '}
              <a href="https://commons.wikimedia.org/w/index.php?curid=192922764">Marsilar</a>, CC BY-SA 4.0, via Wikimedia Commons.
            </figcaption>
          </figure>
          <div className="bridge__text">
            <p data-reveal>
              Before a bridge opens, engineers park loaded trucks on it and measure. Macro does that to your site, one stage at a time.
            </p>
          </div>
        </section>

        <ApproveSwitch />
        <HowItWorks />

        <section className="proof" id="containment" aria-labelledby="proof-title">
          <div className="wrap">
            <div className="board">
              <div className="tile tile--head" data-reveal>
                <h2 id="proof-title">Five escapes, five blocked</h2>
                <p>
                  The containment probe runs a hostile script inside a real sandbox whenever you ask it to. This is the live result from
                  the demo.
                </p>
              </div>
              <div className="tile tile--shot" data-reveal data-i="1">
                <img
                  src="/landing/img/ui-probe.png"
                  width={1016}
                  height={548}
                  loading="lazy"
                  alt="Macro's probe result: 5 of 5 actions contained, with a table of the five attempts each marked contained."
                />
              </div>
              {TILES.map((t, i) => (
                <div className="tile" data-reveal data-i={String(i + 2)} key={t.name}>
                  <span className="tile__name">{t.name}</span>
                  <span className="tile__note">
                    {t.note}
                    <b>{t.result}</b>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <LatencyBars />
        <FreeAccess />

        <section className="faq wrap" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you ask</h2>
          <div className="faq__list">
            {FAQ.map((item) => (
              <details name="faq" key={item.q}>
                <summary>
                  {item.q}
                  <span className="plus" aria-hidden="true" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
