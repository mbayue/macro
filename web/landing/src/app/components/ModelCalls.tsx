import type { ModelCallView } from '../../../../../src/api-types.ts';
import { modelCallRows } from '../lib/report-view.ts';
import { Badge, TableWrap, type Tone } from './ui.tsx';

const NOT_REPORTED = 'not reported';
const tokenText = (n: number | null): string => (n === null ? NOT_REPORTED : String(n));
const totalText = (a: number | null, b: number | null): string => (a === null && b === null ? NOT_REPORTED : String((a ?? 0) + (b ?? 0)));

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
              <col className="w-tok" />
              <col className="w-tok" />
              <col className="w-tok" />
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
                <th scope="col" className="num">
                  Input tokens
                </th>
                <th scope="col" className="num">
                  Output tokens
                </th>
                <th scope="col" className="num">
                  Total tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = calls[i]!;
                return (
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
                    <td className={c.promptTokens === null ? 'num muted' : 'num'}>{tokenText(c.promptTokens)}</td>
                    <td className={c.completionTokens === null ? 'num muted' : 'num'}>{tokenText(c.completionTokens)}</td>
                    <td className="num">{totalText(c.promptTokens, c.completionTokens)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </details>
  );
}
