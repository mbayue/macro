/**
 * Beat 4: Free Limits table & 4 open product-specific FAQs (static HTML, zero JS).
 */
import { FREE_LIMITS, LANDING_FAQS } from '../data.ts';

export function LimitsFaq() {
  return (
    <section className="lp-sec lp-sec-bordered" id="vd-limits">
      <div className="lp-container lp-split-5-7">
        <div data-reveal>
          <h2 className="lp-h2">Free on Demo Target, verified for Own Site</h2>
          <p className="lp-lead mt-3">
            Start immediately without an account, or sign in to verify one HTTPS origin via Domain Connect, DNS TXT, or /.well-known/.
          </p>
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
