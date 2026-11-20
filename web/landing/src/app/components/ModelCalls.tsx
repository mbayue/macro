import { memo } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ModelCallView } from '../../../../../src/api-types.ts';
import { modelCallRows } from '../lib/report-view.ts';
import { TableWrap } from './ui.tsx';

const NOT_REPORTED = 'not reported';
const tokenText = (n: number | null): string => (n === null ? NOT_REPORTED : String(n));
const totalText = (a: number | null, b: number | null): string =>
  a === null && b === null ? NOT_REPORTED : String((a ?? 0) + (b ?? 0));

const outcomeVariant = (o: ModelCallView['outcome']): 'ok' | 'warn' | 'destructive' =>
  o === 'success' ? 'ok' : o === 'timeout' ? 'warn' : 'destructive';

/** Every AI call behind this screen, with model, latency and tokens. Collapsed by default. */
export const ModelCalls = memo(function ModelCalls({ calls }: { calls: readonly ModelCallView[] }) {
  const rows = modelCallRows(calls);
  return (
    <details className="group rounded-md border border-border bg-surface p-5 sm:px-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-0.5 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">Model calls</h2>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {rows.length === 0 ? 'none recorded' : `${rows.length} in request order`}
          </span>
        </div>
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>

      <div className="mt-3.5">
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
                      <td className="font-mono text-xs">{r.agent}</td>
                      <td className="font-mono text-xs break-all">{r.model}</td>
                      <td>
                        <Badge variant={outcomeVariant(r.outcome)}>{r.outcome}</Badge>
                      </td>
                      <td className="num font-mono tabular-nums">{r.latency}</td>
                      <td className={c.promptTokens === null ? 'num text-muted-foreground' : 'num font-mono tabular-nums'}>
                        {tokenText(c.promptTokens)}
                      </td>
                      <td
                        className={
                          c.completionTokens === null ? 'num text-muted-foreground' : 'num font-mono tabular-nums'
                        }
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
    </details>
  );
});
