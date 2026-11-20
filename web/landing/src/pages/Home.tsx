import { useEffect } from 'react';
import { Containment } from '../components/Containment.tsx';
import { Gate } from '../components/Gate.tsx';
import { Hero } from '../components/Hero.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { HowItWorks } from '../components/HowItWorks.tsx';
import { LatencyBars } from '../components/LatencyBars.tsx';
import { FreeAccess } from '../components/FreeAccess.tsx';
import { Waitlist } from '../components/Waitlist.tsx';
import { FAQ } from '../data.ts';

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

    // Bridge drift: set on the image itself (not its parent), one direction (1.06 -> 1.0 while the
    // photo crosses the viewport, continuing the zoom-out of its reveal), and the scroll listener
    // runs only while the photo is on screen.
    const img = frame?.querySelector('img');
    const figure = document.getElementById('bridge-figure');
    let ticking = false;
    const onScroll = () => {
      if (ticking || !frame || !img) return;
      ticking = true;
      requestAnimationFrame(() => {
        const r = frame.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, 1 - r.bottom / (window.innerHeight + r.height)));
        img.style.setProperty('--drift', (1.06 - p * 0.06).toFixed(4));
        ticking = false;
      });
    };
    let listening = false;
    const near = new IntersectionObserver(([en]) => {
      if (en?.isIntersecting && !listening) {
        window.addEventListener('scroll', onScroll, { passive: true });
        listening = true;
        onScroll();
      } else if (!en?.isIntersecting && listening) {
        window.removeEventListener('scroll', onScroll);
        listening = false;
      }
    });
    if (figure) near.observe(figure);
    return () => {
      io.disconnect();
      near.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
}

export function Home() {
  useMotion();
  return (
    <>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <main id="top">
        <Hero />

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

        <HowItWorks />

        <Containment />
        <Gate />

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
      <SiteFooter />
    </>
  );
}
