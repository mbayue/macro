import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { fmtMs } from '../../../../../../src/run/format.ts';
import type { RunModel } from '../../lib/run-view.ts';
import { ModelCalls } from '../ModelCalls.tsx';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';
import { DASH, StatusBadge, TableWrap } from '../ui.tsx';
import { buildAuditLogModel } from './report-tabs.ts';

/**
 * Audit Log tab: built solely from snapshot and live event stream data.
 * Shows Policy Gate / plan approval metadata, Supervisor decisions, containment events, and model calls.
 */
export const AuditLog = memo(function AuditLog({
  model,
  revision: _revision,
}: {
  model: RunModel;
  revision: string;
}) {
  const audit = buildAuditLogModel(model);
  const { gate, decisions, containment, modelCalls } = audit;

  return (
    <div className="flex flex-col gap-4">
      <TelemetryPanel ticks="bar" aria-labelledby="audit-gate-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="audit-gate-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Policy Gate &amp; plan approval
          </h2>
          <Badge variant={gate.verdictTone === 'ok' ? 'ok' : 'outline'}>{gate.verdictLabel}</Badge>
        </div>

        <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Target</dt>
            <dd className="m-0 min-w-0 font-mono text-xs break-all text-foreground">
              {gate.target ?? 'Not recorded'}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Stop thresholds</dt>
            <dd className="m-0 min-w-0 font-mono text-xs text-foreground tabular-nums">
              {gate.stopThresholds
                ? `p95 ${fmtMs(gate.stopThresholds.p95Ms)} ms · errors ${gate.stopThresholds.errorRatePct}%`
                : 'Not recorded'}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Sandbox runtime</dt>
            <dd className="m-0 min-w-0 font-mono text-xs text-foreground">{gate.runtime}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Started (UTC)</dt>
            <dd className="m-0 min-w-0 font-mono text-xs text-foreground tabular-nums">{gate.startedAtUtc}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Ended (UTC)</dt>
            <dd className="m-0 min-w-0 font-mono text-xs text-foreground tabular-nums">
              {gate.endedAtUtc ?? 'In progress'}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">Run status</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <StatusBadge status={gate.status} />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3 sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-muted-foreground">Approved plan hash</dt>
            <dd className="m-0 min-w-0 font-mono text-xs break-all text-foreground">
              {gate.planHash ?? 'Not recorded'}
            </dd>
          </div>
        </dl>

        {gate.statusReason ? (
          <p className="m-0 text-sm text-muted-foreground">{gate.statusReason}</p>
        ) : null}
      </TelemetryPanel>

      <TelemetryPanel ticks="bar" aria-labelledby="audit-decisions-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="audit-decisions-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Supervisor decisions
          </h2>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {decisions.length === 0 ? 'none recorded' : `${decisions.length} recorded`}
          </span>
        </div>

        {decisions.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            No supervisor decisions have been recorded yet. Decisions appear after each stage ends.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {decisions.map((d) => (
              <li key={d.stageIndex} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium text-foreground tabular-nums">{d.stageLabel}</span>
                  <Badge variant={d.decisionTone === 'ok' ? 'ok' : 'warn'}>{d.decision}</Badge>
                  <span className="text-xs text-muted-foreground">{d.sourceLabel}</span>
                  {d.reasonWithheld && d.withheldNote ? (
                    <Badge variant="warn">{d.withheldNote}</Badge>
                  ) : null}
                </div>
                <p className="m-0 max-w-[72ch] text-sm text-foreground">{d.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </TelemetryPanel>

      <TelemetryPanel ticks="bar" aria-labelledby="audit-containment-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="audit-containment-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Containment events
          </h2>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {containment.length === 0 ? 'none recorded' : `${containment.length} events · oldest first, UTC`}
          </span>
        </div>

        {containment.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No containment events have been recorded yet.</p>
        ) : (
          <TableWrap label="Containment events">
            <table className="data-table w-full min-w-[640px] print:min-w-0 print:table-auto">
              <caption className="sr-only">Containment events in chronological UTC order</caption>
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Event</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="end">
                    Scope
                  </th>
                </tr>
              </thead>
              <tbody>
                {containment.map((ev) => (
                  <tr key={ev.id}>
                    <th scope="row" className="font-mono text-xs font-normal whitespace-nowrap text-muted-foreground tabular-nums">
                      {ev.utc}
                    </th>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Badge variant={ev.warn ? 'warn' : 'outline'}>{ev.warn ? 'warning' : 'lifecycle'}</Badge>
                        <span className="text-sm text-foreground">{ev.label}</span>
                      </span>
                    </td>
                    <td className="font-mono text-xs break-all text-foreground">{ev.target ?? DASH}</td>
                    <td className="end font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {ev.scopeLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </TelemetryPanel>

      <ModelCalls calls={modelCalls} />
    </div>
  );
});
