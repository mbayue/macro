import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_HYBRID_REMOTE_CONFIG,
  createFirebaseHybridRunner,
  detectOnDeviceAvailability,
  fetchHybridRemoteConfig,
  resolveHybridAvailability,
  runHybridPrompt,
  type HybridAvailability,
  type HybridRemoteConfig,
  type HybridReply,
  type OnDeviceProbeStatus,
} from '../lib/hybrid-ai.ts';
import { useApp } from '../context.tsx';

export type HybridPromptState =
  | { kind: 'idle' }
  | { kind: 'streaming'; reply: HybridReply | null }
  | { kind: 'stopped'; reply: HybridReply | null }
  | { kind: 'done'; reply: HybridReply }
  | { kind: 'error'; message: string };

export type HybridPromptEvent =
  | { type: 'start' }
  | { type: 'chunk'; text: string }
  | { type: 'succeed'; reply: HybridReply }
  | { type: 'fail'; message: string }
  | { type: 'stop' }
  | { type: 'clear' };

export function hybridPromptReducer(state: HybridPromptState, event: HybridPromptEvent): HybridPromptState {
  switch (event.type) {
    case 'start':
      return state.kind === 'streaming' ? state : { kind: 'streaming', reply: null };
    case 'chunk':
      if (state.kind !== 'streaming') return state;
      return {
        kind: 'streaming',
        reply: { text: event.text, origin: state.reply?.origin ?? 'unknown' },
      };
    case 'succeed':
      return state.kind === 'streaming' ? { kind: 'done', reply: event.reply } : state;
    case 'fail':
      return state.kind === 'streaming' ? { kind: 'error', message: event.message } : state;
    case 'stop':
      return state.kind === 'streaming' ? { kind: 'stopped', reply: state.reply } : state;
    case 'clear':
      return state.kind === 'streaming' ? state : { kind: 'idle' };
  }
}

/**
 * Shared React hook for client-side Hybrid Inference panels.
 * Handles lazy runner creation, Firebase Remote Config activation, pre-flight availability detection, cancellation, and live announcements.
 */
export function useHybridPrompt() {
  const { config, announce } = useApp();
  const firebase = config.firebase ?? null;
  const [onDeviceStatus, setOnDeviceStatus] = useState<OnDeviceProbeStatus | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<HybridRemoteConfig>(DEFAULT_HYBRID_REMOTE_CONFIG);
  const [state, dispatch] = useReducer(hybridPromptReducer, { kind: 'idle' });
  const alive = useRef(true);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (firebase === null) return;
    let cancelled = false;
    void detectOnDeviceAvailability().then((status) => {
      if (!cancelled && alive.current) setOnDeviceStatus(status);
    });
    // Defer Remote Config + App Check off initial paint so reCAPTCHA Enterprise never blocks TBT.
    const timer = globalThis.setTimeout(() => {
      if (cancelled || !alive.current) return;
      void fetchHybridRemoteConfig(firebase).then((rc) => {
        if (!cancelled && alive.current) setRemoteConfig(rc);
      });
    }, 2500);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [firebase]);

  const runner = useMemo(
    () => (firebase ? createFirebaseHybridRunner(firebase, { mode: remoteConfig.mode, cloudModel: remoteConfig.cloudModel }) : null),
    [firebase, remoteConfig.mode, remoteConfig.cloudModel],
  );

  const availability: HybridAvailability | null = onDeviceStatus
    ? resolveHybridAvailability(onDeviceStatus, remoteConfig.mode)
    : null;
  const available = firebase !== null && runner !== null && remoteConfig.enabled;
  const canRun = available && availability !== 'on-device-unavailable';
  const busy = state.kind === 'streaming';
  const completed = state.kind === 'done';
  const error = state.kind === 'error' ? state.message : null;
  const reply =
    state.kind === 'streaming' || state.kind === 'stopped' || state.kind === 'done'
      ? state.reply
      : null;

  function stop(): void {
    if (!busy) return;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'stop' });
    announce('Stopped.');
  }

  async function run(prompt: string, busyAnnouncement: string, readyLabel: string): Promise<void> {
    if (!runner || !canRun || busy) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: 'start' });
    announce(busyAnnouncement);
    const onChunk = (streamed: string) => {
      if (!alive.current || mine !== seq.current || controller.signal.aborted) return;
      dispatch({ type: 'chunk', text: streamed });
    };
    const res = await runHybridPrompt(runner, prompt, onChunk, controller.signal);
    if (!alive.current || mine !== seq.current) return;
    if (abortRef.current === controller) abortRef.current = null;
    if (res.ok) {
      dispatch({ type: 'succeed', reply: res.reply });
      if (res.reply.origin === 'cloud') {
        setOnDeviceStatus('cloud-fallback');
      } else if (res.reply.origin === 'on-device') {
        setOnDeviceStatus('ready');
      }
      announce(`${readyLabel} (${res.reply.origin}).`);
    } else if (!res.aborted) {
      dispatch({ type: 'fail', message: res.error });
      announce(res.error);
    }
  }

  return {
    state,
    available,
    canRun,
    availability,
    remoteConfig,
    busy,
    completed,
    error,
    reply,
    clearReply: () => {
      dispatch({ type: 'clear' });
    },
    run,
    stop,
  };
}
