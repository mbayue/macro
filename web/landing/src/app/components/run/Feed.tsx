/**
 * One stream of what happened, newest first: stages starting and finishing, the supervisor's
 * decision after each stage, and every containment event. Times are UTC.
 * A decision has no timestamp of its own; it is placed right after its stage ended.
 */
import type { DecisionView, StageView } from '../../../../../../src/api-types.ts';
import { fmtMs, fmtPct } from '../../../../../../src/run/format.ts';
import { containmentLabel, type ContainmentEntry, formatClock, isWarnContainment } from '../../../../../run-view.ts';
import { AI_WITHHELD_NOTE } from '../../../../../report-view.ts';
import { Badge } from '../ui.tsx';

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
    <time className="feed__time" dateTime={new Date(ts).toISOString()}>
      {formatClock(ts)}
    </time>
  );
}

export function Feed({
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
    <section className="panel feed" aria-labelledby="feed-title">
      <div className="panel__head">
        <h2 id="feed-title">What happened</h2>
        <span className="muted">Newest first, UTC</span>
      </div>
      {list.length === 0 ? (
        <p className="muted">Nothing has happened yet. The first sandbox is being prepared.</p>
      ) : (
        <ol className="feed__list">
          {list.map((it, n) => {
            switch (it.kind) {
              case 'stage-start':
                return (
                  <li key={`s${it.stage.index}-${n}`} className="feed__item">
                    <Time ts={it.ts} />
                    <p>
                      <b>{of(it.stage)} started</b> with {it.stage.vus} virtual users for {it.stage.durationSec} s.
                    </p>
                  </li>
                );
              case 'stage-end': {
                const m = it.stage.metrics?.overall ?? null;
                return (
                  <li key={`e${it.stage.index}-${n}`} className="feed__item">
                    <Time ts={it.ts} />
                    <p>
                      <b>{of(it.stage)} finished</b>{' '}
                      {it.stage.status === 'error' ? (
                        <Badge tone="bad">error</Badge>
                      ) : it.stage.verdict ? (
                        <Badge tone={it.stage.verdict === 'pass' ? 'ok' : 'bad'}>{it.stage.verdict}</Badge>
                      ) : null}
                    </p>
                    {it.stage.status === 'error' ? (
                      <p className="feed__detail">{it.stage.errorReason ?? 'No reason was recorded.'}</p>
                    ) : m ? (
                      <p className="feed__detail num">
                        p95 {fmtMs(m.p95)} ms, errors {fmtPct(m.errorRatePct)}
                      </p>
                    ) : null}
                  </li>
                );
              }
              case 'decision':
                return (
                  <li key={`d${it.decision.stageIdx}-${n}`} className="feed__item">
                    <Time ts={it.ts} />
                    <p>
                      <b>{it.decision.decision === 'continue' ? `Continue after stage ${it.decision.stageIdx + 1}` : `Stop after stage ${it.decision.stageIdx + 1}`}</b>{' '}
                      <Badge tone={it.decision.decision === 'continue' ? 'ok' : 'warn'}>{it.decision.decision}</Badge>{' '}
                      <span className="muted">{it.decision.source === 'agent' ? 'supervisor (AI)' : 'fixed fallback rule'}</span>
                    </p>
                    <p className="feed__detail prose">{it.decision.reason}</p>
                    {it.decision.reasonWithheld ? <p className="feed__detail"><Badge tone="warn">{AI_WITHHELD_NOTE}</Badge></p> : null}
                  </li>
                );
              case 'containment': {
                const e = it.event;
                const warn = isWarnContainment(e.type);
                const where = e.host !== undefined ? (e.port !== undefined ? `${e.host}:${e.port}` : e.host) : e.port !== undefined ? `port ${e.port}` : null;
                return (
                  <li key={`c${e.id}`} className={warn ? 'feed__item is-warn' : 'feed__item'}>
                    <Time ts={it.ts} />
                    <p>
                      <Badge tone={warn ? 'warn' : 'neutral'}>Containment</Badge> <b>{containmentLabel(e.type)}</b>
                      {e.stageIdx !== null ? <span className="muted">, stage {e.stageIdx + 1}</span> : <span className="muted">, run</span>}
                    </p>
                    {where ? <p className="feed__detail code">{where}</p> : null}
                  </li>
                );
              }
            }
          })}
        </ol>
      )}
    </section>
  );
}
