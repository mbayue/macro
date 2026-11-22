import { Close } from '../components/Close.tsx';
import { LimitsFaq } from '../components/LimitsFaq.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { Island } from '../islands.tsx';

/**
 * The home page, prerendered at build time. Beats 1-3 (HeroWorkbench, Pipeline, SanokProof)
 * hydrate as islands (islands.tsx); Beats 4-5 (LimitsFaq, Close) and SiteFooter stay static HTML.
 */
export function Home() {
  return (
    <>
      <a className="skip-link" href="#hero-content">
        Skip to content
      </a>
      <main id="top">
        <Island name="hero" />
        <Island name="pipeline" />
        <Island name="proof" />
        <LimitsFaq />
        <Close />
      </main>
      <SiteFooter />
    </>
  );
}
