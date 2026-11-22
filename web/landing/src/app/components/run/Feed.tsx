/**
 * One stream of what happened, newest first: stages starting and finishing, the supervisor's
 * decision after each stage, and every containment event. Times are UTC.
 * A decision has no timestamp of its own; it is placed right after its stage ended.
 */
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { DecisionView, StageView } from '../../../../../../src/api-types.ts';
import { fmtMs, fmtPct } from '../../../../../../src/run/format.ts';
import { AI_WITHHELD_NOTE } from '../../lib/report-view.ts';
import { containmentLabel, type ContainmentEntry, formatClock, isWarnContainment } from '../../lib/run-view.ts';
import { TelemetryPanel } from '../studio/TelemetryFrame.tsx';

type Item =
  | { kind: 'stage-start'; ts: number; stage: StageView }
  | { kind: 'stage-end'; ts: number; stage: StageView }
  | { kind: 'decision'; ts: number; decision: DecisionView }
  | { kind: 'containment'; ts: number; event: ContainmentEntry };

function items(stages: readonly StageView[], decisions: readonly DecisionView[], containment: readonly ContainmentEntry[]): Item[] {
  const out: Item[] = [];
  const ends = new Map<number, number>();
  for (const s of stages) {
    if (s.startedAt !== null) out.push({ kind: 'stage-start', ts: s.startedAt, stage: s });
    if (s.endedAt !== null && s.status !== 'running') {
      out.push({ kind: 'stage-end', ts: s.endedAt, stage: s });
      ends.set(s.index, s.endedAt);
    }
  }
  for (const d of decisions) {
    const at = ends.get(d.stageIdx);
    if (at !== undefined) out.push({ kind: 'decision', ts: at + 1, decision: d });
  }
  for (const e of containment) out.push({ kind: 'containment', ts: e.ts, event: e });
  // Newest first; at the same instant, a later id or step stays above an earlier one.
  return out.map((it, i) => ({ it, i })).sort((a, b) => b.it.ts - a.it.ts || b.i - a.i).map((x) => x.it);
}

function Time({ ts }: { ts: number }) {
  return (
    <time className="font-mono text-xs text-muted-foreground tabular-nums" dateTime={new Date(ts).toISOString()}>
      {formatClock(ts)}
    </time>
  );
}

export const Feed = memo(function Feed({
  stages,
  decisions,
  containment,
  total,
}: {
  stages: readonly StageView[];
  decisions: readonly DecisionView[];
  containment: readonly ContainmentEntry[];
  total: number | null;
}) {
  const list = items(stages, decisions, containment);
  const of = (s: StageView) => (total !== null ? `Stage ${s.index + 1} of ${total}` : `Stage ${s.index + 1}`);
  return (
    <TelemetryPanel
      ticks="bar"
      aria-labelledby="feed-title"
      className="max-h-[360px] grid-rows-[auto_minmax(0,1fr)] min-[1180px]:max-h-[440px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <h2 id="feed-title" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
          What happened
        </h2>
        <span className="font-mono text-xs text-muted-foreground">Newest first, UTC</span>
      </div>
      {list.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          Nothing has happened yet. The first sandbox is being prepared.
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col divide-y divide-border overflow-y-auto p-0 pr-1">
          {list.map((it, n) => {
            switch (it.kind) {
              case 'stage-start':
                return (
                  <li key={`s${it.stage.index}-${n}`} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0">
                    <Time ts={it.ts} />
                    <p className="m-0 text-foreground">
                      <strong className="font-medium">{of(it.stage)} started</strong> with{' '}
                      <span className="font-mono tabular-nums">{it.stage.vus}</span> virtual users for{' '}
                      <span className="font-mono tabular-nums">{it.stage.durationSec}</span> s.
                    </p>
                  </li>
                );
              case 'stage-end': {
                const m = it.stage.metrics?.overall ?? null;
                return (
                  <li key={`e${it.stage.index}-${n}`} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0">
                    <Time ts={it.ts} />
                    <p className="m-0 flex flex-wrap items-center gap-2 text-foreground">
                      <strong className="font-medium">{of(it.stage)} finished</strong>
                      {it.stage.status === 'error' ? (
                        <Badge variant="destructive">error</Badge>
                      ) : it.stage.verdict ? (
                        <Badge variant={it.stage.verdict === 'pass' ? 'ok' : 'destructive'}>{it.stage.verdict}</Badge>
                      ) : null}
                    </p>
                    {it.stage.status === 'error' ? (
                      <p className="m-0 text-xs text-muted-foreground">
                        {it.stage.errorReason ?? 'No reason was recorded.'}
                      </p>
                    ) : m ? (
                      <p className="m-0 font-mono text-xs text-muted-foreground tabular-nums">
                        p95 {fmtMs(m.p95)} ms, errors {fmtPct(m.errorRatePct)}
                      </p>
                    ) : null}
                  </li>
                );
              }
              case 'decision':
                return (
                  <li key={`d${it.decision.stageIdx}-${n}`} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0">
                    <Time ts={it.ts} />
                    <p className="m-0 flex flex-wrap items-center gap-2 text-foreground">
                      <strong className="font-medium">
                        {it.decision.decision === 'continue'
                          ? `Continue after stage ${it.decision.stageIdx + 1}`
                          : `Stop after stage ${it.decision.stageIdx + 1}`}
                      </strong>
                      <Badge variant={it.decision.decision === 'continue' ? 'ok' : 'warn'}>
                        {it.decision.decision}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {it.decision.source === 'agent' ? 'supervisor (AI)' : 'fixed fallback rule'}
                      </span>
                    </p>
                    <p className="m-0 max-w-[72ch] text-xs text-muted-foreground">{it.decision.reason}</p>
                    {it.decision.reasonWithheld ? (
                      <div>
                        <Badge variant="warn">{AI_WITHHELD_NOTE}</Badge>
                      </div>
                    ) : null}
                  </li>
                );
              case 'containment': {
                const e = it.event;
                const warn = isWarnContainment(e.type);
                const where =
                  e.host !== undefined
                    ? e.port !== undefined
                      ? `${e.host}:${e.port}`
                      : e.host
                    : e.port !== undefined
                      ? `port ${e.port}`
                      : null;
                return (
                  <li key={`c${e.id}`} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0">
                    <Time ts={it.ts} />
                    <p className="m-0 flex flex-wrap items-center gap-2 text-foreground">
                      <Badge variant={warn ? 'warn' : 'outline'}>Containment</Badge>
                      <strong className="font-medium">{containmentLabel(e.type)}</strong>
                      <span className="text-xs text-muted-foreground">
                        {e.stageIdx !== null ? `stage ${e.stageIdx + 1}` : 'run'}
                      </span>
                    </p>
                    {where ? <p className="m-0 font-mono text-xs break-all text-muted-foreground">{where}</p> : null}
                  </li>
                );
              }
            }
          })}
        </ol>
      )}
    </TelemetryPanel>
  );
});
