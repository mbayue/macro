import type { ModelCallView } from '../../../../../src/api-types.ts';
import { modelCallRows } from '../../../../report-view.ts';
import { Badge, TableWrap, type Tone } from './ui.tsx';

const outcomeTone = (o: ModelCallView['outcome']): Tone => (o === 'success' ? 'ok' : o === 'timeout' ? 'warn' : 'bad');

/** Every AI call behind this screen, with model, latency and tokens. Collapsed by default. */
export function ModelCalls({ calls }: { calls: readonly ModelCallView[] }) {
  const rows = modelCallRows(calls);
  return (
    <details className="panel disclosure">
      <summary>
        <h2 className="disclosure__title">Model calls</h2>
        <span className="disclosure__count">{rows.length === 0 ? 'none recorded' : `${rows.length} in request order`}</span>
      </summary>
      {rows.length === 0 ? (
        <p className="muted">No model calls were recorded.</p>
      ) : (
        <TableWrap label="Model calls">
          <table className="table table--calls">
            <colgroup>
              <col className="w-idx" />
              <col className="w-agent" />
              <col className="w-model" />
              <col className="w-outcome" />
              <col className="w-latency" />
              <col className="w-tokens" />
            </colgroup>
            <caption className="visually-hidden">Model calls in request order</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Agent</th>
                <th scope="col">Model</th>
                <th scope="col">Outcome</th>
                <th scope="col" className="num">
                  Latency (ms)
                </th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n}>
                  <th scope="row" className="idx">
                    {r.n}
                  </th>
                  <td className="code">{r.agent}</td>
                  <td className="code">{r.model}</td>
                  <td>
                    <Badge tone={outcomeTone(r.outcome)}>{r.outcome}</Badge>
                  </td>
                  <td className="num">{r.latency}</td>
                  <td>{r.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </details>
  );
}
