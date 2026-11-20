import { Close } from '../components/Close.tsx';
import { Containment } from '../components/Containment.tsx';
import { Faq } from '../components/Faq.tsx';
import { FreePlans } from '../components/FreePlans.tsx';
import { HybridAi } from '../components/HybridAi.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { WhyMeasured } from '../components/WhyMeasured.tsx';
import { Island } from '../islands.tsx';

/**
 * The home page, prerendered at build time. The hero, Load the deck, the gate switch and the waitlist
 * are islands (islands.tsx), hydrated by entry-home.tsx; everything else stays static HTML. Sections
 * below the hero enter with the scroll reveal (data-reveal, reveal.ts); the hero has its own CSS-only
 * entrance so the first screen never waits for the script.
 */
export function Home() {
  return (
    <>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <main id="top">
        <Island name="hero" />
        <Island name="load" />
        <Containment />
        <Island name="gate" />
        <WhyMeasured />
        <HybridAi />
        <FreePlans />
        <Faq />
        <Close />
      </main>
      <SiteFooter />
    </>
  );
}
