/**
 * Beat 5: Atmospheric Closing CTA (static HTML, zero JS).
 * Uses zero-flash CSS-switched backdrops (Sanok workers in light mode, dark horizon in dark mode).
 */
import { DARK_HORIZON_SRC, sanokDitherSrc } from '../sanok.ts';

export function Close() {
  return (
    <section className="lp-atmo lp-sec-tight">
      <img className="lp-atmo-bg lp-atmo-bg-light" src={sanokDitherSrc('workers')} alt="" aria-hidden="true" />
      <img className="lp-atmo-bg lp-atmo-bg-dark" src={DARK_HORIZON_SRC} alt="" aria-hidden="true" />
      <div className="lp-scrim" aria-hidden="true" />

      <div className="lp-container lp-close-box" data-reveal>
        <div className="lp-stage-band" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
        <h2 className="lp-h2">Measure Safe Capacity before launch day</h2>
        <p className="lp-lead lp-hero-lead">
          Open Test Studio to draft a Test Plan against yue.macro.my.id or verify your Own Site.
        </p>
        <div className="lp-cta-row">
          <a className="lp-btn lp-btn-primary" href="/app/">Open Test Studio</a>
          <a className="lp-btn lp-btn-secondary" href="/app/#/probe">Run Containment Probe</a>
        </div>
      </div>
    </section>
  );
}
