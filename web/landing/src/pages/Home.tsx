import { Close } from '../components/Close.tsx';
import { Containment } from '../components/Containment.tsx';
import { Faq } from '../components/Faq.tsx';
import { FreePlans } from '../components/FreePlans.tsx';
import { HybridAi } from '../components/HybridAi.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { WhyMeasured } from '../components/WhyMeasured.tsx';
import { Gate } from '../components/Gate.tsx';
import { Hero } from '../components/Hero.tsx';
import { LoadTheDeck } from '../components/LoadTheDeck.tsx';

/**
 * The home page, prerendered at build time and hydrated (entry-home.tsx). Sections below the hero enter with the scroll reveal (data-reveal, reveal.ts); the hero has its own CSS-only
 * entrance so the first screen never waits for the script.
 */
export function Home() {
  return (
    <>
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <main id="top">
        <Hero />
        <LoadTheDeck />
        <Containment />
        <Gate />
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
