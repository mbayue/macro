import { PLAN_ROWS, PLANS } from '../data.ts';

const NOTE = 'Launch pricing for the hosted product. Hosted plans open when domain verification ships.';

function actionClass(recommended: boolean, mobile: boolean): string {
  if (recommended) return 'btn btn--ink';
  return mobile ? 'btn' : 'btn btn--quiet';
}

export function Pricing() {
  return (
    <section className="pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="wrap">
        <div className="pricing-head-mobile">
          <h2 className="pricing-head-mobile__title">Priced by site</h2>
          <p className="pricing-head-mobile__note">{NOTE}</p>
        </div>
        <table className="ptable" data-reveal>
          <caption className="visually-hidden">Plans compared</caption>
          <colgroup>
            <col className="c-item" />
            {PLANS.map((p) => (
              <col key={p.name} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <h2 id="pricing-title">Priced by site</h2>
                <p>{NOTE}</p>
              </th>
              {PLANS.map((p) => (
                <th scope="col" key={p.name} className={p.recommended ? 'rec' : undefined}>
                  <span className="plan-name">{p.name}</span>
                  <span className="plan-price">
                    {p.price} <small>{p.period}</small>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {PLANS.map((p) => (
                  <td key={p.name} className={p.recommended ? 'rec' : undefined}>
                    {p[row.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {PLANS.map((p) => (
                <td key={p.name} className={p.recommended ? 'rec' : undefined}>
                  <a className={actionClass(p.recommended, false)} href={p.action.href}>
                    {p.action.label}
                  </a>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>

        <div className="plans-mobile">
          {PLANS.map((p) => (
            <div key={p.name} className={p.recommended ? 'plan-block plan-block--rec' : 'plan-block'}>
              <span className="plan-name">{p.name}</span>
              <span className="plan-price">
                {p.price} <small>{p.period}</small>
              </span>
              <dl>
                {PLAN_ROWS.slice(0, 4).map((row) => (
                  <div key={row.key}>
                    <dt>{row.label}</dt>
                    <dd>{p[row.key]}</dd>
                  </div>
                ))}
              </dl>
              <a className={actionClass(p.recommended, true)} href={p.action.href}>
                {p.action.label}
              </a>
            </div>
          ))}
        </div>
        <p className="pricing__cost">
          Why so low: one run costs us about 2 cents on Vultr, a few thousand tokens on Serverless Inference and five minutes of a
          $10-a-month VM. The paid plans pay for larger load generators and longer history.
        </p>
      </div>
    </section>
  );
}
