/**
 * Live state of one run, with the same rules as the old run view (web/run-view.ts):
 *   - GET /api/runs/:id for the snapshot, then the event stream while the run is running;
 *     the first connection replays and is deduped, a reconnect also refetches the snapshot;
 *   - a 1 s tick: elapsed time, the "may be out of date" badge after 10 s of silence, a snapshot
 *     poll every 5 s while shouldPoll() says so (running, the end grace window, report wait);
 *   - Stop run is sent without an abort signal, so leaving the page never cancels it.
 * The model functions are imported unchanged; this hook only decides when to call them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../../../../../src/api-types.ts';
import { type ApiError, getRun, stopRun } from '../lib/api.ts';
import { rememberRun } from '../lib/recent-runs.ts';
import {
  applyEvent,
  applyLocalStatus,
  isStale,
  isTerminal,
  mergeSnapshot,
  modelFromSnapshot,
  parseEventView,
  POLL_MS,
  type RunModel,
  shouldPoll,
  statusWords,
} from '../lib/run-view.ts';
import { useApp } from '../context.tsx';

const EVENT_TYPES = ['stage_start', 'stage_end', 'decision', 'status', 'containment', 'report'] as const;

export type RunState =
  | { kind: 'loading' }
  | { kind: 'error'; error: ApiError }
  | { kind: 'ready'; model: RunModel; stale: boolean; now: number; version: number };

export function useRun(id: string) {
  const { navigate, announce } = useApp();
  const [state, setState] = useState<RunState>({ kind: 'loading' });
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Mutable run internals live in refs; `publish` copies them into React state.
  const model = useRef<RunModel | null>(null);
  const stale = useRef(false);
  const version = useRef(0);
  const disposed = useRef(false);

  const publish = useCallback(() => {
    if (!model.current || disposed.current) return;
    version.current += 1;
    setState({ kind: 'ready', model: model.current, stale: stale.current, now: Date.now(), version: version.current });
  }, []);

  const stopRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    disposed.current = false;
    // Local to this attempt: a request from an earlier attempt must not act after a retry.
    let dead = false;
    const abort = new AbortController();
    let es: EventSource | null = null;
    let esOpens = 0;
    let tick: number | undefined;
    let lastActivity = Date.now();
    let lastPollAt = Date.now();
    let lastStatus = '';
    let terminalSince: number | null = null;
    let liveTransition = false;
    let fetchSeq = 0;
    let appliedSeq = 0;

    const setStale = (next: boolean): void => {
      if (next === stale.current) return;
      stale.current = next;
      if (model.current?.run.status === 'running') announce(next ? 'Progress may be out of date.' : 'Progress updates resumed.');
    };

    // Lifecycle transitions after every model change (mirrors update() in run-view.ts).
    const update = (): void => {
      const m = model.current;
      if (!m) return;
      const status = m.run.status;
      const wasRunning = lastStatus === 'running';
      lastStatus = status;
      if (isTerminal(status)) {
        if (terminalSince === null) {
          terminalSince = Date.now();
          liveTransition = wasRunning;
        }
        stale.current = false;
        if (wasRunning) {
          announce(`Run ${statusWords(status)}.`);
          void refetch();
        }
      }
      publish();
    };

    const refetch = async (): Promise<void> => {
      if (dead) return;
      const seq = ++fetchSeq;
      const res = await getRun(id, abort.signal);
      if (dead || !res.ok || seq < appliedSeq) return;
      appliedSeq = seq;
      lastActivity = Date.now();
      setStale(false);
      model.current = model.current ? mergeSnapshot(model.current, res.data) : modelFromSnapshot(res.data);
      update();
    };

    const onMessage = (data: unknown): void => {
      if (dead || !model.current) return;
      lastActivity = Date.now();
      setStale(false);
      const ev = parseEventView(data);
      if (!ev || ev.runId !== id) return;
      const result = applyEvent(model.current, ev);
      if (!result.applied) return;
      update();
      if (result.needsSnapshot) void refetch();
    };

    const openStream = (): void => {
      const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
      es = source;
      const handler = (ev: Event): void => onMessage((ev as MessageEvent).data);
      source.onmessage = handler;
      for (const type of EVENT_TYPES) source.addEventListener(type, handler);
      source.addEventListener('open', () => {
        esOpens += 1;
        if (esOpens > 1) void refetch();
      });
    };

    const closeStream = (): void => {
      es?.close();
      es = null;
    };

    const onTick = (): void => {
      const m = model.current;
      if (dead || !m) return;
      const now = Date.now();
      const status = m.run.status;
      if (status === 'running') setStale(isStale(lastActivity, now, status));
      const since = terminalSince === null ? null : now - terminalSince;
      if (shouldPoll(status, m.report !== null, since, liveTransition)) {
        if (now - lastPollAt >= POLL_MS) {
          lastPollAt = now;
          void refetch();
        }
      } else if (es) {
        closeStream();
        void refetch();
      } else if (isTerminal(status)) {
        window.clearInterval(tick);
        tick = undefined;
      }
      // Re-render for the elapsed clock and the stage progress while running.
      if (status === 'running') publish();
    };

    stopRef.current = async () => {
      const m = model.current;
      if (!m || m.run.status !== 'running') return;
      setStopPending(true);
      setStopError(null);
      const res = await stopRun(id); // no abort signal, on purpose
      if (dead || !model.current) return;
      setStopPending(false);
      if (!res.ok) {
        setStopError(res.error);
        return;
      }
      if (isTerminal(res.data.status)) applyLocalStatus(model.current, res.data.status, Date.now());
      update();
      void refetch();
    };

    const mount = (snapshot: RunSnapshot): void => {
      model.current = modelFromSnapshot(snapshot);
      lastStatus = model.current.run.status;
      lastActivity = Date.now();
      lastPollAt = Date.now();
      update();
      if (model.current.run.status === 'running') openStream();
      tick = window.setInterval(onTick, 1000);
    };

    void (async () => {
      setState({ kind: 'loading' });
      const res = await getRun(id, abort.signal);
      if (dead) return;
      if (!res.ok) {
        setState({ kind: 'error', error: res.error });
        return;
      }
      if (res.data.run.kind === 'probe') {
        navigate(`/probe/${encodeURIComponent(id)}`);
        return;
      }
      rememberRun({ id, kind: 'run', name: res.data.plan?.name ?? 'Load test', startedAt: res.data.run.startedAt });
      mount(res.data);
    })();

    return () => {
      dead = true;
      disposed.current = true;
      abort.abort();
      closeStream();
      if (tick !== undefined) window.clearInterval(tick);
      model.current = null;
    };
  }, [id, attempt, announce, navigate, publish]);

  return {
    state,
    stop: () => void stopRef.current(),
    stopPending,
    stopError,
    retry: () => setAttempt((a) => a + 1),
  };
}
