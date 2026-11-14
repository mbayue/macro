/**
 * Recent runs (`#/runs`): signed-in account runs when available; otherwise browser-local list.
 */
import { useEffect, useState } from 'react';
import type { RunStatus } from '../../../../../src/types.ts';
import { getRun } from '../lib/api.ts';
import { fmtUtc } from '../lib/format.ts';
import { forgetRun, loadRecentRuns } from '../lib/recent-runs.ts';
import { Badge, StatusBadge } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { probeHref, runHref } from '../router.ts';

type Status = RunStatus | 'checking' | 'unknown';

type Row = {
  id: string;
  kind: 'run' | 'probe';
  name: string;
  startedAt: number;
};

export function RecentRunsPage() {
  const { me } = useApp();
  const [list, setList] = useState<Row[]>(() =>
    loadRecentRuns().map((r) => ({ id: r.id, kind: r.kind, name: r.name, startedAt: r.startedAt })),
  );
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [source, setSource] = useState<'account' | 'browser'>('browser');

  useEffect(() => {
    const abort = new AbortController();
    let timer: number | undefined;

    const loadAccount = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/account/runs', { credentials: 'same-origin', signal: abort.signal });
        if (!res.ok) return false;
        const body = (await res.json()) as {
          runs: { runId: string; kind?: 'run' | 'probe'; startedAt: number; status: RunStatus; title?: string }[];
        };
        if (abort.signal.aborted) return true;
        setSource('account');
        setList(
          body.runs.map((r) => ({
            id: r.runId,
            kind: r.kind ?? 'run',
            name: r.title && r.title.trim() !== '' ? r.title : r.kind === 'probe' ? 'Containment probe' : 'Load test',
            startedAt: r.startedAt,
          })),
        );
        setStatus(Object.fromEntries(body.runs.map((r) => [r.runId, r.status])));
        const hasPending = body.runs.some((r) => r.status === 'queued' || r.status === 'running');
        if (hasPending) {
          timer = window.setTimeout(() => void loadAccount(), 3000);
        }
        return true;
      } catch {
        return false;
      }
    };

    void (async () => {
      if (me !== null && (await loadAccount())) return;
      if (abort.signal.aborted) return;

      setSource('browser');
      const local = loadRecentRuns();
      setList(local.map((r) => ({ id: r.id, kind: r.kind, name: r.name, startedAt: r.startedAt })));
      for (const r of local) {
        void getRun(r.id, abort.signal).then((res) => {
          if (abort.signal.aborted) return;
          if (res.ok) setStatus((s) => ({ ...s, [r.id]: res.data.run.status }));
          else if (res.error.code === 'not_found') {
            forgetRun(r.id);
            setList((l) => l.filter((x) => x.id !== r.id));
          } else setStatus((s) => ({ ...s, [r.id]: 'unknown' }));
        });
      }
    })();
    return () => {
      abort.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [me]);

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Recent runs</h1>
        <p className="page__lead">
          {source === 'account'
            ? 'Runs attached to your Macro account, newest first.'
            : 'Runs and probes you opened in this browser. The list stays on this device until you sign in.'}
        </p>
      </header>
      {list.length === 0 ? (
        <div className="empty">
          <p>
            {source === 'account'
              ? 'No account runs yet. Draft a plan and approve it, or claim demo runs from this browser after sign-in.'
              : 'No runs yet. Every run you start or open appears here, so you can get back to it.'}
          </p>
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
                    {st === 'checking' ? (
                      <Badge>checking</Badge>
                    ) : st === 'unknown' ? (
                      <Badge>status unknown</Badge>
                    ) : st === 'running' ? (
                      <Badge tone="live">running now</Badge>
                    ) : (
                      <StatusBadge status={st} />
                    )}
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
