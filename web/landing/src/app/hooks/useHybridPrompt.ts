import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Shared React hook for client-side Hybrid Inference panels.
 * Handles lazy runner creation, Firebase Remote Config activation, pre-flight availability detection, cancellation, and live announcements.
 */
export function useHybridPrompt() {
  const { config, announce } = useApp();
  const firebase = config.firebase ?? null;
  const [onDeviceStatus, setOnDeviceStatus] = useState<OnDeviceProbeStatus | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<HybridRemoteConfig>(DEFAULT_HYBRID_REMOTE_CONFIG);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<HybridReply | null>(null);
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
    void fetchHybridRemoteConfig(firebase).then((rc) => {
      if (!cancelled && alive.current) setRemoteConfig(rc);
    });
    return () => {
      cancelled = true;
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

  function stop(): void {
    if (!busy) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    announce('Stopped.');
  }

  async function run(prompt: string, busyAnnouncement: string, readyLabel: string): Promise<void> {
    if (!runner || !canRun || busy) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setCompleted(false);
    setError(null);
    setReply(null);
    announce(busyAnnouncement);
    const onChunk = (streamed: string) => {
      if (!alive.current || mine !== seq.current || controller.signal.aborted) return;
      setReply((prev) => ({ text: streamed, origin: prev?.origin ?? 'unknown' }));
    };
    const res = await runHybridPrompt(runner, prompt, onChunk, controller.signal);
    if (!alive.current || mine !== seq.current) return;
    if (abortRef.current === controller) abortRef.current = null;
    setBusy(false);
    if (res.ok) {
      setReply(res.reply);
      setCompleted(true);
      if (res.reply.origin === 'cloud') {
        setOnDeviceStatus('cloud-fallback');
      } else if (res.reply.origin === 'on-device') {
        setOnDeviceStatus('ready');
      }
      announce(`${readyLabel} (${res.reply.origin}).`);
    } else if (!res.aborted) {
      setError(res.error);
      announce(res.error);
    }
  }

  return {
    available,
    canRun,
    availability,
    remoteConfig,
    busy,
    completed,
    error,
    reply,
    clearReply: () => {
      setReply(null);
      setCompleted(false);
    },
    run,
    stop,
  };
}
