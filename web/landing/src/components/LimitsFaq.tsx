/**
 * Beat 4: Early-access $0 Pricing (Self-host + Hosted), Limits table & 4 open FAQs (static HTML, zero JS).
 */
import { FREE_LIMITS, LANDING_FAQS } from '../data.ts';

export function LimitsFaq() {
  return (
    <section className="lp-sec lp-sec-bordered" id="vd-pricing">
      <div className="lp-container lp-split-5-7">
        <div data-reveal>
          <h2 className="lp-h2">Free while in early access</h2>
          <p className="lp-lead mt-3">
            Run the MIT-licensed code on your own server, or use the hosted app at zero cost on the Demo Target and one verified Own Site.
          </p>

          <div className="lp-plan-grid mt-5">
            <article className="lp-subpanel">
              <div>
                <div className="lp-subpanel-head">
                  <h3 className="font-text text-[1rem] font-medium">Self-host</h3>
                  <span className="lp-tag">MIT licence</span>
                </div>
                <div className="lp-kpi-val lp-mono mt-3">$0</div>
                <p className="mt-2 text-[14px] text-muted">
                  Run your own copy and pay only your server and inference costs (about 2 cents per run).
                </p>
              </div>
              <a
                className="lp-btn lp-btn-secondary lp-btn-compact mt-4"
                href="https://github.com/mbayue/macro"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </article>

            <article className="lp-subpanel lp-plan-featured">
              <div>
                <div className="lp-subpanel-head">
                  <h3 className="font-text text-[1rem] font-medium">Hosted early access</h3>
                  <span className="lp-tag lp-tag-ok">No card</span>
                </div>
                <div className="lp-kpi-val lp-mono mt-3">$0</div>
                <p className="mt-2 text-[14px] text-muted">
                  Test yue.macro.my.id signed out, or sign in to verify one Own Site for private runs.
                </p>
              </div>
              <a className="lp-btn lp-btn-ink lp-btn-compact mt-4" href="/app/">
                Open Test Studio
              </a>
            </article>
          </div>

          <table className="lp-table mt-5">
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
                  <td><strong>{row.mode}</strong></td>
                  <td className="lp-mono">{row.target}</td>
                  <td>{row.verification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lp-faq-list" id="vd-faq" data-reveal data-i="1">
          {LANDING_FAQS.map((item) => (
            <article key={item.q} className="lp-faq-item">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
