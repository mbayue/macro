/**
 * Recent runs (`#/runs`): runs and probes opened in this browser (local storage only), each with
 * its live status. An entry the server no longer knows is removed.
 */
import { useEffect, useState } from 'react';
import type { RunStatus } from '../../../../../src/types.ts';
import { getRun } from '../lib/api.ts';
import { fmtUtc } from '../lib/format.ts';
import { forgetRun, loadRecentRuns, type RecentRun } from '../lib/recent-runs.ts';
import { Badge, StatusBadge } from '../components/ui.tsx';
import { probeHref, runHref } from '../router.ts';

type Status = RunStatus | 'checking' | 'unknown';

export function RecentRunsPage() {
  const [list, setList] = useState<RecentRun[]>(() => loadRecentRuns());
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    const abort = new AbortController();
    for (const r of loadRecentRuns()) {
      void getRun(r.id, abort.signal).then((res) => {
        if (abort.signal.aborted) return;
        if (res.ok) setStatus((s) => ({ ...s, [r.id]: res.data.run.status }));
        else if (res.error.code === 'not_found') {
          forgetRun(r.id);
          setList((l) => l.filter((x) => x.id !== r.id));
        } else setStatus((s) => ({ ...s, [r.id]: 'unknown' }));
      });
    }
    return () => abort.abort();
  }, []);

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Recent runs</h1>
        <p className="page__lead">Runs and probes you opened in this browser. The list stays on this device and is never sent to Macro.</p>
      </header>
      {list.length === 0 ? (
        <div className="empty">
          <p>No runs yet. Every run you start or open appears here, so you can get back to it.</p>
          <div className="row">
            <a className="btn" href="#/">
              Start a new test
            </a>
            <a className="btn btn--quiet" href="#/probe">
              Run the containment probe
            </a>
          </div>
        </div>
      ) : (
        <ul className="runs">
          {list.map((r) => {
            const st = status[r.id] ?? 'checking';
            return (
              <li key={r.id}>
                <a className="runs__item" href={r.kind === 'probe' ? probeHref(r.id) : runHref(r.id)}>
                  <span className="runs__name">{r.kind === 'probe' ? 'Containment probe' : r.name}</span>
                  <span className="runs__meta">
                    <span className="code">{r.id}</span>
                    <span className="muted">started {fmtUtc(r.startedAt)}</span>
                  </span>
                  <span className="runs__status">
                    {st === 'checking' ? <Badge>checking</Badge> : st === 'unknown' ? <Badge>status unknown</Badge> : st === 'running' ? <Badge tone="live">running now</Badge> : <StatusBadge status={st} />}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
