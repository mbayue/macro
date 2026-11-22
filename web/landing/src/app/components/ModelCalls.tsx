import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ModelCallView } from '../../../../../src/api-types.ts';
import { modelCallRows } from '../lib/report-view.ts';
import { TableWrap } from './ui.tsx';

const NOT_REPORTED = 'not reported';
const tokenText = (n: number | null): string => (n === null ? NOT_REPORTED : String(n));
const totalText = (a: number | null, b: number | null): string =>
  a === null && b === null ? NOT_REPORTED : String((a ?? 0) + (b ?? 0));

const outcomeVariant = (o: ModelCallView['outcome']): 'ok' | 'warn' | 'destructive' =>
  o === 'success' ? 'ok' : o === 'timeout' ? 'warn' : 'destructive';

/** Every AI call behind this screen, with model, latency and tokens. */
export const ModelCalls = memo(function ModelCalls({ calls }: { calls: readonly ModelCallView[] }) {
  const rows = modelCallRows(calls);
  return (
    <section
      aria-label="Model calls"
      className="flex flex-col gap-3.5 rounded-md border border-[var(--ap-line-strong)] bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
          Model calls
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {rows.length === 0 ? 'none recorded' : `${rows.length} in request order`}
        </span>
      </div>

      <div>
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No model calls were recorded.</p>
        ) : (
          <TableWrap label="Model calls">
            <table className="data-table w-full min-w-[820px] table-fixed print:min-w-0 print:table-auto">
              <colgroup>
                <col className="w-12" />
                <col className="w-[13%]" />
                <col className="w-[24%]" />
                <col className="w-[116px]" />
                <col className="w-[112px]" />
                <col className="w-[112px]" />
                <col className="w-[116px]" />
                <col className="w-[112px]" />
              </colgroup>
              <caption className="sr-only">Model calls in request order</caption>
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
                      <th scope="row" className="idx font-mono tabular-nums">
                        {r.n}
                      </th>
                      <td className="font-mono text-xs" translate="no">{r.agent}</td>
                      <td className="font-mono text-xs break-all" translate="no">{r.model}</td>
                      <td>
                        <Badge variant={outcomeVariant(r.outcome)}>{r.outcome}</Badge>
                      </td>
                      <td className="num font-mono tabular-nums">{r.latency}</td>
                      <td className={cn('num', c.promptTokens === null ? 'text-muted-foreground' : 'font-mono tabular-nums')}>
                        {tokenText(c.promptTokens)}
                      </td>
                      <td
                        className={cn(
                          'num',
                          c.completionTokens === null ? 'text-muted-foreground' : 'font-mono tabular-nums',
                        )}
                      >
                        {tokenText(c.completionTokens)}
                      </td>
                      <td className="num font-mono tabular-nums">{totalText(c.promptTokens, c.completionTokens)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </section>
  );
});
