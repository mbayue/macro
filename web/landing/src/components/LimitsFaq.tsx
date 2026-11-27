/**
 * Beat 4: Early-access $0 Limits (Self-host + Hosted + mode table) and standalone open FAQ section (static HTML, zero JS).
 */
import { FREE_LIMITS, LANDING_FAQS } from '../data.ts';
import { sanokDitherSrc } from '../sanok.ts';

export function LimitsFaq() {
  return (
    <>
      <section className="lp-sec lp-sec-bordered" id="vd-limits">
        <div className="lp-container">
          <div className="lp-head-row" data-reveal>
            <div>
              <h2 className="lp-h2">Free while in early access</h2>
              <p className="lp-lead mt-3">
                Run the MIT-licensed code on your own server, or use the hosted app at zero cost on the Demo Target and one verified Own Site.
              </p>
            </div>
          </div>

          <div className="lp-plan-grid mt-7" data-reveal data-i="1">
            <article className="lp-subpanel lp-plan-card">
              <div>
                <div className="lp-plan-banner" aria-hidden="true">
                  <img src={sanokDitherSrc('span')} width={1920} height={1280} loading="lazy" alt="" />
                </div>
                <div className="lp-subpanel-head mt-4">
                  <h3 className="font-text text-[1rem] font-medium">Self-host</h3>
                  <span className="lp-meta-note">MIT licence</span>
                </div>
                <div className="lp-plan-price mt-3">
                  <span className="lp-kpi-val lp-mono">$0</span>
                  <span className="lp-meta-note">~2 cents / run</span>
                </div>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
                  Run your own copy and pay only your server and inference costs (about 2 cents per run).
                </p>
              </div>
              <a
                className="lp-btn lp-btn-secondary lp-btn-compact mt-5"
                href="https://github.com/mbayue/macro"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </article>

            <article className="lp-subpanel lp-plan-card lp-plan-featured">
              <div>
                <div className="lp-plan-banner" aria-hidden="true">
                  <img src={sanokDitherSrc('workers')} width={1920} height={1280} loading="lazy" alt="" />
                </div>
                <div className="lp-subpanel-head mt-4">
                  <h3 className="font-text text-[1rem] font-medium">Hosted early access</h3>
                  <span className="lp-meta-note">No card required</span>
                </div>
                <div className="lp-plan-price mt-3">
                  <span className="lp-kpi-val lp-mono">$0</span>
                  <span className="lp-meta-note">Demo + 1 Own Site</span>
                </div>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
                  Test yue.macro.my.id signed out, or sign in to verify one Own Site for private runs.
                </p>
              </div>
              <a className="lp-btn lp-btn-ink lp-btn-compact mt-5" href="/app/">
                Open Test Studio
              </a>
            </article>
          </div>

          <div className="lp-subpanel lp-limits-panel mt-4" data-reveal data-i="2">
            <div className="lp-subpanel-head">
              <span>Access modes and verification limits</span>
            </div>
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Target</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {FREE_LIMITS.map((row) => (
                    <tr key={row.mode}>
                      <td>
                        <span className="lp-mode-cell">
                          <strong>{row.mode}</strong>
                          <span className="lp-tag">{row.access}</span>
                        </span>
                      </td>
                      <td>
                        <span className="lp-num-chip">{row.target}</span>
                      </td>
                      <td>{row.verification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec lp-sec-bordered" id="vd-faq">
        <div className="lp-container">
          <div className="lp-head-row" data-reveal>
            <div>
              <h2 className="lp-h2">Frequently asked questions</h2>
              <p className="lp-lead mt-3">
                How target verification, Number Guard, and Hybrid Inference work in practice.
              </p>
            </div>
          </div>

          <div className="lp-faq-grid mt-7" data-reveal data-i="1">
            {LANDING_FAQS.map((item) => (
              <article key={item.q} className="lp-faq-item">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
